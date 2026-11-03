"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { ArrowLeft, ArrowRight, ClipboardList, RotateCcw, X } from "lucide-react";
import {
  ASSESSMENT_OPTIONS,
  ASSESSMENT_QUESTIONS,
  type AssessmentAnswers,
  type AssessmentQuestion,
} from "@/lib/contracts/assessment";
import { recommendModules } from "@/lib/assessment";
import { useI18n } from "@/components/i18n/I18nProvider";
import { NAV_ICONS } from "@/components/shell/nav-icons";

type Draft = Partial<AssessmentAnswers>;

function isComplete(draft: Draft): draft is AssessmentAnswers {
  return ASSESSMENT_QUESTIONS.every((question) => draft[question] !== undefined);
}

// Answers live only in this component's state: nothing is written to any storage (Business Assessment v0).
export function AssessmentFlow({ onExit }: { onExit: () => void }) {
  const { m } = useI18n();
  const copy = m.nex.assessment;
  const [step, setStep] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // Each question and the result start at the top of NEX's scroll area (not the page), keeping the answers.
  useEffect(() => {
    const scroller = rootRef.current?.closest<HTMLElement>("[data-nex-scroll]");
    if (scroller) scroller.scrollTop = 0;
  }, [step]);
  const [answers, setAnswers] = useState<Draft>({});
  const total = ASSESSMENT_QUESTIONS.length;
  const question = ASSESSMENT_QUESTIONS[step];

  const optionLabel = (q: AssessmentQuestion, option: string) => (copy.options[q] as Record<string, string>)[option] ?? option;

  function choose(q: AssessmentQuestion, option: string) {
    setAnswers((current) => ({ ...current, [q]: option }));
    setStep((current) => current + 1);
  }

  function restart() {
    setAnswers({});
    setStep(0);
  }

  const secondaryButton =
    "inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40";

  return (
    <div ref={rootRef} className="mx-auto max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-400">
            <ClipboardList aria-hidden className="h-3.5 w-3.5 text-primary" />
            {copy.notice}
          </span>
          <h2 className="mt-3 text-2xl font-semibold">{copy.title}</h2>
        </div>
        <button type="button" onClick={onExit} aria-label={copy.exit} className="rounded-xl p-2 text-zinc-300 hover:bg-white/5">
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>

      {question && (
        <section className="mt-6" aria-live="polite">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">
            {copy.progress.replace("{current}", String(step + 1)).replace("{total}", String(total))}
          </p>
          <div className="mt-2 h-1.5 rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(step / total) * 100}%` }} />
          </div>
          <h3 className="mt-6 text-lg font-medium">{copy.questions[question]}</h3>
          <div className="mt-4 grid gap-2">
            {ASSESSMENT_OPTIONS[question].map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={answers[question] === option}
                onClick={() => choose(question, option)}
                className={clsx(
                  "rounded-xl border p-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  answers[question] === option
                    ? "border-primary/60 bg-primary/15"
                    : "border-white/10 bg-white/[0.03] hover:border-primary/40 hover:bg-white/5",
                )}
              >
                {optionLabel(question, option)}
              </button>
            ))}
          </div>
        </section>
      )}

      {!question && isComplete(answers) && (
        <section className="mt-6 space-y-6" aria-live="polite">
          <div>
            <h3 className="text-lg font-medium">{copy.resultTitle}</h3>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              {ASSESSMENT_QUESTIONS.map((q) => (
                <div key={q} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <dt className="text-xs text-zinc-400">{copy.labels[q]}</dt>
                  <dd className="mt-1">{optionLabel(q, answers[q])}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3 className="text-lg font-medium">{copy.recommendedTitle}</h3>
            <ul className="mt-3 grid gap-2">
              {recommendModules(answers).map(({ module, basedOn }) => {
                const Icon = NAV_ICONS[module];
                return (
                  <li key={module}>
                    <Link
                      href={`/${module}`}
                      className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 transition hover:border-primary/40 hover:bg-white/5"
                    >
                      <Icon aria-hidden className="h-5 w-5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{m.nav[module]}</span>
                        <span className="block text-xs text-zinc-400">
                          {copy.basedOn}{" "}
                          {basedOn.map(({ question, option }) => `${copy.labels[question]}: ${optionLabel(question, option)}`).join(" · ")}
                        </span>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm text-primary-soft">
                        {copy.open}
                        <ArrowRight aria-hidden className="h-4 w-4" />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-zinc-400">{copy.demoNote}</p>
          </div>
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0} className={secondaryButton}>
          <ArrowLeft aria-hidden className="h-4 w-4" />
          {copy.back}
        </button>
        <button type="button" onClick={restart} className={secondaryButton}>
          <RotateCcw aria-hidden className="h-4 w-4" />
          {copy.restart}
        </button>
      </div>
    </div>
  );
}
