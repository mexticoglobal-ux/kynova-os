import { Pill } from "@/components/workforce/ui";
import type { CompanyIntegration, CompanyIntegrationsKey, Status } from "@/platform/integrations";
import { ConfigureButton } from "./ConfigureButton";

type T = (k: CompanyIntegrationsKey, v?: Record<string, number | string>) => string;
export const DOT: Record<Status, string> = { connected: "🟢", pending: "🟡", error: "🔴", not_configured: "⚪", coming_soon: "⚪" };
const TONE: Record<Status, "success" | "warning" | "danger" | "muted"> = { connected: "success", pending: "warning", error: "danger", not_configured: "muted", coming_soon: "muted" };
/** Name, state, last sync, health, type and Configure for every connector. A connector without an adapter says "Disponible próximamente". */
export function IntegrationsTable({ items, t, L, manage, locale }: { items: CompanyIntegration[]; t: T; L: Record<string, string>; manage: boolean; locale: string }) {
  const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString(locale) : t("sync.never"));
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-left text-sm">
        <thead><tr className="border-b border-line text-xs uppercase tracking-wide text-muted">{(["col.name", "col.status", "col.sync", "col.health", "col.kind", "col.action"] as const).map((k) => <th key={k} scope="col" className="px-2 py-2 font-medium">{t(k)}</th>)}</tr></thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.key} className="border-b border-line/60 align-top">
              <th scope="row" className="px-2 py-2 font-medium">{i.name}</th>
              <td className="px-2 py-2"><Pill tone={TONE[i.status]}>{DOT[i.status]} {t(`status.${i.status}`)}</Pill></td>
              <td className="px-2 py-2 text-muted">{i.status === "coming_soon" ? "—" : when(i.lastSyncAt)}</td>
              <td className="px-2 py-2 text-muted">{i.status === "coming_soon" ? "—" : t(`health.${i.health}`)}</td>
              <td className="px-2 py-2 text-muted">{t(`kind.${i.kind}`)}</td>
              <td className="px-2 py-2">{manage ? <ConfigureButton connector={i.key} fields={[...i.fields]} init={i.config} available={i.status !== "coming_soon"} L={L} /> : null}</td>
            </tr>))}
        </tbody>
      </table>
    </div>
  );
}
