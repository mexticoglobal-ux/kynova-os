"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { CheckCircle2, RotateCcw, Send, ShieldCheck, Sparkles } from "lucide-react";
import { DIMENSION_COPY, pick, type Treatment } from "@/lib/audit-copy";
import type { ClientPack } from "@/lib/audit-packs/nova-draft";
import { advance, greeting, initialState, promptFor, validate, type ChatState, type Handoff, type Route, type Say } from "@/lib/guided-chat";
import { BAND_COPY } from "@/lib/audit-copy";
import { NexBadge, ScoreCard, SummaryView } from "./AuditParts";

type Item = { id: number; from: "nex" | "user"; say?: Say; text?: string };

const ROUTE_LABEL: Record<Route, string> = {
  hot: "Prospecto caliente: contactar cuanto antes",
  warm: "Prospecto tibio: proponer una llamada",
  cold: "Prospecto frío: enviar información útil",
  human: "Lo atiende una persona",
};

const METHOD_NAME = { email: "Correo", whatsapp: "WhatsApp", phone: "Teléfono" } as const;

// Pace of NEX's messages, so the conversation reads like someone working and not like a page that appears at once.
const DELAY: Record<Say["kind"], number> = { text: 650, reaction: 800, working: 900, result: 1000, handoff: 800 };

