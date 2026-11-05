"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { AUDIT_DIMENSIONS, type AuditAnswers, type MaturityLevel, MATURITY_LEVELS } from "@/lib/contracts/audit";
import { runAudit } from "@/lib/audit";
import { buildSummary } from "@/lib/audit-summary";
import { BAND_COPY, DIMENSION_COPY, INFRASTRUCTURE_COPY, pick, type Treatment } from "@/lib/audit-copy";
import type { ClientPack } from "@/lib/audit-packs/nova-draft";

type Draft = Partial<AuditAnswers>;
type Stage = "intro" | "questions" | "analyzing" | "report";

const isComplete = (draft: Draft): draft is AuditAnswers => AUDIT_DIMENSIONS.every((dimension) => draft[dimension] !== undefined);

const primaryButton =
  "inline-flex items-center justify-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-white transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft disabled:opacity-40";
const secondaryButton =
  "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40";

// The audit lives only in this component's state: nothing is stored or sent anywhere (Business Audit v1, self-reported).
export function AuditFlow({ pack, analysisMs = 1600 }: { pack: ClientPack; analysisMs?: number }) {
  const [stage, setStage] = useState<Stage>("intro");
  const [treatment, setTreatment] = useState<Treatment>(pack.defaultTreatment);
  const [businessName, setBusinessName] = useState("");
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Draft>({});
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>("[data-nex-scroll], main");
    if (scroller) scroller.scrollTop = 0;
  }, [stage, step]);

  useEffect(() => {
    if (stage !== "analyzing") return;
    const timer = window.setTimeout(() => setStage("report"), analysisMs);
    return () => window.clearTimeout(timer);
  }, [stage, analysisMs]);

  const total = AUDIT_DIMENSIONS.length;
  const dimension = AUDIT_DIMENSIONS[step];
  const current = dimension ? answers[dimension] : undefined;

  function choose(level: MaturityLevel) {
    setAnswers((existing) => ({ ...existing, [dimension]: level }));
  }

  function next() {
    if (step + 1 >= total) setStage("analyzing");
    else setStep(step + 1);
  }

  function restart() {
    setAnswers({});
    setStep(0);
    setStage("intro");
  }

  return (
    <div ref={rootRef} className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      {stage === "intro" && (
        <section aria-labelledby="audit-intro">
          <NexBadge />
          <h1 id="audit-intro" className="mt-4 text-3xl font-semibold">
            {pick(treatment, ["Conozcamos su negocio", "Conozcamos tu negocio"])}
          </h1>
          <p className="mt-3 text-zinc-300">
            {pick(treatment, [
              `Soy NEX, el asistente de ${pack.brand}. Le haré ${total} preguntas breves, de unos dos minutos, para entender en qué punto está su negocio y qué le conviene hacer primero.`,
              `Soy NEX, el asistente de ${pack.brand}. Te haré ${total} preguntas breves, de unos dos minutos, para entender en qué punto está tu negocio y qué te conviene hacer primero.`,
            ])}
          </p>
          <label className="mt-6 block text-sm text-zinc-300" htmlFor="audit-name">
            {pick(treatment, ["¿Cómo se llama su negocio? (opcional)", "¿Cómo se llama tu negocio? (opcional)"])}
          </label>
          <input
            id="audit-name"
            value={businessName}
            maxLength={80}
            onChange={(event) => setBusinessName(event.target.value)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
          <fieldset className="mt-5">
            <legend className="text-sm text-zinc-300">Tratamiento</legend>
            <div className="mt-2 inline-flex rounded-full border border-white/10 p-1" role="group">
              {(["usted", "tu"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={treatment === option}
                  onClick={() => setTreatment(option)}
                  className={clsx(
                    "rounded-full px-4 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    treatment === option ? "bg-primary text-white" : "text-zinc-300 hover:bg-white/5",
                  )}
                >
                  {option === "usted" ? "Usted" : "Tú"}
                </button>
              ))}
            </div>
          </fieldset>
          <button type="button" onClick={() => setStage("questions")} className={clsx(primaryButton, "mt-8")}>
            {pick(treatment, ["Comenzar", "Comenzar"])}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </button>
          <p className="mt-4 flex items-start gap-2 text-xs text-zinc-400">
            <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {pick(treatment, [
              "Sus respuestas viven solo en esta pantalla: no se guardan ni se envían a nadie. El resultado se basa únicamente en lo que usted declare.",
              "Tus respuestas viven solo en esta pantalla: no se guardan ni se envían a nadie. El resultado se basa únicamente en lo que declares.",
            ])}
          </p>
        </section>
      )}

      {stage === "questions" && dimension && (
        <section aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{`Pregunta ${step + 1} de ${total} · ${DIMENSION_COPY[dimension].label}`}</p>
          <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]" aria-hidden>
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((step + (current ? 1 : 0)) / total) * 100}%` }} />
          </div>
          <h2 className="mt-6 text-xl font-medium">{pick(treatment, DIMENSION_COPY[dimension].prompt)}</h2>
          <div className="mt-4 grid gap-2">
            {MATURITY_LEVELS.map((level) => (
              <button
                key={level}
                type="button"
                aria-pressed={current === level}
                onClick={() => choose(level)}
                className={clsx(
                  "rounded-xl border p-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  current === level ? "border-primary/60 bg-primary/15" : "border-white/10 bg-white/[0.03] hover:border-primary/40 hover:bg-white/5",
                )}
              >
                {DIMENSION_COPY[dimension].options[level]}
              </button>
            ))}
          </div>
          {current && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4" data-testid="reaction">
              <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary-soft" />
              <p className="text-sm text-zinc-100">{DIMENSION_COPY[dimension].reaction[current]}</p>
            </div>
          )}
          <div className="mt-6 flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0} className={secondaryButton}>
              <ArrowLeft aria-hidden className="h-4 w-4" />
              Atrás
            </button>
            <button type="button" onClick={next} disabled={!current} className={primaryButton}>
              {step + 1 >= total ? "Ver mi diagnóstico" : "Continuar"}
              <ArrowRight aria-hidden className="h-4 w-4" />
            </button>
          </div>
        </section>
      )}

      {stage === "analyzing" && (
        <section className="py-16 text-center" role="status" aria-live="polite">
          <Sparkles aria-hidden className="mx-auto h-8 w-8 animate-pulse text-primary-soft" />
          <p className="mt-4 text-lg">{pick(treatment, ["Estoy analizando lo que me contó…", "Estoy analizando lo que me contaste…"])}</p>
        </section>
      )}

      {stage === "report" && isComplete(answers) && <Report answers={answers} pack={pack} treatment={treatment} businessName={businessName} onRestart={restart} />}
    </div>
  );
}

function NexBadge() {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-300">
      <Sparkles aria-hidden className="h-3.5 w-3.5 text-primary-soft" />
      NEX · Business Audit
    </span>
  );
}

function Report({
  answers,
  pack,
  treatment,
  businessName,
  onRestart,
}: {
  answers: AuditAnswers;
  pack: ClientPack;
  treatment: Treatment;
  businessName: string;
  onRestart: () => void;
}) {
  const result = useMemo(() => runAudit(answers), [answers]);
  const summary = useMemo(() => buildSummary(result, { catalog: pack.catalog, treatment, businessName }), [result, pack, treatment, businessName]);

  return (
    <article aria-labelledby="audit-report" className="space-y-8">
      <header>
        <NexBadge />
        <h1 id="audit-report" className="mt-4 text-3xl font-semibold">
          {pick(treatment, ["Este es el diagnóstico de su negocio", "Este es el diagnóstico de tu negocio"])}
        </h1>
        <div className="mt-5 flex items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.03] p-5">
          <div className="text-center">
            <p className="text-5xl font-semibold tabular-nums" aria-label={`Business Score ${result.score} de 100`}>
              {result.score}
            </p>
            <p className="text-xs text-zinc-400">de 100</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-zinc-400">Business Score</p>
            <p className="text-lg font-medium">{BAND_COPY[result.band].label}</p>
            <p className="text-sm text-zinc-300">{INFRASTRUCTURE_COPY[result.infrastructure].label}</p>
          </div>
        </div>
      </header>

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

      <footer className="space-y-3 border-t border-white/10 pt-5">
        <p className="text-xs text-zinc-400">
          Diagnóstico basado únicamente en lo que usted declaró; no se verificó el sitio, las redes ni ningún dato real del negocio. No se guardó nada.
        </p>
        <button type="button" onClick={onRestart} className={secondaryButton}>
          <RotateCcw aria-hidden className="h-4 w-4" />
          Repetir el diagnóstico
        </button>
      </footer>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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
