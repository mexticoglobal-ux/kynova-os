import type { Executive } from "@/modules/realestate";
import { Card, Pill } from "@/components/workforce/ui";
import type { RealEstateKey } from "@/modules/realestate";
import { CONNECTORS } from "@/platform/integrations/catalog";
import { COMPANY_INTEGRATIONS_DICTIONARIES as CI } from "@/platform/integrations/i18n";
import { BUSINESS_PROFILE_DICTIONARIES, type BusinessProfileKey, type BusinessProfileLocale } from "@/platform/business-profile/i18n";
import { Greeting } from "./ExecClient";

type T = (k: RealEstateKey, v?: Record<string, number | string>) => string;
type Conf = { pct: number; signals: { code: string; met: boolean }[] };
type Finding = Executive["ceo"]["priority"];
const K = (s: string) => s as RealEstateKey;
const tone = (pct: number) => (pct >= 70 ? "success" : pct >= 40 ? "info" : "muted");
const clock = (t: T, min: number) => (min >= 60 ? t("ex.hm", { h: Math.floor(min / 60), m: min % 60 }) : t("ex.min", { m: min }));

/** Confidence and its reasons: the share of the evidence the rule needs that is actually recorded. */
function Why({ c, t }: { c: Conf; t: T }) {
  return (
    <details className="text-xs text-muted"><summary className="cursor-pointer"><Pill tone={tone(c.pct)}>{t("ex.conf", { n: c.pct })}</Pill> <span className="underline">{t("ex.why")}</span></summary>
      <ul className="mt-1 grid gap-0.5">{c.signals.map((s) => <li key={s.code}>{s.met ? "✓" : "✗"} {t(K(`ex.s.${s.code}`))}</li>)}</ul></details>
  );
}
/** Wording for a finding: open work reuses the work-item sentences; opportunity and risk have their own. */
function say(f: NonNullable<Finding>, t: T, bp?: (c: string) => string): string {
  const p = { ...f.params } as Record<string, number | string>;
  if (f.code === "profile_incomplete" && bp) p.missing = String(p.missing).split(",").map(bp).join(", ");
  if (f.kind === "action") return t(K(`wi.${f.code}`), p);
  if (typeof p.level === "string") p.level = t(K(`lv.${p.level}`)).toLowerCase();
  return t(K(`ex.f.${f.code}`), p);
}
const Needs = ({ f, t, bp }: { f: NonNullable<Finding>; t: T; bp: (c: string) => string }) => (f.needs?.length ? <p className="text-xs text-muted">{t("ex.needs", { list: f.needs.map(bp).join(", ") })}</p> : null);
/** "key:status" -> "Google Search Console (Disponible próximamente)": the platform and its real state. */
const igLabel = (locale: BusinessProfileLocale) => (c: string): string => { const [key = "", st = ""] = c.split(":"); return `${CONNECTORS.find((d) => d.key === key)?.name ?? key} (${CI[locale][`status.${st}` as keyof (typeof CI)["es"]] ?? st})`; };
const Blocked = ({ f, t, ig }: { f: NonNullable<Finding>; t: T; ig: (c: string) => string }) => (f.blocked?.length ? <p className="text-xs text-muted">{t("ex.blocked", { list: f.blocked.map(ig).join(", ") })}</p> : null);
const Row = ({ q, f, t, bp }: { q: string; f: Finding; t: T; bp: (c: string) => string }) => (
  <div className="grid gap-1 rounded-xl border border-line px-3 py-2 text-sm"><p className="text-xs font-medium uppercase tracking-wide text-muted">{q}</p>
    {f ? <><p>{say(f, t, bp)}</p><Needs f={f} t={t} bp={bp} /><Why c={f.confidence} t={t} /></> : null}</div>
);

