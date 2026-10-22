import Link from "next/link";
import { Card } from "@/components/workforce/ui";
import type { CompanyIntegration, CompanyIntegrationsKey } from "@/platform/integrations";
import { DOT } from "./IntegrationsTable";

type T = (k: CompanyIntegrationsKey, v?: Record<string, number | string>) => string;
/** Mission Control card: the real status of every integration, nothing assumed. */
export function IntegrationsStatusCard({ items, t }: { items: CompanyIntegration[]; t: T }) {
  const none = !items.some((i) => i.status === "connected");
  return (
    <Card title={t("mc.title")}>
      <ul className="grid gap-1 text-sm sm:grid-cols-2">{items.map((i) => <li key={i.key} className="flex justify-between gap-2"><span>{i.name}</span><span className="text-muted">{DOT[i.status]} {t(`status.${i.status}`)}</span></li>)}</ul>
      {none && <p className="mt-2 text-xs text-muted">{t("mc.none")}</p>}
      <p className="mt-3"><Link className="text-sm underline" href="/app/integrations">{t("mc.open")}</Link></p>
    </Card>
  );
}
