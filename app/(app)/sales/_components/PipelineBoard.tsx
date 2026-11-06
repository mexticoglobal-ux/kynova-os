"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Bot, CalendarCheck, ChevronDown, ChevronUp, Inbox, ShieldCheck, Sparkles, UserCheck } from "lucide-react";
import type { Lead, Priority } from "@/lib/contracts/pipeline";
import { executiveSummary } from "@/lib/pipeline";
import { CHANNEL_LABEL, GRADE_LABEL, METHOD_LABEL, PRIORITY_LABEL, STAGE_LABEL } from "@/lib/pipeline-copy";
import { BAND_COPY } from "@/lib/audit-copy";
import { usePipeline } from "@/components/pipeline/PipelineProvider";
import { Badge } from "@/components/ui/Badge";
import { Button, buttonClass } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

const PRIORITY_STYLE: Record<Priority, string> = {
  high: "bg-danger/15 text-danger-soft",
  medium: "bg-warning/15 text-warning",
  low: "bg-raised-strong text-ink-soft",
};

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={clsx("min-w-0", wide && "col-span-2")}>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

// The commercial pipeline: every prospect NEX has prepared, fed by the Business Audit through the guided chat.
export function PipelineBoard() {
  const { sorted, pack, focusId, focus, loading, error, mode } = usePipeline();

  return (
    <section aria-labelledby="pipeline-title" className="space-y-3">
      <div>
        <h2 id="pipeline-title" className="text-xl font-semibold">
          Pipeline comercial
        </h2>
        <p className="text-sm text-ink-muted">
          {mode === "demo"
            ? `${sorted.length} prospectos preparados por NEX. Datos de demostración: los prospectos de ejemplo son ficticios y nada se envía a nadie.`
            : `${sorted.length} ${sorted.length === 1 ? "prospecto preparado" : "prospectos preparados"} por NEX en tu empresa. Todo se guarda; nada se envía a un prospecto sin tu aprobación.`}
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {error}
        </p>
      )}
      {loading ? (
        <div className="grid gap-3" aria-busy="true" aria-label="Cargando prospectos">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-44" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState icon={Inbox} title="Todavía no hay prospectos">
          Cuando NEX reciba y analice a alguien, aparecerá aquí con su diagnóstico y su siguiente paso. Prueba el chat guiado desde el Dashboard.
        </EmptyState>
      ) : (
        <ul className="grid gap-3">
          {sorted.map((lead, index) => (
            <LeadCard key={lead.id} index={index} lead={lead} open={focusId === lead.id} onToggle={() => focus(focusId === lead.id ? null : lead.id)} packBrand={pack.brand} />
          ))}
        </ul>
      )}
    </section>
  );
}

