import type { ReactNode } from "react";
import type { Point } from "@/lib/contracts/platform/koe-insights";
import { Stat } from "@/components/ui/Stat";

// Presentation only: these helpers format and draw what the engine (koe-insights.ts) computed. They never count or calculate.

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
export const num = (value: number, decimals = 0): string => { const [whole, fraction] = value.toFixed(decimals).split("."); return fraction ? `${group(whole)}.${fraction}` : group(whole); };
export const money = (micros: number): string => `US$ ${num(micros / 1_000_000, Math.abs(micros) >= 1_000_000 ? 2 : 4)}`;
export const pct = (ratio: number | null): string => (ratio === null ? "—" : `${(ratio * 100).toFixed(1)} %`);
export const ms = (value: number | null): string => (value === null ? "—" : value >= 1_000 ? `${(value / 1_000).toFixed(2)} s` : `${num(value)} ms`);
export const multiple = (value: number | null): string => (value === null ? "—" : `×${num(value, 1)}`);
export const unitValue = (unit: string, value: number): string => (unit === "money" ? money(value) : unit === "minutes" ? `${num(value)} min` : num(value));

/** One figure: a label, the number, and an optional note. The same card as every dashboard of the product (components/ui/Stat). */
export const Kpi = Stat;

/** A small bar chart in plain HTML: accessible (a text summary is the label) and without any library. */
export function BarChart({ points, unit, title }: { points: readonly Point[]; unit: string; title: string }) {
  const top = Math.max(1, ...points.map((item) => item.value));
  const summary = points.map((item) => `${item.label}: ${unitValue(unit, item.value)}`).join("; ");
  return (
    <div role="img" aria-label={`${title}. ${summary}`} className="flex h-28 items-end gap-1.5">
      {points.map((item) => (
        <div key={item.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
          <div className="w-full rounded-t bg-primary/70" style={{ height: `${Math.max(2, (item.value / top) * 100)}%` }} title={`${item.label}: ${unitValue(unit, item.value)}`} />
          <span className="text-[10px] text-ink-muted">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Horizontal bars for a ranking: the longest is the first. */
export function Ranking({ rows, format, empty }: { rows: readonly { id: string; label: string; value: number; note?: string }[]; format: (value: number) => string; empty?: string }) {
  if (rows.length === 0) return <p className="text-sm text-ink-muted">{empty ?? "Todavía no hay datos."}</p>;
  const top = Math.max(1, ...rows.map((item) => item.value));
  return (
    <ul className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="space-y-0.5">
          <div className="flex items-baseline justify-between gap-2 text-sm"><span className="font-medium">{row.label}</span><span className="text-ink-soft">{format(row.value)}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-raised-strong"><div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(2, (row.value / top) * 100)}%` }} /></div>
          {row.note && <p className="text-xs text-ink-muted">{row.note}</p>}
        </li>
      ))}
    </ul>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-semibold">{title}</h2>{aside && <span className="text-xs text-ink-muted">{aside}</span>}</div>
      {children}
    </section>
  );
}
