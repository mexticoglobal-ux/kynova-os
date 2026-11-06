"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, CheckCircle2, MessageSquarePlus, ScrollText, ShieldCheck } from "lucide-react";
import { CHANNEL_LABEL, GRADE_LABEL } from "@/lib/pipeline-copy";
import { dashboardData } from "@/lib/modules/dashboard/data";
import type { ServerDigest } from "@/lib/contracts/backend";
import { formatDateTime, formatMoney } from "@/lib/format-money";
import { usePipeline } from "@/components/pipeline/PipelineProvider";
import { useSession } from "@/components/session/SessionProvider";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconBadge } from "@/components/ui/IconBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { DashboardView } from "./DashboardView";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function greetingFor(hour: number) {
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-ink-soft">
      <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary-soft" />
      <span>{children}</span>
    </li>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-sm text-ink-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
}

// Real numbers of the company, straight from the database: nothing here is a sample.
function RealMetrics({ server }: { server: ServerDigest }) {
  return (
    <section aria-labelledby="metrics-title" className="space-y-4">
      <h2 id="metrics-title" className="text-xl font-semibold">
        El negocio hoy
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Prospectos abiertos" value={String(server.leads.open)} hint={`${server.leads.hot} calientes`} />
        <Stat label="Sin seguimiento" value={String(server.leads.needFollowUp)} hint="Próxima acción vencida o sin fecha" />
        <Stat label="Oportunidades abiertas" value={String(server.opportunities.open)} hint={formatMoney(server.opportunities.openAmountMinor)} />
        <Stat label="Ventas ganadas" value={String(server.opportunities.won)} hint={formatMoney(server.opportunities.wonAmountMinor)} />
        <Stat label="Clientes activos" value={String(server.customers.active)} />
        <Stat label="Conversaciones abiertas" value={String(server.conversations.open)} />
        <Stat label="Mensajes en 24 h" value={String(server.conversations.messagesToday)} />
        <Stat label="Prospectos en total" value={String(server.leads.total)} />
      </div>
    </section>
  );
}

