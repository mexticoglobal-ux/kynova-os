import { redirect } from "next/navigation";
import { Companies, DnaForm, ProfileForm } from "@/components/business-profile/Forms";
import { KnowledgeCard } from "@/components/business-profile/KnowledgeCard";
import { HealthCard } from "@/components/company-integrations/HealthCard";
import { IntegrationsTable } from "@/components/company-integrations/IntegrationsTable";
import { getCompanyHealth } from "@/composition/company-health";
import { COMPANY_INTEGRATIONS_DICTIONARIES as CI_DICT, companyIntegrationsLocale, getCompanyIntegrationsService, tr as ciTr } from "@/platform/integrations";
import { Card } from "@/components/workforce/ui";
import { LOCALES } from "@/config/locales";
import { requireModuleAccess } from "@/platform/auth/session";
import { BUSINESS_PROFILE_DICTIONARIES, PRIORITIES, SOCIALS, businessProfileLocale, getBusinessProfileService, listMyCompanies, tr } from "@/platform/business-profile";

export const metadata = { title: "Business Profile" };
export const dynamic = "force-dynamic";

export default async function BusinessProfilePage() {
  const s = await requireModuleAccess("business-profile");
  if (!s.tenantId) redirect("/app/profile");
  const actor = { tenantId: s.tenantId, userId: s.user.id, role: s.role }, svc = await getBusinessProfileService(), locale = businessProfileLocale(s.user.locale), L = BUSINESS_PROFILE_DICTIONARIES[locale], t = (k: Parameters<typeof tr>[1], v?: Record<string, number | string>) => tr(locale, k, v);
  const [p, dna, state, perm, companies] = await Promise.all([svc.profile(actor), svc.dna(actor), svc.state(actor), svc.permissions(actor), listMyCompanies(s.user.id)]), manage = perm.capabilities.includes("manage"), b = p.basics;
  const cil = companyIntegrationsLocale(s.user.locale), cit = (k: Parameters<typeof ciTr>[1], v?: Record<string, number | string>) => ciTr(cil, k, v);
  const ciSvc = await getCompanyIntegrationsService(), [ciItems, ciHealth] = await Promise.all([ciSvc.list(actor), getCompanyHealth(actor)]), ciManage = ciSvc.permissions(actor).capabilities.includes("manage");
  const nav = [["#perfil", t("sec.profile")], ["#dna", t("sec.dna")], ["#integraciones", cit("title")], ["#health", cit("hl.title")]] as const;
  return (
    <main id="main" className="mx-auto grid w-full max-w-[72rem] gap-5 p-4 sm:p-6 lg:p-8">
      <header><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t("title")}</h1><p className="mt-1 text-sm text-muted">{t("sub")}</p></header>
      <nav aria-label={t("title")} className="flex flex-wrap gap-1 border-b border-line pb-2 text-sm">{nav.map(([h, l]) => <a key={h} href={h} className="rounded-lg px-3 py-1.5 hover:bg-ac/10 focus-visible:outline-2 focus-visible:outline-ac2">{l}</a>)}</nav>
      <KnowledgeCard state={state} t={t} manage={false} />
      <Card title={t("sec.companies")}><Companies companies={companies.map((c) => ({ id: c.id, name: c.name, industry: c.industry }))} current={s.tenantId} L={L} /></Card>
      {manage ? (
        <>
          <div id="perfil"><Card title={t("sec.profile")}><ProfileForm L={L} locales={[...LOCALES]} socials={[...SOCIALS]} init={{ name: b?.name ?? "", industry: b?.industry ?? "", country: b?.country ?? "", locale: b?.locale ?? "en", currency: b?.currency ?? "USD", timezone: b?.timezone ?? "UTC", website: p.website, logoUrl: p.logoUrl, email: p.email, phone: p.phone, location: p.location, socials: p.socials }} /></Card></div>
          <div id="dna"><Card title={t("sec.dna")}><DnaForm L={L} priorities={[...PRIORITIES]} init={{ objectives: dna.objectives, valueProposition: dna.valueProposition, customerType: dna.customerType, tone: dna.tone, industries: dna.industries, products: dna.products, services: dna.services, competitors: dna.competitors, keywords: dna.keywords, priorities: dna.priorities }} /></Card></div>
        </>
      ) : null}
      <div id="integraciones"><Card title={cit("title")}><IntegrationsTable items={ciItems} t={cit} L={CI_DICT[cil]} manage={ciManage} locale={cil} /></Card></div>
      <div id="health"><HealthCard health={ciHealth.health} t={cit} /></div>
    </main>
  );
}