// Guided chat v1. Everything lives in this component's state: nothing is stored or sent anywhere.
export function GuidedChat({ pack, treatment = pack.defaultTreatment, paceMs = 1 }: { pack: ClientPack; treatment?: Treatment; paceMs?: number }) {
  const [state, setState] = useState<ChatState>(() => initialState(treatment));
  const [items, setItems] = useState<Item[]>([]);
  const [queue, setQueue] = useState<Say[]>(() => greeting(pack, treatment));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  // Plays NEX's queued messages one at a time.
  useEffect(() => {
    if (queue.length === 0) return;
    const [head, ...rest] = queue;
    const timer = window.setTimeout(() => {
      setItems((current) => [...current, { id: nextId.current++, from: "nex", say: head }]);
      setQueue(rest);
    }, DELAY[head.kind] * paceMs);
    return () => window.clearTimeout(timer);
  }, [queue, paceMs]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [items, queue.length]);

  const busy = queue.length > 0;
  const prompt = busy ? null : promptFor(state);

  function submit(label: string, value: string) {
    const result = advance(state, value, pack);
    if (result.state === state && result.say.length === 0) return;
    setItems((current) => (label === "" ? current : [...current, { id: nextId.current++, from: "user", text: label }]));
    setState(result.state);
    setQueue(result.say);
    setDraft("");
    setError(null);
  }

  function submitText(event: React.FormEvent) {
    event.preventDefault();
    const problem = validate(state, draft);
    if (problem) return setError(problem);
    submit(draft.trim() || pick(treatment, ["Prefiero omitirlo", "Prefiero omitirlo"]), draft.trim());
  }

  function restart() {
    setState(initialState(treatment));
    setItems([]);
    setQueue(greeting(pack, treatment));
    setDraft("");
    setError(null);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col px-4 py-6 sm:px-6">
      <header className="mb-4 space-y-2">
        <NexBadge label={`NEX · ${pack.brand}`} />
        <p className="flex items-start gap-2 text-xs text-zinc-400">
          <ShieldCheck aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Demostración: asistente automático con respuestas preparadas. No se guarda ni se envía nada.
        </p>
      </header>

      <ol className="space-y-3" aria-live="polite" aria-label="Conversación con NEX">
        {items.map((item, index) => (
          <li key={item.id} className={clsx("flex", item.from === "user" ? "justify-end" : "justify-start")}>
            {item.from === "user" || !item.say ? (
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-white">{item.text}</p>
            ) : (
              <NexMessage say={item.say} pack={pack} treatment={treatment} done={index < items.length - 1 || queue.length > 0} />
            )}
          </li>
        ))}
        {busy && (
          <li className="flex" role="status" aria-label="NEX está escribiendo">
            <span className="inline-flex gap-1 rounded-2xl rounded-bl-md bg-white/[0.06] px-4 py-3" aria-hidden>
              {[0, 1, 2].map((dot) => (
                <span key={dot} className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" style={{ animationDelay: `${dot * 150}ms` }} />
              ))}
            </span>
          </li>
        )}
      </ol>

      <div className="mt-4">
        {prompt?.kind === "choice" && (
          <div className="grid gap-2" role="group" aria-label="Opciones de respuesta">
            {prompt.options.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => submit(option.label, option.id)}
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left text-sm transition hover:border-primary/40 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {prompt?.kind === "text" && (
          <form onSubmit={submitText} noValidate className="space-y-2">
            <label htmlFor="guided-input" className="text-sm text-zinc-300">
              {prompt.label}
            </label>
            <div className="flex gap-2">
              <input
                id="guided-input"
                type={prompt.inputType}
                value={draft}
                maxLength={prompt.maxLength + 1}
                onChange={(event) => setDraft(event.target.value)}
                autoFocus
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <button type="submit" className="inline-flex items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft">
                <Send aria-hidden className="h-4 w-4" />
                Enviar
              </button>
            </div>
            {prompt.optional && (
              <button type="button" onClick={() => submit("Prefiero omitirlo", "")} className="text-sm text-zinc-400 underline-offset-2 hover:underline">
                Omitir
              </button>
            )}
            {error && (
              <p role="alert" className="text-sm text-amber-300">
                {error}
              </p>
            )}
          </form>
        )}
        {prompt?.kind === "end" && (
          <button
            type="button"
            onClick={restart}
            className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <RotateCcw aria-hidden className="h-4 w-4" />
            Empezar de nuevo
          </button>
        )}
      </div>
      <div ref={endRef} />
    </div>
  );
}

function NexMessage({ say, pack, treatment, done }: { say: Say; pack: ClientPack; treatment: Treatment; done: boolean }) {
  switch (say.kind) {
    case "text":
      return <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-white/[0.06] px-4 py-2.5 text-sm text-zinc-100">{say.text}</p>;
    case "reaction":
      return (
        <p className="flex max-w-[85%] items-start gap-2 rounded-2xl rounded-bl-md border border-primary/30 bg-primary/10 px-4 py-2.5 text-sm text-zinc-100" data-testid="reaction">
          <Sparkles aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary-soft" />
          {say.text}
        </p>
      );
    case "working":
      return (
        <p className={clsx("flex items-center gap-2 px-1 text-sm", done ? "text-zinc-400" : "text-zinc-100")} data-testid="working">
          {done ? <CheckCircle2 aria-hidden className="h-4 w-4 text-primary-soft" /> : <span aria-hidden className="h-3 w-3 animate-pulse rounded-full bg-primary/70" />}
          {say.text}
        </p>
      );
    case "result":
      return (
        <div className="w-full space-y-6 rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5" data-testid="result">
          <ScoreCard result={{ version: 1, basis: "selfReported", score: say.score, band: say.band, infrastructure: say.infrastructure, gaps: [], strengths: [] }} status={say.status} />
          <SummaryView summary={say.summary} pack={pack} treatment={treatment} />
          <p className="text-xs text-zinc-400">Diagnóstico basado únicamente en lo que usted declaró; no se verificó ningún dato real del negocio.</p>
        </div>
      );
    case "handoff":
      return <HandoffCard handoff={say.handoff} pack={pack} />;
  }
}

function HandoffCard({ handoff, pack }: { handoff: Handoff; pack: ClientPack }) {
  const rows: [string, string][] = [["Qué hacer", handoff.nextStep], ["Por qué", handoff.reasons.join(" ")]];
  if (handoff.contact) rows.push(["Contacto", `${handoff.contact.name ?? ""} · ${METHOD_NAME[handoff.contact.method]}: ${handoff.contact.value}`]);
  if (handoff.business.name) rows.push(["Negocio", handoff.business.name]);
  if (handoff.business.challenge) rows.push(["Prioridad", handoff.business.challenge]);
  if (handoff.question) rows.push(["Pregunta", handoff.question]);
  if (handoff.audit) {
    rows.push(["Business Score", `${handoff.audit.score} / 100 · ${BAND_COPY[handoff.audit.band].label}`]);
    rows.push(["Principales brechas", handoff.audit.topGaps.map((gap) => DIMENSION_COPY[gap].label).join(", ") || "Ninguna importante"]);
  }
  if (handoff.services.length > 0) rows.push(["Servicios sugeridos", handoff.services.map((id) => pack.services[id]?.name ?? id).join(", ")]);
  if (handoff.qualification) rows.push(["Calificación", `${handoff.qualification.points} puntos`]);

  return (
    <section className="w-full rounded-2xl border border-primary/30 bg-primary/10 p-4" data-testid="handoff" aria-label="Traspaso para el equipo">
      <p className="text-xs uppercase tracking-wide text-primary-soft">{`Traspaso para ${pack.brand}`}</p>
      <h3 className="mt-1 font-medium">{ROUTE_LABEL[handoff.route]}</h3>
      <dl className="mt-3 grid gap-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3">
            <dt className="text-zinc-400">{label}</dt>
            <dd className="text-zinc-100">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
