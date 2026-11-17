import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { NO_INFO, type BetaDashboard } from "@/lib/nex/execution-bridge/beta-dashboard";

const DISPLAY_LABEL = { Connected: "Conectada", Disconnected: "Desconectada", "Pending Authorization": "Pendiente de autorización", Error: "Con error" } as const;
const DISPLAY_TONE: Record<keyof typeof DISPLAY_LABEL, BadgeTone> = { Connected: "success", Disconnected: "neutral", "Pending Authorization": "warning", Error: "danger" };
const HEALTH_LABEL = { sales: "Ventas", support: "Soporte", billing: "Facturación", automation: "Automatización", ai: "IA" } as const;
const KIND_LABEL: Record<string, string> = { email: "Correo", whatsapp: "WhatsApp", call: "Llamada", note: "Nota", meeting: "Reunión", automation: "Automatización", worker: "Worker", audit: "Auditoría", nex: "NEX" };
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const show = (value: number | null | "error") => (value === null ? NO_INFO : value === "error" ? "Error de lectura" : String(value));

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="mt-3 text-sm text-ink-soft">{children}</div>
    </Card>
  );
}
const NoInfo = () => <p className="text-ink-muted">{NO_INFO}</p>;

// The Beta Dashboard: draws what `betaDashboard` already arranged. No rules and no queries here; a missing figure says "Sin información".
export function BetaDashboardView({ data, simulated = false }: { data: BetaDashboard; simulated?: boolean }) {
  const stats: ReadonlyArray<readonly [string, string]> = [
    ["Empresas", String(data.companies.length)], ["Workers", show(data.counts.workers)], ["Workflows activos", show(data.counts.workflows)],
    ["Ejecuciones", show(data.counts.executions)], ["Solicitudes pendientes", show(data.counts.pendingRequests)],
  ];
  const health = data.health;
  return (
    <div className="space-y-6">
      {simulated ? <Badge tone="warning">Datos simulados · empresas de ejemplo</Badge> : null}
      <nav aria-label="Empresas" className="flex flex-wrap gap-2">
        {data.companies.map((company) => (
          <Link key={company.id} href={`/platform/dashboard?empresa=${company.id}`} aria-current={company.id === data.tenantId ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${company.id === data.tenantId ? "border-primary bg-primary/10 text-ink" : "border-line text-ink-muted hover:text-ink"}`}>
            {company.name}
          </Link>
        ))}
      </nav>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {stats.map(([label, value]) => (
          <Card key={label} className="p-4">
            <dt className="text-xs text-ink-muted">{label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink">{value}</dd>
          </Card>
        ))}
      </dl>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Bandeja de aprobaciones">
          {data.approvals === null ? <NoInfo /> : data.approvals.length === 0 ? <p className="text-ink-muted">Nada pendiente.</p> : (
            <ul className="space-y-2">
              {data.approvals.map((entry) => (
                <li key={entry.actionId} className="flex items-center justify-between gap-3">
                  <span>{entry.operation} · {entry.workerId}</span>
                  <Badge tone={entry.status === "expired" ? "danger" : "warning"}>{entry.status === "expired" ? "Vencida" : "Pendiente"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Google Workspace">
          {data.google === null ? <NoInfo /> : (
            <ul className="space-y-2">
              {data.google.map((row) => (
                <li key={row.connectorId} className="flex items-center justify-between gap-3">
                  <span>{row.label} · salud {row.healthScore}</span>
                  <Badge tone={DISPLAY_TONE[row.display]}>{DISPLAY_LABEL[row.display]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Salud del sistema">
          {health === null ? <NoInfo /> : (
            <ul className="grid grid-cols-2 gap-2">
              {(Object.keys(HEALTH_LABEL) as Array<keyof typeof HEALTH_LABEL>).map((key) => (
                <li key={key} className="flex items-center justify-between gap-2">
                  <span>{HEALTH_LABEL[key]}</span>
                  <Badge tone={health[key] === "good" ? "success" : "warning"}>{health[key] === "good" ? "Bien" : "Atención"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Ejecución">
          {data.execution === null ? <NoInfo /> : <p>En cola: {data.execution.queued} · Planes activos: {data.execution.active} · Pendientes en el Gateway: {data.execution.gatewayPending}</p>}
        </Section>

        <Section title="KPIs">
          {data.kpis === null ? <NoInfo /> : (
            <ul className="space-y-2">
              {data.kpis.map((kpi) => (
                <li key={kpi.id} className="flex items-center justify-between gap-3">
                  <span>{kpi.label}</span>
                  <span className="text-ink">{kpi.value} / {kpi.target}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Actividad reciente">
          {data.activity === null ? <NoInfo /> : data.activity === "error" ? <p role="alert" className="text-danger">No se pudo leer la actividad. Intente de nuevo.</p> : data.activity.length === 0 ? <p className="text-ink-muted">Sin actividad registrada.</p> : (
            <ul className="space-y-2">
              {data.activity.map((item, index) => (
                <li key={`${item.at}-${index}`} className="flex items-center justify-between gap-3">
                  <span>{KIND_LABEL[item.kind] ?? item.kind}</span>
                  <time dateTime={item.at} className="text-ink-muted">{when(item.at)}</time>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
