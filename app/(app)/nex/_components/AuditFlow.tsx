"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, CheckCircle2, RotateCcw, ShieldCheck, Sparkles } from "lucide-react";
import { AUDIT_DIMENSIONS, type AuditAnswers, type MaturityLevel, MATURITY_LEVELS } from "@/lib/contracts/audit";
import { runAudit } from "@/lib/audit";
import { buildSummary } from "@/lib/audit-summary";
import { ANALYSIS_STEPS, DIMENSION_COPY, pick, type Treatment } from "@/lib/audit-copy";
import type { ClientPack } from "@/lib/audit-packs/nova-draft";
import { NexBadge, ScoreCard, SummaryView } from "./AuditParts";
import { buttonClass } from "@/components/ui/Button";
import { choiceClass } from "@/components/ui/choice";

type Draft = Partial<AuditAnswers>;
type Stage = "intro" | "questions" | "analyzing" | "report";

const isComplete = (draft: Draft): draft is AuditAnswers => AUDIT_DIMENSIONS.every((dimension) => draft[dimension] !== undefined);

const primaryButton = buttonClass("primary", "md", "px-5");
const secondaryButton = buttonClass("secondary");

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

  // NEX narrates what it is doing, one line at a time. Each line describes something the engine really does.
  const [working, setWorking] = useState(0);
  useEffect(() => {
    if (stage !== "analyzing") return;
    if (analysisMs <= 0) {
      setStage("report");
      return;
    }
    const interval = window.setInterval(() => setWorking((index) => index + 1), analysisMs / ANALYSIS_STEPS.length);
    return () => window.clearInterval(interval);
  }, [stage, analysisMs]);
  useEffect(() => {
    if (stage === "analyzing" && working >= ANALYSIS_STEPS.length) setStage("report");
  }, [stage, working]);

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
    setWorking(0);
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
          <p className="mt-3 text-ink-soft">
            {pick(treatment, [
              `Soy NEX, el asistente de ${pack.brand}. Le haré ${total} preguntas breves, de unos dos minutos, para entender en qué punto está su negocio y qué le conviene hacer primero.`,
              `Soy NEX, el asistente de ${pack.brand}. Te haré ${total} preguntas breves, de unos dos minutos, para entender en qué punto está tu negocio y qué te conviene hacer primero.`,
            ])}
          </p>
          <label className="mt-6 block text-sm text-ink-soft" htmlFor="audit-name">
            {pick(treatment, ["¿Cómo se llama su negocio? (opcional)", "¿Cómo se llama tu negocio? (opcional)"])}
          </label>
          <input
            id="audit-name"
            value={businessName}
            maxLength={80}
            onChange={(event) => setBusinessName(event.target.value)}
            className="field mt-2"
          />
          <fieldset className="mt-5">
            <legend className="text-sm text-ink-soft">Tratamiento</legend>
            <div className="mt-2 inline-flex rounded-full border border-line p-1" role="group">
              {(["usted", "tu"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={treatment === option}
                  onClick={() => setTreatment(option)}
                  className={clsx(
                    "rounded-full px-4 py-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    treatment === option ? "bg-primary text-on-primary" : "text-ink-soft hover:bg-raised",
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
          <p className="mt-4 flex items-start gap-2 text-xs text-ink-muted">
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
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">{`Pregunta ${step + 1} de ${total} · ${DIMENSION_COPY[dimension].label}`}</p>
          <div className="mt-2 h-1.5 rounded-full bg-raised" aria-hidden>
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
                className={choiceClass(current === level)}
              >
                {DIMENSION_COPY[dimension].options[level]}
              </button>
            ))}
          </div>
          {current && (
            <div className="mt-5 flex items-start gap-3 rounded-2xl border border-primary/30 bg-primary/10 p-4" data-testid="reaction">
              <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary-soft" />
              <p className="text-sm text-ink">{DIMENSION_COPY[dimension].reaction[current]}</p>
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
        <section className="py-12" role="status" aria-live="polite">
          <Sparkles aria-hidden className="h-8 w-8 animate-pulse text-primary-soft" />
          <ul className="mt-5 grid gap-3">
            {ANALYSIS_STEPS.slice(0, Math.min(working + 1, ANALYSIS_STEPS.length)).map((line, index) => (
              <li key={line[0]} className={clsx("flex items-center gap-2 text-sm", index < working ? "text-ink-muted" : "text-ink")}>
                {index < working ? <CheckCircle2 aria-hidden className="h-4 w-4 text-primary-soft" /> : <span aria-hidden className="h-4 w-4 animate-pulse rounded-full bg-primary/60" />}
                {pick(treatment, line)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {stage === "report" && isComplete(answers) && <Report answers={answers} pack={pack} treatment={treatment} businessName={businessName} onRestart={restart} />}
    </div>
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
        <div className="mt-5">
          <ScoreCard result={result} status={summary.status} />
        </div>
      </header>

      <SummaryView summary={summary} pack={pack} treatment={treatment} />

      <footer className="space-y-3 border-t border-line pt-5">
        <p className="text-xs text-ink-muted">
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