export function ExecutiveBrief({ ex, names, name, t, locale }: { ex: Executive & { summary: { employee: string; key: string; count: number }[] }; names: Record<string, string>; name: string; t: T; locale: BusinessProfileLocale }) {
  const bp = (c: string) => BUSINESS_PROFILE_DICTIONARIES[locale][c as BusinessProfileKey] ?? c, ig = igLabel(locale);
  const igLines = (ex.integrations ?? []).map((c) => { const [key = "", st = ""] = c.split(":"); return { key, text: t(K(`ex.ig.${key}`), { status: CI[locale][`status.${st}` as keyof (typeof CI)["es"]] ?? st }) }; });
  const m = ex.timeSaved.last24h.minutes, risk = ex.ceo.risk, ins = ex.insights, nm = (k: string) => names[k] ?? k;
  const hot = [...ex.ranking.buyers, ...ex.ranking.owners, ...ex.ranking.properties].sort((a, b) => b.points - a.points).slice(0, 5);
  const lines: { key: string; el: React.ReactNode }[] = ex.summary.map((i) => ({ key: i.key, el: <><strong>{nm(i.employee)}</strong> {t(K(`d.${i.key}`), { n: i.count })}</> }));
  if (risk?.code === "risk_stale") lines.push({ key: "x_risk", el: <><strong>{nm("analytics_manager")}</strong> {t("ex.x_risk", { title: String(risk.params.title), days: Number(risk.params.days) })}</> });
  const sentences: { key: string; text: string; c: Conf }[] = [];
  if (ins.potential) sentences.push({ key: "potential", text: t("ex.in.potential", ins.potential.params), c: ins.potential.confidence });
  if (ins.risk) sentences.push({ key: "risk", text: say(ins.risk, t), c: ins.risk.confidence });
  if (ins.opportunity) sentences.push({ key: "opportunity", text: say(ins.opportunity, t), c: ins.opportunity.confidence });
  if (ins.activity) sentences.push({ key: "activity", text: t("ex.in.activity", ins.activity.params), c: ins.activity.confidence });
  if (ins.drop) sentences.push({ key: "drop", text: t("ex.in.drop", { metric: t(K(`ex.m.${ins.drop.metric}`)), prev: ins.drop.prev, cur: ins.drop.cur }), c: ins.drop.confidence });
  if (ins.growth) sentences.push({ key: "growth", text: t("ex.in.growth", { metric: t(K(`ex.m.${ins.growth.metric}`)), prev: ins.growth.prev, cur: ins.growth.cur }), c: ins.growth.confidence });
  return (
    <div className="grid gap-4">
      <Card title={t("digest.title")}>
        <Greeting name={name} />
        {lines.length > 0 && <><p className="mt-2 text-sm text-muted">{t("ex.away")}</p><ul className="mt-1 grid gap-1 text-sm">{lines.map((l) => <li key={l.key}>• {l.el}</li>)}</ul></>}
        <p className="mt-3 text-sm">{m > 0 ? <><strong>{t("ex.time", { time: clock(t, m) })}</strong> <span className="text-xs text-muted">{t("ex.time.est")}</span></> : <span className="text-muted">{t("ex.time.none")}</span>}</p>
      </Card>
      <Card title={t("ex.ceo.title")}>
        <div className="grid gap-2 md:grid-cols-2">
          <div className="grid gap-1 rounded-xl border border-line px-3 py-2 text-sm md:col-span-2"><p className="text-xs font-medium uppercase tracking-wide text-muted">{t("ex.ceo.today")}</p>
            {ex.ceo.today.length === 0 ? <p className="text-muted">{t("ex.ceo.none")}</p> : <ol className="grid gap-1">{ex.ceo.today.map((f, n) => <li key={f.id}>{n + 1}. {say(f, t, bp)} <Needs f={f} t={t} bp={bp} /><Blocked f={f} t={t} ig={ig} /><Why c={f.confidence} t={t} /></li>)}</ol>}
            {igLines.length > 0 && <ul className="mt-2 grid gap-0.5 text-xs text-muted">{igLines.map((l) => <li key={l.key}>{l.text}</li>)}</ul>}</div>
          <Row q={t("ex.ceo.priority")} f={ex.ceo.priority} t={t} bp={bp} />
          {ex.ceo.opportunity ? <Row q={t("ex.ceo.opportunity")} f={ex.ceo.opportunity} t={t} bp={bp} /> : <div className="rounded-xl border border-line px-3 py-2 text-sm text-muted">{t("ex.ceo.noOpp")}</div>}
          {ex.ceo.risk ? <Row q={t("ex.ceo.risk")} f={ex.ceo.risk} t={t} bp={bp} /> : <div className="rounded-xl border border-line px-3 py-2 text-sm text-muted">{t("ex.ceo.noRisk")}</div>}
        </div>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("ex.in.title")}>
          {sentences.length === 0 ? <p className="text-sm text-muted">{t("ex.in.none")}</p> : <ul className="grid gap-2 text-sm">{sentences.map((s) => <li key={s.key}><p>{s.text}</p><Why c={s.c} t={t} /></li>)}</ul>}
        </Card>
        <Card title={t("ex.rk.title")}>
          {hot.length === 0 ? <p className="text-sm text-muted">{t("ex.rk.none")}</p> : (
            <ul className="grid gap-2 text-sm">{hot.map((r) => (
              <li key={`${r.kind}${r.id}`}><p><strong>{t(K(`ex.h.${r.heat}`))}</strong> · {r.name} <span className="text-xs text-muted">({t(K(`ex.k.${r.kind}`))} · {t(K("lv.title"))}: {t(K(`lv.${r.level}`))})</span></p>
                <p className="text-xs text-muted">{r.reasons.slice(0, 3).map((x) => t(K(`ex.r.${x.code}`), { p: x.points > 0 ? `+${x.points}` : String(x.points) })).join(" ")}</p><Why c={r.confidence} t={t} /></li>))}</ul>)}
        </Card>
      </div>
      <Card title={t("ex.fc.title")}>
        <ul className="grid gap-1 text-sm">{ex.trends.map((x) => <li key={x.metric}>{t(K(`ex.t.${x.direction === "insufficient" ? "flat" : x.direction}`), { metric: t(K(`ex.m.${x.metric}`)), prev: x.prev, cur: x.cur })}</li>)}
          <li className="mt-1">{ex.forecast ? <>{t("ex.fc.closings", { count: ex.forecast.count, n: ex.forecast.projected })} <span className="text-xs text-muted">{t("ex.fc.formula")}</span> <Why c={ex.forecast.confidence} t={t} /></> : <span className="text-muted">{t("ex.fc.none")}</span>}</li></ul>
        <p className="mt-2 text-xs text-muted">{t("ex.t.rule")}</p>
      </Card>
      <Card title={t("ex.val.title")}>
        <p className="text-sm">{t("ex.val.line", { time: clock(t, ex.timeSaved.total.minutes), opps: ex.value.opportunities, fu: ex.value.followups, pubs: ex.value.publications, mt: ex.value.matchings })}</p>
        <p className="mt-1 text-xs text-muted">{t("ex.val.note")}</p>
        <details className="mt-3 text-sm"><summary className="cursor-pointer font-medium">{t("ex.wk.title")}</summary>
          <ul className="mt-2 grid gap-1">{ex.weekly.rows.map((r) => <li key={r.key}>{t("ex.wk.row", { metric: t(K(`ex.m.${r.key}`)), cur: r.cur, prev: r.prev })}</li>)}
            <li>{ex.weekly.conversionPct === null ? t("ex.wk.noconv") : t("ex.wk.conversion", { n: ex.weekly.conversionPct })}</li></ul></details>
        {ex.truncated && <p className="mt-2 text-xs text-muted">{t("ex.truncated")}</p>}
      </Card>
    </div>
  );
}
