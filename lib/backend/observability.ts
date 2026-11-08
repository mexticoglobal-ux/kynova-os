// Observability, as architecture: structured logging, tracing, health checks and metrics. Each one is a small piece with an injected clock and an injected
// destination, so nothing here writes to a service, and nothing a log, a span or a metric carries can leak a secret or a person's data: keys that
// name a credential or personal data are hidden, strings that look like a secret are replaced, and a metric can only be labeled with a short,
// fixed list of names (never a company or a person), so the cardinality stays bounded.
import { looksLikeSecret, redactSecrets } from "./secrets";

// ---------------------------------------------------------------- what is safe to record
const SENSITIVE_KEY = /(secret|password|passwd|token|api_?key|authorization|cookie|credential|private_?key|key_hash|email|phone)/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

/** A copy of a value that is safe to record: sensitive keys hidden, secret-looking strings replaced, long strings cut, depth limited. */
export function sanitize(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value);
  if (value === null || typeof value === "number" || typeof value === "boolean" || value === undefined) return value;
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) out[key] = SENSITIVE_KEY.test(key) ? "[oculto]" : sanitize(item, depth + 1);
    return out;
  }
  return String(value);
}
export { looksLikeSecret };

// ---------------------------------------------------------------- logging
export type LogLevel = "debug" | "info" | "warn" | "error";
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type LogEntry = { at: string; level: LogLevel; message: string; fields: Record<string, unknown>; traceId?: string; spanId?: string };
export interface LogSink { write(entry: LogEntry): void }

export class MemoryLogSink implements LogSink {
  readonly entries: LogEntry[] = [];
  write(entry: LogEntry): void {
    this.entries.push(entry);
  }
}

export class Logger {
  constructor(private readonly options: { level: LogLevel; sink: LogSink; clock?: () => string; base?: Record<string, unknown>; trace?: { traceId: string; spanId: string } }) {}

  child(fields: Record<string, unknown>, trace?: { traceId: string; spanId: string }): Logger {
    return new Logger({ ...this.options, base: { ...this.options.base, ...fields }, trace: trace ?? this.options.trace });
  }

  private log(level: LogLevel, message: string, fields: Record<string, unknown> = {}): void {
    if (RANK[level] < RANK[this.options.level]) return;
    const entry: LogEntry = {
      at: (this.options.clock ?? (() => new Date().toISOString()))(), level, message: redactSecrets(message),
      fields: sanitize({ ...this.options.base, ...fields }) as Record<string, unknown>, ...(this.options.trace ?? {}),
    };
    this.options.sink.write(entry);
  }
  debug = (message: string, fields?: Record<string, unknown>) => this.log("debug", message, fields);
  info = (message: string, fields?: Record<string, unknown>) => this.log("info", message, fields);
  warn = (message: string, fields?: Record<string, unknown>) => this.log("warn", message, fields);
  error = (message: string, fields?: Record<string, unknown>) => this.log("error", message, fields);
}

