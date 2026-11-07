"use client";

import { useRef, useState } from "react";
import { reduceCrm, type CrmEvent, type CrmState } from "@/lib/contracts/platform/crm-center";
import { DEMO_NOW, DEMO_PERSONAS, demoCrmOk } from "@/lib/contracts/platform/crm-demo";
import { label } from "@/lib/contracts/platform/crm-messages";
import { AssistantTab, DashboardTab, OpportunityTab, PipelineTab } from "./CrmViews";
import { CustomerTab, TasksTab, TimelineTab } from "./CrmCustomer";

const TAB_KEYS = ["dashboard", "pipeline", "opportunity", "timeline", "tasks", "customer", "assistant"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<CrmEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
export type CrmTabProps = {
  state: CrmState; asOf: string; persona: Persona; selected: string; select: (id: string, tab?: TabKey) => void; message: string | null;
  send: (event: UiEvent) => string | undefined; sendAsPlatform: (event: UiEvent) => string | undefined;
};

// Local simulation only. Every score, probability, risk and recommendation comes from KOE's one CRM module (koe-crm.ts); this screen
// only shows it and records what a person decides. Nothing is sent, called, moved or closed on its own.
export function CrmCenter() {
  const store = useRef<CrmState>(demoCrmOk());
  const clock = useRef(Date.parse(DEMO_NOW)); // the simulation's own clock: each action moves it a minute, so everything stays consistent
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const run = (event: UiEvent, actor: string): string | undefined => {
    clock.current += 60_000;
    const result = reduceCrm(store.current, { at: new Date(clock.current).toISOString(), ...event, tenantId: persona.tenantId, actor } as CrmEvent);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
    return result.error;
  };
  const send = (event: UiEvent) => run(event, persona.actor);
  const sendAsPlatform = (event: UiEvent) => run(event, "system"); // simulates what the platform reports (a Business Audit result, a link from another module)
  const select = (id: string, next?: TabKey) => { setSelected(id); if (next) { setTab(next); setMessage(null); } };
  const asOf = new Date(clock.current).toISOString();
  const props: CrmTabProps = { state, asOf, persona, selected, select, message, send, sendAsPlatform };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: sin modelos ni llamadas reales. KOE analiza y recomienda; NEX solo prepara propuestas y borradores. Cerrar una venta, convertir un cliente y aceptar una tarea siempre lo decide una persona.</p>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Actuar como
          <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); setSelected(""); }}>
            {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>

      <div role="tablist" aria-label="CRM inteligente" className="flex flex-wrap gap-1.5">
        {TAB_KEYS.map((key) => (
          <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => { setTab(key); setMessage(null); }} className={tab === key ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}>
            {label("tabs", key)}
          </button>
        ))}
      </div>

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "dashboard" && <DashboardTab {...props} />}
        {tab === "pipeline" && <PipelineTab {...props} />}
        {tab === "opportunity" && <OpportunityTab {...props} />}
        {tab === "timeline" && <TimelineTab {...props} />}
        {tab === "tasks" && <TasksTab {...props} />}
        {tab === "customer" && <CustomerTab {...props} />}
        {tab === "assistant" && <AssistantTab {...props} />}
      </div>
    </div>
  );
}
