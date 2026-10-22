import { AdvisorPanel } from "@/components/integrations/Forms";
import { AI_TOPICS, ARCHITECTURE_STATUS } from "@/modules/integrations";
import ActionButton from "@/components/integrations/ActionButton";
import EntityForm from "@/components/integrations/EntityForm";
import LocalTime from "@/components/integrations/LocalTime";
import { integrationsContext } from "@/components/integrations/context";
import { K, nm } from "@/components/integrations/helpers";
import { Card, Empty, FilterForm, PageHeader, Pager, Pill, Stat, sp1 } from "@/components/integrations/ui";
import { StatusPill, Table, orNotFound } from "@/components/integrations/view";
import { PROVIDER_CATALOG } from "@/modules/integrations";
import { EmployeeNotices } from "@/components/company-integrations/EmployeeNotices";
import { ROSTER } from "@/modules/team";
import { EMPLOYEE_NEEDS, employeeCheck } from "@/platform/integrations";
import { IntegrationsTable } from "@/components/company-integrations/IntegrationsTable";
import { COMPANY_INTEGRATIONS_DICTIONARIES, companyIntegrationsLocale, getCompanyIntegrationsService, tr as ciTr } from "@/platform/integrations";
type SP = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const cur = async (sp: SP["searchParams"], keys: string[] = []) => { const p = await sp, o: Record<string, string> = { limit: "50" }; for (const k of ["cursor", ...keys]) { const v = sp1(p[k]); if (v) o[k] = v; } return o; };
const B = "/app/integrations";
const pname = (c: string) => PROVIDER_CATALOG.find((p) => p.code === c)?.name ?? c;
const lines = (xs: string[]) => xs.join(", ");
const sev = (h: string): "success" | "warning" | "danger" | "info" => (h === "healthy" || h === "connected" || h === "succeeded" || h === "processed" ? "success" : h === "degraded" || h === "pending" || h === "skipped" ? "warning" : h === "down" || h === "expired" || h === "error" || h === "failed" ? "danger" : "info");
void ActionButton; void EntityForm; void LocalTime; void K; void nm; void Card; void Empty; void FilterForm; void Pager; void Pill; void Stat; void StatusPill; void Table; void orNotFound; void cur; void B; void pname; void lines; void sev;
export default async function Page() {
  const { actor, svc, t, locale, can } = await integrationsContext();
  const ciL = companyIntegrationsLocale(locale), ci = await getCompanyIntegrationsService(), [ciItems, ciPerm] = await Promise.all([ci.list(actor), Promise.resolve(ci.permissions(actor))]);
  const [s, st, cs, un] = await Promise.all([svc.summary(actor), svc.settings.get(actor), svc.connections.list(actor, { limit: 100 }), svc.notifications.list(actor, { limit: 5, unread: "1" })]);
  const bad = cs.items.filter((c) => c.status === "expired" || c.status === "error" || c.health === "down" || c.health === "degraded");
  return (
    <>
      <PageHeader title={t("title")} actions={can("run_sync") ? <ActionButton path="/connections/check-all" label="conn.checkAll" /> : undefined} />
      <section aria-labelledby="ci-title" className="mb-6"><h2 id="ci-title" className="text-base font-semibold">{ciTr(ciL, "title")}</h2><p className="mb-3 mt-1 text-xs text-muted">{ciTr(ciL, "sub")}</p>
        <IntegrationsTable items={ciItems} t={(k, v) => ciTr(ciL, k, v)} L={COMPANY_INTEGRATIONS_DICTIONARIES[ciL]} manage={ciPerm.capabilities.includes("manage")} locale={ciL} /></section>
      <EmployeeNotices t={(k, v) => ciTr(ciL, k, v)} items={ROSTER.filter((r) => EMPLOYEE_NEEDS[r.key]).map((r) => ({ employee: r.key, name: r.name, ...employeeCheck(Object.fromEntries(ciItems.map((i) => [i.key, i.status])), r.key) }))} />
      <p role="note" className="mb-4 rounded-xl border border-line px-3 py-2 text-xs text-muted">{t("arch.notice")}</p>
      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("dash.connected")} value={s.connected} sub={t("dash.of", { n: s.connections })} /><Stat label={t("dash.pending")} value={s.pending} /><Stat label={t("dash.problems")} value={s.problems + s.down} /><Stat label={t("dash.degraded")} value={s.degraded} />
        <Stat label={t("dash.tokens")} value={s.tokensExpiring} /><Stat label={t("dash.jobsFailed")} value={s.jobsFailed} /><Stat label={t("dash.eventsFailed")} value={s.eventsFailed} /><Stat label={t("dash.unread")} value={s.unread} />
      </dl>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("dash.attention")}>{bad.length === 0 ? <Empty>{t("dash.allGood")}</Empty> : <Table head={[t("common.connection"), t("common.status"), t("common.health")]} rows={bad.map((c) => ({ key: c.id, cells: [`${pname(c.providerCode)} · ${c.label}`, <Pill key="s" tone={sev(c.status)}>{t(K(`cs.${c.status}`))}</Pill>, <Pill key="h" tone={sev(c.health)}>{t(K(`hl.${c.health}`))}</Pill>] }))} />}</Card>
        <Card title={t("dash.recent")}>{un.items.length === 0 ? <Empty>{t("common.noResults")}</Empty> : <Table head={[t("common.title"), t("common.date")]} rows={un.items.map((n) => ({ key: n.id, cells: [<span key="t"><Pill tone={n.severity === "critical" ? "danger" : "warning"}>{t(K(`sv.${n.severity}`))}</Pill> {n.title}</span>, <LocalTime key="d" ms={n.createdAt} locale={locale} />] }))} />}</Card>
      </div>
      <h2 className="mb-2 mt-6 text-sm font-semibold">{t("arch.title")}</h2>
      <Table head={[t("arch.part"), t("common.status")]} rows={Object.entries(ARCHITECTURE_STATUS).map(([k, v]) => ({ key: k, cells: [t(K(`arch.${k}`)), <Pill key="v" tone={v === "never_executed" ? "success" : "warning"}>{t(K(`arch.state.${v}`))}</Pill>] }))} />
      <div className="mt-5">{can("use_ai") && st.aiEnabled ? <AdvisorPanel topics={AI_TOPICS} connections={cs.items.map((c) => ({ value: c.id, label: `${pname(c.providerCode)} · ${c.label}` }))} /> : <Empty>{t("adv.off")}</Empty>}</div>
    </>
  );
}
