import { Card, Pill } from "@/components/workforce/ui";
import type { CompanyHealth, CompanyIntegrationsKey, HealthLevel } from "@/platform/integrations";

type T = (k: CompanyIntegrationsKey, v?: Record<string, number | string>) => string;
const ICON: Record<HealthLevel, string> = { excellent: "🟢", healthy: "🟢", attention: "🟡", risk: "🟠", critical: "🔴" };
const TONE: Record<HealthLevel, "success" | "warning" | "danger"> = { excellent: "success", healthy: "success", attention: "warning", risk: "danger", critical: "danger" };
const n1 = (n: number) => String(Math.round(n * 10) / 10);
/** Company Health: the level, the score, every area's percentage and exactly why the score is what it is. */
export function HealthCard({ health, t }: { health: CompanyHealth; t: T }) {
  return (
    <Card title={t("hl.title")}>
      <p className="flex flex-wrap items-center gap-2 text-sm"><Pill tone={TONE[health.level]}>{ICON[health.level]} {t(`level.${health.level}`)}</Pill><span className="text-lg font-semibold">{health.score}%</span></p>
      <ul className="mt-3 grid gap-1 text-sm sm:grid-cols-2">
        {health.parts.map((p) => <li key={p.key} className="flex justify-between gap-2"><span>{t(`part.${p.key}`)}</span><span className="text-muted">{p.pct === null ? "—" : `${p.pct}%`}</span></li>)}
      </ul>
      <details className="mt-3 text-sm"><summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted">{t("hl.explain")}</summary>
        <p className="mt-2 text-xs text-muted">{t("hl.rules")}</p>
        <ul className="mt-2 grid gap-1 text-xs">
          {health.parts.map((p) => <li key={p.key}>{p.pct === null ? t("hl.na", { name: t(`part.${p.key}`) }) : t("hl.part", { name: t(`part.${p.key}`), pct: p.pct, weight: p.weight, points: n1(p.points) })}</li>)}
          {health.gaps.length === 0 ? <li>{t("hl.noGaps")}</li> : health.gaps.map((g) => <li key={`g${g.key}`} className="text-muted">{t("hl.gap", { name: t(`part.${g.key}`), lost: n1(g.lost), pct: g.pct ?? 0 })}</li>)}
        </ul></details>
    </Card>
  );
}