// The dashboard shows the work NEX did, not only numbers. Every line is computed from the pipeline: nothing is hard-coded.
export function NexDashboard() {
  const { digest, focus, activity, server, loading, error, mode, canDecide } = usePipeline();
  const session = useSession();
  const [hello, setHello] = useState("Hola");
  // The greeting depends on the visitor's clock, so it is set after mount to keep server and client markup identical.
  useEffect(() => setHello(greetingFor(new Date().getHours())), []);
  const { overnight, session: arrivedNow, approvals } = digest;
  const name = session.mode === "backend" ? session.displayName : dashboardData.userName;
  const anything = overnight.analyzed + overnight.hot + overnight.awaitingApproval + overnight.needFollowUp + overnight.withMeeting > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Bot}
        eyebrow={mode === "demo" ? "NEX · Datos de demostración" : `NEX · ${session.mode === "backend" ? session.tenantName : ""}`}
        title={
          <>
            {hello}, {name}.
          </>
        }
        subtitle={loading ? "Revisando lo que pasó…" : anything ? "Mientras no estabas:" : undefined}
      >
        {loading ? (
          <div className="mt-4 space-y-2" aria-busy="true" aria-label="Cargando">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : (
          <>
            {anything ? (
              <ul className="mt-4 space-y-2 text-sm sm:text-base" aria-label="Trabajo realizado por NEX mientras no estabas">
                {overnight.analyzed > 0 && <Done>{`Analicé ${plural(overnight.analyzed, "prospecto", "prospectos")}.`}</Done>}
                {overnight.hot > 0 && <Done>{`Detecté ${plural(overnight.hot, "oportunidad caliente", "oportunidades calientes")}.`}</Done>}
                {overnight.awaitingApproval > 0 && (
                  <Done>{`Preparé ${plural(overnight.awaitingApproval, "solicitud de reunión", "solicitudes de reunión")} que ${overnight.awaitingApproval === 1 ? "espera" : "esperan"} tu aprobación.`}</Done>
                )}
                {overnight.needFollowUp > 0 && <Done>{`Encontré ${plural(overnight.needFollowUp, "prospecto", "prospectos")} sin seguimiento.`}</Done>}
                {overnight.withMeeting > 0 && <Done>{`${plural(overnight.withMeeting, "reunión solicitada", "reuniones solicitadas")}, a la espera de respuesta.`}</Done>}
                {overnight.analyzed > 0 && <Done>Preparé el resumen ejecutivo de cada prospecto.</Done>}
              </ul>
            ) : (
              <p className="mt-4 text-ink-soft">
                {mode === "backend" ? "Todavía no ha pasado nada que contarte. Cuando NEX reciba a su primer prospecto, lo verás aquí." : "No hay novedades."}
              </p>
            )}
            <p className="mt-4 text-xs text-ink-muted">
              {mode === "demo"
                ? "Los prospectos de la noche son de ejemplo y están generados con el mismo motor del Business Audit. Nada se guarda ni se envía."
                : "Estos números salen de tu base de datos: lo que NEX analizó desde tu última visita. Nada se envía a un prospecto sin tu aprobación."}
            </p>
          </>
        )}
      </PageHeader>

      {error && (
        <p role="alert" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {error}
        </p>
      )}

      {arrivedNow.length > 0 && (
        <Card as="section" className="animate-fade-up p-5 sm:p-6" aria-labelledby="just-happened">
          <h2 id="just-happened" className="font-medium">
            Acaba de pasar
          </h2>
          <ul className="mt-3 space-y-3 text-sm">
            {arrivedNow.map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-start gap-3 text-ink-soft">
                  <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary-soft" />
                  <span>
                    {`Recibí a ${lead.company} por ${CHANNEL_LABEL[lead.channel].toLowerCase()} y lo analicé`}
                    {lead.score !== null ? `: Business Score ${lead.score}, ` : ": "}
                    {GRADE_LABEL[lead.grade].toLowerCase()}.
                  </span>
                </span>
                <Link href="/sales" onClick={() => focus(lead.id)} className="inline-flex items-center gap-1 text-primary-soft hover:underline">
                  Ver resumen ejecutivo
                  <ArrowRight aria-hidden className="h-4 w-4" />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="animate-fade-up p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-medium">
            <ShieldCheck aria-hidden className="h-4 w-4 text-accent" />
            {canDecide ? "Necesita tu aprobación" : "Esperando aprobación"}
          </h2>
          {approvals.length === 0 ? (
            <div className="mt-3">
              <EmptyState icon={ShieldCheck} title="Nada pendiente">
                NEX te avisará cuando prepare algo que dependa de ti.
              </EmptyState>
            </div>
          ) : (
            <ul className="mt-3 space-y-3 text-sm">
              {approvals.map((lead) => (
                <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-ink-soft">{`Solicitud de reunión para ${lead.company}`}</span>
                  <Link href="/sales" onClick={() => focus(lead.id)} className="inline-flex items-center gap-1 text-primary-soft hover:underline">
                    {canDecide ? "Revisar" : "Ver"}
                    <ArrowRight aria-hidden className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="animate-fade-up flex flex-col p-5 sm:p-6">
          <h2 className="font-medium">Recibir un prospecto</h2>
          <p className="mt-3 flex-1 text-sm text-ink-soft">
            Prueba el recorrido completo: haz de visitante en el sitio de Nova, deja que NEX te haga el diagnóstico y mira cómo el prospecto aparece en el Pipeline y aquí.
          </p>
          <Link href="/nex/chat" className={buttonClass("primary", "md", "mt-5 self-start")}>
            <MessageSquarePlus aria-hidden className="h-4 w-4" />
            Simular un prospecto nuevo
          </Link>
        </Card>
      </section>

      {mode === "backend" && (
        <Card as="section" className="animate-fade-up space-y-3 p-5 sm:p-6" aria-labelledby="recent-activity">
          <div className="flex items-center gap-3">
            <IconBadge icon={ScrollText} />
            <h2 id="recent-activity" className="font-medium">
              Actividad reciente
            </h2>
          </div>
          {activity.length === 0 ? (
            <p className="text-sm text-ink-muted">Cuando algo pase, quedará registrado aquí.</p>
          ) : (
            <ul className="divide-y divide-line-soft text-sm">
              {activity.map((item) => (
                <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span className="text-ink-soft">{item.summary}</span>
                  <time dateTime={item.at} className="text-xs text-ink-muted">
                    {formatDateTime(item.at)}
                  </time>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {mode === "backend" ? (
        server ? <RealMetrics server={server} /> : loading ? <Skeleton className="h-40" /> : null
      ) : (
        <section aria-labelledby="metrics-title" className="space-y-4">
          <h2 id="metrics-title" className="text-xl font-semibold">
            Métricas del negocio
          </h2>
          <DashboardView />
        </section>
      )}
    </div>
  );
}