// ---------------------------------------------------------------- tracing (W3C trace context)
export type SpanContext = { traceId: string; spanId: string; sampled: boolean };
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
export function parseTraceparent(header: string | null | undefined): SpanContext | null {
  const match = header ? TRACEPARENT.exec(header.trim()) : null;
  if (!match || /^0+$/.test(match[1] as string) || /^0+$/.test(match[2] as string)) return null;
  return { traceId: match[1] as string, spanId: match[2] as string, sampled: (Number.parseInt(match[3] as string, 16) & 1) === 1 };
}
export const formatTraceparent = (context: SpanContext): string => `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;

export type SpanRecord = { traceId: string; spanId: string; parentId?: string; name: string; startedAt: string; endedAt: string; durationMs: number; status: "ok" | "error"; attributes: Record<string, unknown> };
export interface SpanSink { write(span: SpanRecord): void }
export class MemorySpanSink implements SpanSink {
  readonly spans: SpanRecord[] = [];
  write(span: SpanRecord): void {
    this.spans.push(span);
  }
}

const hex = (length: number, seed: () => number): string => Array.from({ length }, () => Math.floor(seed() * 16).toString(16)).join("");

export class Tracer {
  constructor(private readonly options: { sample: number; sink: SpanSink; now?: () => number; random?: () => number }) {}

  /** The decision to keep a trace is made once, from its id, so every part of a trace is kept or dropped together. */
  private sampled(traceId: string): boolean {
    return Number.parseInt(traceId.slice(0, 8), 16) / 0xffffffff < this.options.sample;
  }

  start(name: string, options: { parent?: SpanContext; attributes?: Record<string, unknown> } = {}) {
    const random = this.options.random ?? Math.random;
    const now = this.options.now ?? Date.now;
    const traceId = options.parent?.traceId ?? hex(32, random);
    const context: SpanContext = { traceId, spanId: hex(16, random), sampled: options.parent ? options.parent.sampled : this.sampled(traceId) };
    const startedMs = now();
    const attributes: Record<string, unknown> = { ...options.attributes };
    return {
      context,
      setAttribute: (key: string, value: unknown) => void (attributes[key] = value),
      end: (status: "ok" | "error" = "ok") => {
        if (!context.sampled) return;
        const endedMs = now();
        this.options.sink.write({
          traceId, spanId: context.spanId, ...(options.parent ? { parentId: options.parent.spanId } : {}), name, startedAt: new Date(startedMs).toISOString(), endedAt: new Date(endedMs).toISOString(),
          durationMs: endedMs - startedMs, status, attributes: sanitize(attributes) as Record<string, unknown>,
        });
      },
    };
  }

  /** Runs work inside a span: an error ends it with status error and is rethrown. */
  async trace<T>(name: string, work: (context: SpanContext) => Promise<T> | T, options: { parent?: SpanContext; attributes?: Record<string, unknown> } = {}): Promise<T> {
    const span = this.start(name, options);
    try {
      const result = await work(span.context);
      span.end("ok");
      return result;
    } catch (error) {
      span.end("error");
      throw error;
    }
  }
}

// ---------------------------------------------------------------- health checks
export type HealthStatus = "ok" | "degraded" | "down";
export type HealthCheck = { name: string; /** A critical check that is down makes the whole service down. */ critical: boolean; timeoutMs?: number; run: () => Promise<{ status: HealthStatus; detail?: string }> };
export type HealthResult = { name: string; critical: boolean; status: HealthStatus; ms: number; detail?: string };
export type HealthReport = { status: HealthStatus; at: string; checks: HealthResult[] };

export async function runHealth(checks: readonly HealthCheck[], options: { now?: () => number; clock?: () => string } = {}): Promise<HealthReport> {
  const now = options.now ?? Date.now;
  const results = await Promise.all(
    checks.map(async (check): Promise<HealthResult> => {
      const started = now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("tiempo agotado")), check.timeoutMs ?? 2_000); });
        const outcome = await Promise.race([check.run(), limit]);
        return { name: check.name, critical: check.critical, status: outcome.status, ms: now() - started, ...(outcome.detail ? { detail: redactSecrets(outcome.detail) } : {}) };
      } catch (error) {
        return { name: check.name, critical: check.critical, status: "down", ms: now() - started, detail: error instanceof Error && error.message === "tiempo agotado" ? "tiempo agotado" : "la comprobación falló" }; // the error message is never exposed
      } finally {
        if (timer) clearTimeout(timer);
      }
    }),
  );
  const status: HealthStatus = results.some((item) => item.critical && item.status === "down") ? "down" : results.some((item) => item.status !== "ok") ? "degraded" : "ok";
  return { status, at: (options.clock ?? (() => new Date().toISOString()))(), checks: results };
}

// ---------------------------------------------------------------- metrics
/** The only labels a metric may carry. Never a company or a person: that would leak who uses what and make the number of series unbounded. */
export const ALLOWED_LABELS = ["module", "outcome", "status", "environment", "check", "route", "bucket"] as const;
const METRIC_NAME = /^kynova_[a-z][a-z0-9_]{2,60}$/;
export const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000] as const;

type Labels = Partial<Record<(typeof ALLOWED_LABELS)[number], string>>;
type Series = { kind: "counter" | "gauge" | "histogram"; name: string; labels: Labels; value: number; sum?: number; count?: number; buckets?: number[] };

export class Metrics {
  private readonly series = new Map<string, Series>();

  private find(kind: Series["kind"], name: string, labels: Labels): Series {
    if (!METRIC_NAME.test(name)) throw new Error(`nombre de métrica no válido: ${name}`);
    for (const key of Object.keys(labels)) if (!(ALLOWED_LABELS as readonly string[]).includes(key)) throw new Error(`la etiqueta «${key}» no está permitida en una métrica`);
    const id = `${kind}:${name}:${JSON.stringify(Object.entries(labels).sort())}`;
    let found = this.series.get(id);
    if (!found) {
      found = { kind, name, labels, value: 0, ...(kind === "histogram" ? { sum: 0, count: 0, buckets: DEFAULT_BUCKETS.map(() => 0) } : {}) };
      this.series.set(id, found);
    }
    return found;
  }

  inc(name: string, labels: Labels = {}, by = 1): void {
    if (by < 0) throw new Error("un contador solo sube");
    this.find("counter", name, labels).value += by;
  }
  set(name: string, value: number, labels: Labels = {}): void {
    this.find("gauge", name, labels).value = value;
  }
  observe(name: string, value: number, labels: Labels = {}): void {
    const series = this.find("histogram", name, labels);
    series.sum = (series.sum ?? 0) + value;
    series.count = (series.count ?? 0) + 1;
    DEFAULT_BUCKETS.forEach((limit, index) => { if (value <= limit && series.buckets) series.buckets[index] = (series.buckets[index] ?? 0) + 1; });
  }

  snapshot(): Series[] {
    return [...this.series.values()].map((item) => ({ ...item, labels: { ...item.labels }, ...(item.buckets ? { buckets: [...item.buckets] } : {}) }));
  }

  /** The metrics as text in the Prometheus exposition format, ready for the day a collector reads it. */
  render(): string {
    const label = (labels: Labels) => { const parts = Object.entries(labels).map(([key, value]) => `${key}="${String(value).replace(/"/g, "'")}"`); return parts.length ? `{${parts.join(",")}}` : ""; };
    return this.snapshot().flatMap((item) => (item.kind === "histogram" ? [`${item.name}_sum${label(item.labels)} ${item.sum}`, `${item.name}_count${label(item.labels)} ${item.count}`] : [`${item.name}${label(item.labels)} ${item.value}`])).join("\n");
  }
}
