"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bot, CheckCircle2, MessageSquarePlus, ShieldCheck } from "lucide-react";
import { CHANNEL_LABEL, GRADE_LABEL } from "@/lib/pipeline-copy";
import { dashboardData } from "@/lib/modules/dashboard/data";
import { usePipeline } from "@/components/pipeline/PipelineProvider";
import { DashboardView } from "./DashboardView";

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function greetingFor(hour: number) {
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function Done({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-zinc-200">
      <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
      <span>{children}</span>
    </li>
  );
}

// The dashboard shows the work NEX did, not only numbers. Every line is computed from the pipeline: nothing is hard-coded.
export function NexDashboard() {
  const { digest, focus } = usePipeline();
  const [hello, setHello] = useState("Hola");
  // The greeting depends on the visitor's clock, so it is set after mount to keep server and client markup identical.
  useEffect(() => setHello(greetingFor(new Date().getHours())), []);
  const { overnight, session, approvals } = digest;

  return (
    <div className="space-y-6">
      <section className="glass relative animate-fade-up overflow-hidden p-6 sm:p-8">
        <div aria-hidden className="glow absolute inset-0 opacity-60" />
        <div className="relative">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-300">
            <Bot aria-hidden className="h-3.5 w-3.5 text-primary" />
            NEX · Datos de demostración
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            {hello}, {dashboardData.userName}.
          </h1>
          <p className="mt-2 text-zinc-300">Mientras no estabas:</p>
          <ul className="mt-3 space-y-2 text-sm sm:text-base" aria-label="Trabajo realizado por NEX mientras no estabas">
            {overnight.analyzed > 0 && <Done>{`Analicé ${plural(overnight.analyzed, "prospecto", "prospectos")}.`}</Done>}
            {overnight.hot > 0 && <Done>{`Detecté ${plural(overnight.hot, "oportunidad caliente", "oportunidades calientes")}.`}</Done>}
            {overnight.awaitingApproval > 0 && (
              <Done>{`Preparé ${plural(overnight.awaitingApproval, "solicitud de reunión", "solicitudes de reunión")} que ${overnight.awaitingApproval === 1 ? "espera" : "esperan"} tu aprobación.`}</Done>
            )}
            {overnight.needFollowUp > 0 && <Done>{`Encontré ${plural(overnight.needFollowUp, "prospecto", "prospectos")} sin seguimiento.`}</Done>}
            {overnight.withMeeting > 0 && <Done>{`${plural(overnight.withMeeting, "reunión solicitada", "reuniones solicitadas")}, a la espera de respuesta.`}</Done>}
            {overnight.analyzed > 0 && <Done>Preparé el resumen ejecutivo de cada prospecto.</Done>}
          </ul>
          <p className="mt-4 text-xs text-zinc-400">
            Los prospectos de la noche son de ejemplo y están generados con el mismo motor del Business Audit. Nada se guarda ni se envía.
          </p>
        </div>
      </section>

      {session.length > 0 && (
        <section className="glass animate-fade-up p-5 sm:p-6" aria-labelledby="just-happened">
          <h2 id="just-happened" className="font-medium">
            Acaba de pasar
          </h2>
          <ul className="mt-3 space-y-3 text-sm">
            {session.map((lead) => (
              <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-start gap-3 text-zinc-200">
                  <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
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
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="glass animate-fade-up p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-medium">
            <ShieldCheck aria-hidden className="h-4 w-4 text-amber-300" />
            Necesita tu aprobación
          </h2>
          {approvals.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-400">No hay nada pendiente. NEX te avisará cuando prepare algo que dependa de ti.</p>
          ) : (
            <ul className="mt-3 space-y-3 text-sm">
              {approvals.map((lead) => (
                <li key={lead.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-zinc-200">{`Solicitud de reunión para ${lead.company}`}</span>
                  <Link href="/sales" onClick={() => focus(lead.id)} className="inline-flex items-center gap-1 text-primary-soft hover:underline">
                    Revisar
                    <ArrowRight aria-hidden className="h-4 w-4" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="glass animate-fade-up flex flex-col p-5 sm:p-6">
          <h2 className="font-medium">Recibir un prospecto</h2>
          <p className="mt-3 flex-1 text-sm text-zinc-300">
            Prueba el recorrido completo: haz de visitante en el sitio de Nova, deja que NEX te haga el diagnóstico y mira cómo el prospecto aparece en el Pipeline y aquí.
          </p>
          <Link
            href="/nex/chat"
            className="mt-5 inline-flex items-center gap-2 self-start rounded-full bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <MessageSquarePlus aria-hidden className="h-4 w-4" />
            Simular un prospecto nuevo
          </Link>
        </div>
      </section>

      <section aria-labelledby="metrics-title" className="space-y-4">
        <h2 id="metrics-title" className="text-xl font-semibold">
          Métricas del negocio
        </h2>
        <DashboardView compact />
      </section>
    </div>
  );
}
