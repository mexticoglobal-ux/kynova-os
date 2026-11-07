"use client";

import { useRef, useState } from "react";
import { reduceComms, type CommsEvent, type CommsState } from "@/lib/contracts/platform/comms-center";
import { DEMO_NOW, DEMO_PERSONAS, demoCommsOk } from "@/lib/contracts/platform/comms-demo";
import { label } from "@/lib/contracts/platform/comms-messages";
import { AssignmentsTab, DraftsTab } from "./CommsDrafts";
import { ConversationTab, InboxTab, IntelligenceTab, TimelineTab } from "./CommsViews";

const TAB_KEYS = ["inbox", "conversation", "timeline", "drafts", "assignments", "intelligence"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<CommsEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
export type CommsTabProps = {
  state: CommsState; env: ReturnType<typeof demoCommsOk>["env"]; asOf: string; persona: Persona; selected: string; select: (id: string, tab?: TabKey) => void;
  send: (event: UiEvent) => string | undefined; sendAsPlatform: (event: UiEvent) => string | undefined;
};

// Local simulation only. Every urgency, sentiment, intent, routing decision and draft comes from KOE's one communications module
// (koe-comms.ts); this screen only shows it and records what a person decides. No message is ever sent, and no provider is ever reached.
export function CommsCenter() {
  const source = useRef(demoCommsOk());
  const store = useRef<CommsState>(source.current.state);
  const clock = useRef(Date.parse(DEMO_NOW)); // the simulation's own clock: each action moves it a minute
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("inbox");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const run = (event: UiEvent, actor: string): string | undefined => {
    clock.current += 60_000;
    const result = reduceComms(store.current, { at: new Date(clock.current).toISOString(), ...event, tenantId: persona.tenantId, actor } as CommsEvent, source.current.env);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
    return result.error;
  };
  const send = (event: UiEvent) => run(event, persona.actor);
  const sendAsPlatform = (event: UiEvent) => run(event, "system"); // simulates what arrives through the platform: a customer's message, a Worker's report
  const select = (id: string, next?: TabKey) => { setSelected(id); if (next) { setTab(next); setMessage(null); } };
  const props: CommsTabProps = { state, env: source.current.env, asOf: new Date(clock.current).toISOString(), persona, selected, select, send, sendAsPlatform };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: no se envía ningún mensaje ni se conecta ningún proveedor. KOE entiende, enruta y recomienda; NEX solo prepara borradores. Enviar, resolver y archivar lo decide siempre una persona.</p>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Actuar como
          <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); setSelected(""); }}>
            {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>

      <div role="tablist" aria-label="Centro de comunicaciones" className="flex flex-wrap gap-1.5">
        {TAB_KEYS.map((key) => (
          <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => { setTab(key); setMessage(null); }} className={tab === key ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}>
            {label("tabs", key)}
          </button>
        ))}
      </div>

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "inbox" && <InboxTab {...props} />}
        {tab === "conversation" && <ConversationTab {...props} />}
        {tab === "timeline" && <TimelineTab {...props} />}
        {tab === "drafts" && <DraftsTab {...props} />}
        {tab === "assignments" && <AssignmentsTab {...props} />}
        {tab === "intelligence" && <IntelligenceTab {...props} />}
      </div>
    </div>
  );
}
