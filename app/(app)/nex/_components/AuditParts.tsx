import { CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import type { AuditResult } from "@/lib/contracts/audit";
import type { AuditSummary } from "@/lib/audit-summary";
import { BAND_COPY, DIMENSION_COPY, INFRASTRUCTURE_COPY, pick, type Treatment } from "@/lib/audit-copy";
import type { ClientPack } from "@/lib/audit-packs/nova-draft";

// Pieces shared by the audit screen and the guided chat, so both show the result the same way.

export function NexBadge({ label = "NEX · Business Audit" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-300">
      <Sparkles aria-hidden className="h-3.5 w-3.5 text-primary-soft" />
      {label}
    </span>
  );
}

// The score never travels alone: the plain sentence next to it says what it means for this business.
export function ScoreCard({ result, status }: { result: AuditResult; status: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <p className="text-xs uppercase tracking-wide text-zinc-400">Business Score</p>
      <p className="mt-1 text-5xl font-semibold tabular-nums" aria-label={`Business Score ${result.score} de 100`}>
        {result.score} <span className="text-2xl font-normal text-zinc-400">/ 100</span>
      </p>
      <p className="mt-1 text-sm text-zinc-400">{`${BAND_COPY[result.band].label} · ${INFRASTRUCTURE_COPY[result.infrastructure].label}`}</p>
      <p className="mt-4 text-xs text-zinc-400">Estado actual:</p>
      <p className="mt-1 font-medium text-zinc-100">{status}</p>
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Check({ children, approval = false }: { children: React.ReactNode; approval?: boolean }) {
  return (
    <li className="flex items-start gap-2 text-sm text-zinc-200">
      {approval ? <ShieldCheck aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" /> : <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary-soft" />}
      <span>{children}</span>
    </li>
  );
}

// The five answers every audit ends with: what was found, top opportunities, what first, what KYNOVA prepares, what needs approval.
export function SummaryView({ summary, pack, treatment }: { summary: AuditSummary; pack: ClientPack; treatment: Treatment }) {
  return (
    <div className="space-y-8">
      <Section title="Lo que encontré">
        {summary.found.map((line) => (
          <p key={line} className="text-zinc-200">
            {line}
          </p>
        ))}
      </Section>

      {summary.opportunities.length > 0 && (
        <Section title={`Las ${summary.opportunities.length === 1 ? "oportunidad" : `${summary.opportunities.length} oportunidades`} más importantes`}>
          <ol className="grid gap-3">
            {summary.opportunities.map((opportunity, index) => (
              <li key={opportunity.dimension} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-xs text-primary-soft">{`${index + 1} · ${DIMENSION_COPY[opportunity.dimension].label}`}</p>
                <h3 className="mt-1 font-medium">{opportunity.title}</h3>
                <p className="mt-2 text-sm text-zinc-300">{opportunity.why}</p>
                <p className="mt-2 text-sm text-zinc-100">
                  <span className="text-zinc-400">Qué hacer: </span>
                  {opportunity.action}
                </p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="Lo primero que recomiendo">
        <p className="rounded-2xl border border-primary/30 bg-primary/10 p-4 text-zinc-100">{summary.first}</p>
      </Section>

      {summary.services.length > 0 && (
        <Section title={`Cómo puede ayudar ${pack.brand}`}>
          <ul className="grid gap-2">
            {summary.services.map((recommendation) => {
              const service = pack.services[recommendation.serviceId];
              return (
                <li key={recommendation.serviceId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="font-medium">{service?.name ?? recommendation.serviceId}</p>
                  {service && <p className="text-sm text-zinc-300">{service.summary}</p>}
                  <p className="mt-1 text-xs text-zinc-400">{`Cierra: ${recommendation.because.map((d) => DIMENSION_COPY[d].label.toLowerCase()).join(", ")}`}</p>
                </li>
              );
            })}
          </ul>
          {pack.isDraft && (
            <p className="text-xs text-zinc-400">Servicios de ejemplo, en borrador: {pack.brand} aún debe confirmar su oferta real. Sin precios ni plazos.</p>
          )}
        </Section>
      )}

      {summary.automate.length > 0 && (
        <Section title={pick(treatment, ["Lo que KYNOVA puede preparar por usted", "Lo que KYNOVA puede preparar por ti"])}>
          <ul className="grid gap-2">
            {summary.automate.map((line) => (
              <Check key={line}>{line}</Check>
            ))}
          </ul>
          <p className="text-xs text-zinc-400">Todo se prepara como borrador: nada se ejecuta sin su aprobación.</p>
        </Section>
      )}

      <Section title={pick(treatment, ["Lo que requiere su aprobación", "Lo que requiere tu aprobación"])}>
        <ul className="grid gap-2">
          {summary.approval.map((line) => (
            <Check key={line} approval>
              {line}
            </Check>
          ))}
        </ul>
      </Section>
    </div>
  );
}
