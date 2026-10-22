import Link from "next/link";
import { MissionControlBlueprint } from "@/components/blueprints/CurrentCard";
import { ExecutiveBrief } from "@/components/realestate/Executive";
import { requireModuleAccess } from "@/platform/auth/session";
import { PendingWork, TeamTimeline, TeamWorkProvider } from "@/components/realestate/TeamWork";
import { KnowledgeCard } from "@/components/business-profile/KnowledgeCard";
import { businessProfileLocale, getBusinessProfileService, tr as bpTr2 } from "@/platform/business-profile";
import { HealthCard } from "@/components/company-integrations/HealthCard";
import { IntegrationsStatusCard } from "@/components/company-integrations/StatusCard";
import { getCompanyHealth } from "@/composition/company-health";
import { COMPANY_INTEGRATIONS_DICTIONARIES as CI_DICT, companyIntegrationsLocale, getCompanyIntegrationsService, tr as ciTr } from "@/platform/integrations";
import { SweepOnOpen } from "@/components/realestate/WorkActions";
import { getRealEstateService, tr as reTr, realEstateLocale } from "@/modules/realestate";
import { getBlueprintsService, tr as bpTr, blueprintsLocale } from "@/modules/blueprints";
import { MissionControlI18n } from "@/components/mission-control/I18n";
import { missionControlContext } from "@/components/mission-control/context";
import ActionButton from "@/components/mission-control/ActionButton";
import { Card } from "@/components/mission-control/ui";
import { TrackVisit } from "@/components/mission-control/Forms";
import { MISSION_CONTROL_DICTIONARIES } from "@/modules/mission-control";

const TABS = [["", "nav.dashboard"], ["kpis", "nav.kpis"], ["goals", "nav.goals"], ["tasks", "nav.tasks"], ["notifications", "nav.notifications"], ["alerts", "nav.alerts"], ["activity", "nav.activity"], ["recommendations", "nav.recommendations"], ["reports", "nav.reports"], ["health", "nav.health"], ["shortcuts", "nav.shortcuts"], ["favorites", "nav.favorites"], ["recent", "nav.recent"], ["widgets", "nav.widgets"], ["announcements", "nav.announcements"], ["settings", "nav.settings"]] as const;

export default async function MissionControlLayout({ children }: { children: React.ReactNode }) {
  const { t, locale, can, svc, actor } = await missionControlContext(), userName = (await requireModuleAccess("mission-control")).user.name;
  const bp = await (await getBlueprintsService()).current(actor).catch(() => null), bl = blueprintsLocale(locale);
  const re = await (async () => { try { const r = await getRealEstateService(), ov = await r.overview(actor); if (ov.state === "empty") return null; const can = r.permissions(actor).capabilities, [executive, items, tl] = await Promise.all([r.executive(actor), r.listWorkflowItems(actor), r.timeline(actor)]); return { executive, items, tl: tl.events, manage: can.includes("manage"), approve: can.includes("approve"), names: Object.fromEntries(ov.team.map((m) => [m.key, m.name])) }; } catch { return null; } })(), rl = realEstateLocale(locale);
  const bpl = businessProfileLocale(locale), kn = await (async () => { try { const b = await getBusinessProfileService(); return { state: await b.state(actor), manage: (await b.permissions(actor)).capabilities.includes("manage") }; } catch { return null; } })();
  const cil = companyIntegrationsLocale(locale), cit = (k: Parameters<typeof ciTr>[1], v?: Record<string, number | string>) => ciTr(cil, k, v);
  const ci = await (async () => { try { return { items: await (await getCompanyIntegrationsService()).list(actor), health: (await getCompanyHealth(actor)).health }; } catch { return null; } })();
  const ready = (await svc.setup.status(actor).catch(() => ({ initialized: false }))).initialized;
  return (
    <MissionControlI18n dict={MISSION_CONTROL_DICTIONARIES[locale]} locale={locale}>
      <div className="mx-auto w-full max-w-[96rem] p-4 sm:p-6 lg:p-8">
        <nav aria-label={t("title")} className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1 pb-2">
          {TABS.map(([x, k]) => <Link key={x} href={`/app/mission-control${x ? `/${x}` : ""}`} className="shrink-0 rounded-lg px-3 py-1.5 text-sm hover:bg-ac/10 focus-visible:outline-2 focus-visible:outline-ac2">{t(k)}</Link>)}
        </nav>
        {ready && <TrackVisit label={t("title")} />}
        {kn && <div className="mb-4"><KnowledgeCard state={kn.state} manage={kn.manage} t={(k, v) => bpTr2(bpl, k, v)} /></div>}
        {!re && kn && <div className="mb-4"><Card title={bpTr2(bpl, "card.title")}><p className="text-sm text-muted">{bpTr2(bpl, "insufficient")}</p></Card></div>}
        {ci && <div className="mb-4 grid gap-4 lg:grid-cols-2"><IntegrationsStatusCard items={ci.items} t={cit} /><HealthCard health={ci.health} t={cit} /></div>}
        {bp && <MissionControlBlueprint cur={bp} locale={bl} t={(k, v) => bpTr(bl, k, v)} />}
        {re && (
          <TeamWorkProvider locale={rl}>
            {re.manage && <SweepOnOpen />}
            <div className="mb-4 grid gap-4 lg:grid-cols-2">
              <div className="lg:col-span-2"><ExecutiveBrief ex={re.executive} names={re.names} name={userName.split(" ")[0] ?? userName} t={(k, v) => reTr(rl, k, v)} locale={bpl} /></div>
              <PendingWork items={re.items} names={re.names} t={(k, v) => reTr(rl, k, v)} can={re.approve} />
              <div className="lg:col-span-2"><TeamTimeline events={re.tl} names={re.names} t={(k, v) => reTr(rl, k, v)} /></div>
            </div>
          </TeamWorkProvider>)}
        {ready ? children : (
          <Card title={t("setup.title")}>
            {can("manage_settings") ? <div className="grid max-w-xl gap-3"><p className="text-sm text-muted">{t("setup.intro")}</p><div><ActionButton path="/setup" label="setup.start" tone="primary" /></div></div> : <p className="text-sm text-muted">{t("setup.notReady")}</p>}
          </Card>
        )}
      </div>
    </MissionControlI18n>
  );
}
