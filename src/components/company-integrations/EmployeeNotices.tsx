import { CONNECTORS } from "@/platform/integrations/catalog";
import type { CompanyIntegrationsKey, Status } from "@/platform/integrations";

type T = (k: CompanyIntegrationsKey, v?: Record<string, number | string>) => string;
export interface EmployeeCheck { employee: string; name: string; ready: boolean; missing: { key: string; status: Status }[] }
/** Each AI Employee, in its own voice, says whether it can work with real data. It never says it did. */
export function EmployeeNotices({ items, t }: { items: EmployeeCheck[]; t: T }) {
  return (
    <section aria-labelledby="ci-emp" className="mb-6"><h2 id="ci-emp" className="mb-2 text-base font-semibold">{t("emp.title")}</h2>
      <ul className="grid gap-1 text-sm">{items.map((e) => <li key={e.employee}><strong>{e.name}</strong>{" "}<span className="text-muted">{e.ready ? t("emp.ready") : t("emp.cant", { list: e.missing.map((m) => `${CONNECTORS.find((d) => d.key === m.key)?.name ?? m.key}: ${t(`status.${m.status}`)}`).join(", ") })}</span></li>)}</ul></section>
  );
}
