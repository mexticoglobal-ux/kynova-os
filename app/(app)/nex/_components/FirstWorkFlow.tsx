"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ClipboardList, Info } from "lucide-react";
import { usePipeline } from "@/components/pipeline/PipelineProvider";
import { useSession } from "@/components/session/SessionProvider";
import { Badge } from "@/components/ui/Badge";
import { buttonClass } from "@/components/ui/Button";
import { ROLE_LABEL } from "@/lib/contracts/backend";
import { NEEDS, NEED_LABEL, buildDeliverable, planText, recommend, type Need } from "@/lib/first-work";

// First useful work: one question at most, one recommended priority with its reason, one reviewable deliverable. The logic is `lib/first-work.ts`;
// this draws it and keeps three states apart: example, saved draft, executed action (there is none: nothing is sent or booked).
export function FirstWorkFlow({ onExit, onDeepen, onSave, saveFailed }: { onExit: () => void; onDeepen: () => void; onSave: (text: string) => void; saveFailed: boolean }) {
  const session = useSession();
  const { sorted, canWrite } = usePipeline();
  const ctx = useMemo(
    () => ({ demo: session.mode === "demo", companyName: session.mode === "backend" ? session.tenantName : null, roleLabel: ROLE_LABEL[session.role], canWrite, leads: sorted }),
    [session, canWrite, sorted],
  );
  const recommendation = useMemo(() => recommend(ctx), [ctx]);
  const [need, setNeed] = useState<Need | null>(null);
  const [saved, setSaved] = useState(false);
  const chosen = need ?? recommendation.need;
  const deliverable = useMemo(() => buildDeliverable(chosen, ctx), [chosen, ctx]);
  // The priority shown always matches the deliverable: a capture plan comes with the capture priority, whatever the prospects are.
  const shownRecommendation = deliverable.title.startsWith("Plan de captación") ? recommend({ ...ctx, leads: [] }) : recommendation;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <button type="button" onClick={onExit} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Volver
      </button>

      <header className="space-y-1">
        <h2 className="text-2xl font-semibold">Su primera prioridad</h2>
        <p className="text-sm text-ink-muted">
          {session.mode === "backend" ? `${session.tenantName} · su rol: ${ROLE_LABEL[session.role]}` : "Modo demostración · datos de ejemplo"}
          {` · Prospectos en el Pipeline: ${sorted.length}`}
        </p>
      </header>

      <section aria-labelledby="fw-need" className="space-y-2">
        <h3 id="fw-need" className="text-sm font-medium">¿Qué necesita esta semana?</h3>
        <div className="flex flex-wrap gap-2">
          {NEEDS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={chosen === item}
              onClick={() => { setNeed(item); setSaved(false); }}
              className={buttonClass(chosen === item ? "primary" : "secondary", "md")}
            >
              {NEED_LABEL[item]}
              {item === recommendation.need && need === null ? " · recomendado" : ""}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">No hace falta responder nada más: NEX usa los datos que ya tiene su empresa.</p>
      </section>

      <section aria-labelledby="fw-priority" className="card space-y-1 p-4">
        <h3 id="fw-priority" className="text-xs font-medium uppercase tracking-wide text-ink-muted">Prioridad recomendada</h3>
        <p className="font-medium">{shownRecommendation.priority}</p>
        <p className="text-sm text-ink-soft">{shownRecommendation.why}</p>
      </section>

      <section aria-labelledby="fw-plan" className="card space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="fw-plan" className="flex items-center gap-2 font-medium">
            <ClipboardList aria-hidden className="h-4 w-4 text-primary" /> {deliverable.title}
          </h3>
          {saved ? <Badge tone="success">Borrador guardado</Badge> : <Badge tone="warning">{deliverable.basis === "example" ? "Ejemplo" : "Borrador sin guardar"}</Badge>}
        </div>
        <p className="text-xs text-ink-muted">
          {deliverable.basis === "example" ? "Es un ejemplo: no se basa en los datos de su empresa." : "Se basa en los prospectos de su empresa."}
        </p>
        <ol className="space-y-2 text-sm">
          {deliverable.items.map((item, index) => (
            <li key={`${item.when}-${index}`} className="flex gap-3">
              <span className="w-24 shrink-0 text-ink-muted">{item.when}</span>
              <span>
                {item.task}
                {item.note ? <span className="block text-xs text-ink-muted">{item.note}</span> : null}
              </span>
            </li>
          ))}
        </ol>
        {deliverable.draft ? (
          <blockquote className="rounded-xl border border-line bg-shade p-3 text-sm">
            <p className="mb-1 text-xs text-ink-muted">Borrador de mensaje para {deliverable.draft.for} · no enviado</p>
            {deliverable.draft.text}
          </blockquote>
        ) : null}
      </section>

      <section aria-labelledby="fw-state" className="space-y-2 rounded-xl border border-line p-4 text-sm">
        <h3 id="fw-state" className="flex items-center gap-2 font-medium"><Info aria-hidden className="h-4 w-4" /> Qué se hizo y qué falta</h3>
        <p><strong>Acciones ejecutadas:</strong> ninguna. No se envió nada ni se agendó nada.</p>
        <p>
          <strong>{saved ? "Borrador guardado" : "Borrador"}:</strong>{" "}
          {saved ? (session.mode === "backend" ? "quedó en su historial de NEX, privado para usted." : "quedó en el historial de este navegador (demostración).") : "todavía no se ha guardado."}
        </p>
        <ul className="list-disc space-y-1 pl-5 text-ink-soft">
          {deliverable.missing.map((item) => <li key={item}>{item}</li>)}
        </ul>
        {saveFailed ? <p role="alert" className="text-danger">No se pudo guardar el borrador. Inténtelo de nuevo.</p> : null}
      </section>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={saved}
          onClick={() => { onSave(planText(deliverable, shownRecommendation)); setSaved(true); }}
          className={buttonClass("primary", "md")}
        >
          {saved ? <><CheckCircle2 aria-hidden className="h-4 w-4" /> Guardado</> : "Guardar borrador"}
        </button>
        <button type="button" onClick={onDeepen} className={buttonClass("secondary", "md")}>Profundizar: diagnóstico completo (opcional)</button>
        <Link href="/sales" className={buttonClass("secondary", "md")}>Ir a Ventas</Link>
      </div>
      <p className="text-xs text-ink-muted">La captación de visitantes es otro recorrido (NEX › chat de captación): allí sí se pide un medio de contacto. Esta pantalla es su trabajo como usuario de la empresa.</p>
    </div>
  );
}