function LeadCard({ lead, open, onToggle, packBrand, index }: { lead: Lead; open: boolean; onToggle: () => void; packBrand: string; index: number }) {
  const { pack, approveMeeting, discardMeeting, winLead, canWrite, canDecide, mode } = usePipeline();
  const ref = useRef<HTMLLIElement>(null);
  const [confirmingWin, setConfirmingWin] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }, [open]);
  const brief = executiveSummary(lead, pack);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
      setConfirmingWin(false);
    }
  }

  return (
    <li
      ref={ref}
      className={clsx("card animate-fade-up p-4 transition-colors hover:border-line-strong sm:p-5", lead.arrival === "session" && "ring-1 ring-primary/50")}
      style={{ animationDelay: `${Math.min(index, 6) * 50}ms` }}
      data-testid={`lead-${lead.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-medium">
            {lead.company}
            {lead.arrival === "session" && (
              <Badge tone="primary" className="ml-2">
                Nuevo
              </Badge>
            )}
          </h3>
          <p className="text-xs text-ink-muted">{`${CHANNEL_LABEL[lead.channel]} · ${GRADE_LABEL[lead.grade]}`}</p>
        </div>
        <span className={clsx("rounded-full px-2.5 py-1 text-xs", PRIORITY_STYLE[lead.priority])}>{`Prioridad ${PRIORITY_LABEL[lead.priority].toLowerCase()}`}</span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        <Field label="Contacto">{lead.contact ? `${lead.contactName} · ${METHOD_LABEL[lead.contact.method]}` : `${lead.contactName} · sin contacto`}</Field>
        <Field label="Business Score">{lead.score !== null && lead.band ? `${lead.score} / 100 · ${BAND_COPY[lead.band].label}` : "Sin diagnóstico"}</Field>
        <Field label="Estado">{STAGE_LABEL[lead.stage]}</Field>
        <Field label="Responsable">{lead.owner}</Field>
        <Field label="Servicios recomendados" wide>
          {lead.services.length > 0 ? lead.services.map((id) => pack.services[id]?.name ?? id).join(", ") : "—"}
        </Field>
        <Field label="Próxima acción" wide>
          {lead.nextAction}
        </Field>
      </dl>

      {lead.approval && (
        <p className="mt-4 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <ShieldCheck aria-hidden className="h-4 w-4 shrink-0" />
          NEX preparó una solicitud de reunión y espera {canDecide ? "tu aprobación" : "la aprobación de un propietario o administrador"}.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-expanded={open} onClick={onToggle} className={buttonClass("secondary", "md")}>
          <Bot aria-hidden className="h-4 w-4" />
          {open ? "Ocultar resumen ejecutivo" : "Ver resumen ejecutivo"}
          {open ? <ChevronUp aria-hidden className="h-4 w-4" /> : <ChevronDown aria-hidden className="h-4 w-4" />}
        </button>
        {canWrite && lead.stage !== "won" && lead.grade !== "human" && (
          <>
            {confirmingWin ? (
              <>
                <Button variant="accent" disabled={busy} onClick={() => void run(() => winLead(lead.id))}>
                  <UserCheck aria-hidden className="h-4 w-4" />
                  {busy ? "Convirtiendo…" : "Confirmar: convertir en cliente"}
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => setConfirmingWin(false)}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => setConfirmingWin(true)}>
                <UserCheck aria-hidden className="h-4 w-4" />
                Convertir en cliente
              </Button>
            )}
          </>
        )}
      </div>
      {confirmingWin && <p className="mt-2 text-xs text-ink-muted">Crea la oportunidad, la marca como ganada y registra al cliente. Es una decisión comercial: la tomas tú.</p>}

      {open && (
        <div className="mt-4 space-y-4 border-t border-line pt-4" data-testid="executive-summary">
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
            <div className="rounded-2xl border border-warning/30 bg-warning/10 p-4">
              <p className="flex items-center gap-2 text-sm font-medium text-warning">
                <CalendarCheck aria-hidden className="h-4 w-4" />
                Solicitud de reunión preparada por NEX
              </p>
              <p className="mt-2 whitespace-pre-line rounded-xl bg-shade p-3 text-sm text-ink">{lead.approval.draft}</p>
              <p className="mt-2 text-xs text-ink-soft">
                Es el primer mensaje a este prospecto, así que espera aprobación. {packBrand}:{" "}
                {mode === "demo" ? "en esta demostración no se envía nada." : "el canal todavía no está conectado: al aprobarla queda registrada y en cola, y no sale de la plataforma."}
              </p>
              {canDecide ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="primary" disabled={busy} onClick={() => void run(() => approveMeeting(lead.id))}>
                    Aprobar y solicitar reunión
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => void run(() => discardMeeting(lead.id))}>
                    Todavía no
                  </Button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-ink-muted">Solo un propietario o administrador puede aprobarla.</p>
              )}
            </div>
          )}
          {lead.stage === "meetingRequested" && !lead.approval && (
            <p className="flex items-center gap-2 text-sm text-success">
              <CalendarCheck aria-hidden className="h-4 w-4" />
              {mode === "demo" ? "Reunión solicitada (demostración: no se envió nada al prospecto)." : "Solicitud de reunión aprobada y registrada."}
            </p>
          )}
          {lead.stage === "won" && (
            <p className="flex items-center gap-2 text-sm text-success">
              <UserCheck aria-hidden className="h-4 w-4" />
              Ya es cliente: consúltalo en la sección Clientes.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
