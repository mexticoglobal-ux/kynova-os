"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";
import { Bot, CalendarCheck, ChevronDown, ChevronUp, ShieldCheck, Sparkles } from "lucide-react";
import type { Lead, Priority } from "@/lib/contracts/pipeline";
import { executiveSummary } from "@/lib/pipeline";
import { CHANNEL_LABEL, GRADE_LABEL, METHOD_LABEL, PRIORITY_LABEL, STAGE_LABEL } from "@/lib/pipeline-copy";
import { BAND_COPY } from "@/lib/audit-copy";
import { usePipeline } from "@/components/pipeline/PipelineProvider";

const PRIORITY_STYLE: Record<Priority, string> = {
  high: "bg-rose-500/15 text-rose-200",
  medium: "bg-amber-500/15 text-amber-200",
  low: "bg-white/10 text-zinc-300",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-zinc-400">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-zinc-100">{children}</dd>
    </div>
  );
}

// The commercial pipeline: every prospect NEX has prepared, fed by the Business Audit through the guided chat.
export function PipelineBoard() {
  const { sorted, pack, focusId, focus } = usePipeline();

  return (
    <section aria-labelledby="pipeline-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="pipeline-title" className="text-xl font-semibold">
            Pipeline comercial
          </h2>
          <p className="text-sm text-zinc-400">
            {sorted.length} prospectos preparados por NEX. Datos de demostración: los prospectos de ejemplo son ficticios y nada se envía a nadie.
          </p>
        </div>
      </div>
      <ul className="grid gap-3">
        {sorted.map((lead) => (
          <LeadCard key={lead.id} lead={lead} open={focusId === lead.id} onToggle={() => focus(focusId === lead.id ? null : lead.id)} packBrand={pack.brand} />
        ))}
      </ul>
    </section>
  );
}

function LeadCard({ lead, open, onToggle, packBrand }: { lead: Lead; open: boolean; onToggle: () => void; packBrand: string }) {
  const { pack, approveMeeting, discardMeeting } = usePipeline();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [open]);
  const brief = executiveSummary(lead, pack);

  return (
    <li ref={ref} className={clsx("glass p-4 sm:p-5", lead.arrival === "session" && "ring-1 ring-primary/50")} data-testid={`lead-${lead.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium">
            {lead.company}
            {lead.arrival === "session" && <span className="ml-2 rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary-soft">Nuevo</span>}
          </h3>
          <p className="text-xs text-zinc-400">{`${CHANNEL_LABEL[lead.channel]} · ${GRADE_LABEL[lead.grade]}`}</p>
        </div>
        <span className={clsx("rounded-full px-2.5 py-1 text-xs", PRIORITY_STYLE[lead.priority])}>{`Prioridad ${PRIORITY_LABEL[lead.priority].toLowerCase()}`}</span>
      </div>

      <dl className="mt-4 grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Contacto">{lead.contact ? `${lead.contactName} · ${METHOD_LABEL[lead.contact.method]}` : `${lead.contactName} · sin contacto`}</Field>
        <Field label="Business Score">{lead.score !== null && lead.band ? `${lead.score} / 100 · ${BAND_COPY[lead.band].label}` : "Sin diagnóstico"}</Field>
        <Field label="Servicios recomendados">{lead.services.length > 0 ? lead.services.map((id) => pack.services[id]?.name ?? id).join(", ") : "—"}</Field>
        <Field label="Estado">{STAGE_LABEL[lead.stage]}</Field>
        <Field label="Próxima acción">{lead.nextAction}</Field>
        <Field label="Responsable">{lead.owner}</Field>
      </dl>

      {lead.approval && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm text-amber-100">
          <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" />
          NEX preparó una solicitud de reunión y espera su aprobación.
        </p>
      )}

      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Bot aria-hidden className="h-4 w-4" />
        {open ? "Ocultar resumen ejecutivo" : "Ver resumen ejecutivo"}
        {open ? <ChevronUp aria-hidden className="h-4 w-4" /> : <ChevronDown aria-hidden className="h-4 w-4" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-white/10 pt-4" data-testid="executive-summary">
          <div>
            <p className="flex items-center gap-2 text-xs uppercase tracking-wide text-primary-soft">
              <Sparkles aria-hidden className="h-3.5 w-3.5" />
              Resumen ejecutivo de NEX
            </p>
            <h4 className="mt-1 font-medium">{brief.headline}</h4>
          </div>
          <dl className="grid gap-3">
            {brief.rows.map(([label, value]) => (
              <Field key={label} label={label}>
                {value}
              </Field>
            ))}
          </dl>

          {lead.approval && (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-amber-100">
                <CalendarCheck aria-hidden className="h-4 w-4" />
                Solicitud de reunión preparada por NEX
              </p>
              <p className="mt-2 whitespace-pre-line rounded-xl bg-black/20 p-3 text-sm text-zinc-100">{lead.approval.draft}</p>
              <p className="mt-2 text-xs text-zinc-300">Es el primer mensaje a este prospecto, así que espera su aprobación. {packBrand}: en esta demostración no se envía nada.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => approveMeeting(lead.id)}
                  className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  Aprobar y solicitar reunión
                </button>
                <button
                  type="button"
                  onClick={() => discardMeeting(lead.id)}
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  Todavía no
                </button>
              </div>
            </div>
          )}
          {lead.stage === "meetingRequested" && !lead.approval && (
            <p className="flex items-center gap-2 text-sm text-emerald-200">
              <CalendarCheck aria-hidden className="h-4 w-4" />
              Reunión solicitada (demostración: no se envió nada al prospecto).
            </p>
          )}
        </div>
      )}
    </li>
  );
}
