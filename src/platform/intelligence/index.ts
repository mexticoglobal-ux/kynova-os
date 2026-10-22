/**
 * Executive Intelligence Layer (Entrega 13). Reusable, PURE building blocks that turn a business's recorded facts into executive insight:
 * confidence, heat, trends, run-rate forecast, time saved, ranking, the CEO brief and the weekly report. No storage, no I/O, no clock, no AI.
 * Real Estate is only the first adapter; YouTube, Ecommerce, CRM, Finance, Restaurants, Clinics, Hotels or Builders feed it their own facts.
 */
export type Level = "high" | "medium" | "low";
export type Heat = "hot" | "warm" | "cold";
export type Params = Record<string, string | number>;

/* ───────────── Confidence: share of weighted evidence that is actually present ───────────── */
export interface Signal { code: string; weight: number; met: boolean }
export interface Confidence { pct: number; signals: Signal[] }
/** pct = weight of the signals that hold ÷ total weight. Never 100: a rule can be wrong. Capped to 99, floored to 5, 0 with no signals. */
export function confidence(signals: readonly Signal[]): Confidence {
  const total = signals.reduce((n, s) => n + s.weight, 0), met = signals.filter((s) => s.met).reduce((n, s) => n + s.weight, 0);
  return { pct: total === 0 ? 0 : Math.min(99, Math.max(5, Math.round((met / total) * 100))), signals: [...signals] };
}

/* ───────────── Heat ───────────── */
export const heatOf = (level: Level): Heat => (level === "high" ? "hot" : level === "medium" ? "warm" : "cold");

/* ───────────── Trend and run-rate ───────────── */
export interface Trend { direction: "up" | "down" | "flat" | "insufficient"; cur: number; prev: number; deltaPct: number | null }
/** Compares two equal windows. Both empty → insufficient (no data is not a trend). A change within ±`flatBand`% is flat. */
export function trend(cur: number, prev: number, flatBand = 10): Trend {
  if (cur === 0 && prev === 0) return { direction: "insufficient", cur, prev, deltaPct: null };
  if (prev === 0) return { direction: "up", cur, prev, deltaPct: null };
  const pct = Math.round(((cur - prev) / prev) * 100);
  return { direction: Math.abs(pct) <= flatBand ? "flat" : pct > 0 ? "up" : "down", cur, prev, deltaPct: pct };
}
export interface RunRate { count: number; windowDays: number; horizonDays: number; projected: number }
/** count ÷ windowDays × horizonDays, one decimal. The caller shows the formula next to the number. */
export const runRate = (count: number, windowDays: number, horizonDays: number): RunRate => ({ count, windowDays, horizonDays, projected: Math.round((count / windowDays) * horizonDays * 10) / 10 });

/* ───────────── Findings, ranking and the CEO brief ───────────── */
export type FindingKind = "action" | "opportunity" | "risk";
export interface Finding { id: string; kind: FindingKind; employee: string; code: string; params: Params; subjectKind: string | null; subjectId: string | null; priority: Level; points: number; confidence: Confidence; /** Business-profile items the recommendation could not use because they are not registered (never invented). */ needs?: string[]; /** Platforms the recommendation would need real data from but that are not connected ("key:status"). Never invented. */ blocked?: string[] }
const P = { high: 3, medium: 2, low: 1 } as const;
export const byImportance = (a: Pick<Finding, "priority" | "points">, b: Pick<Finding, "priority" | "points">): number => P[b.priority] - P[a.priority] || b.points - a.points;
export const topBy = <T>(xs: readonly T[], f: (x: T) => number): T | null => xs.reduce<T | null>((best, x) => (best === null || f(x) > f(best) ? x : best), null);
export const rankBy = <T extends { points: number }>(xs: readonly T[], n: number): T[] => [...xs].filter((x) => x.points > 0).sort((a, b) => b.points - a.points).slice(0, n);

export interface CeoBrief { today: Finding[]; priority: Finding | null; opportunity: Finding | null; risk: Finding | null }
/** The CEO does not talk: it only interprets. today = the most important actions; priority = the single most important of them. */
export function ceoBrief(findings: readonly Finding[], todayMax = 3): CeoBrief {
  const actions = findings.filter((f) => f.kind === "action").sort(byImportance);
  return { today: actions.slice(0, todayMax), priority: actions[0] ?? null, opportunity: topBy(findings.filter((f) => f.kind === "opportunity"), (f) => f.points), risk: topBy(findings.filter((f) => f.kind === "risk"), (f) => f.points) };
}

/* ───────────── Time saved (always an estimate) ───────────── */
export interface TimeSaved { minutes: number; parts: { key: string; count: number; minutesEach: number; minutes: number }[] }
export function timeSaved(counts: Readonly<Record<string, number>>, minutesEach: Readonly<Record<string, number>>): TimeSaved {
  const parts = Object.entries(counts).filter(([k, n]) => n > 0 && (minutesEach[k] ?? 0) > 0).map(([key, count]) => ({ key, count, minutesEach: minutesEach[key] as number, minutes: count * (minutesEach[key] as number) }));
  return { minutes: parts.reduce((n, p) => n + p.minutes, 0), parts };
}

/* ───────────── Weekly report ───────────── */
export interface WeeklyRow { key: string; cur: number; prev: number; trend: Trend }
export const weeklyReport = (metrics: readonly { key: string; cur: number; prev: number }[]): WeeklyRow[] => metrics.map((m) => ({ ...m, trend: trend(m.cur, m.prev) }));
/** Counts the timestamps that fall in the window n (0 = last `days` days, 1 = the `days` before that). */
export const inWindow = (times: readonly number[], now: number, days: number, n: 0 | 1): number => { const w = days * 86_400_000; return times.filter((t) => t > now - (n + 1) * w && t <= now - n * w).length; };
