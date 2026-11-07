"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { newAutomationState, reduceAutomations, type AutomationEvent, type AutomationState } from "@/lib/contracts/platform/automation-center";
import { DEMO_PERSONAS, DEMO_TENANTS, demoAutomationState } from "@/lib/contracts/platform/automation-demo";
import { label } from "@/lib/contracts/platform/automation-messages";
import { ActivityTab, BuilderTab, ListTab, ResultsTab, SimulateTab } from "./AutomationsTabs";

const TAB_KEYS = ["list", "build", "simulate", "results", "activity"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<AutomationEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
export type AutomationsTabProps = {
  state: AutomationState; send: (event: UiEvent) => string | undefined; persona: Persona; tenantName: (id: string) => string;
  edit: (id: string | null) => void; editingId: string | null;
};

// Local simulation only: nothing is sent, nothing leaves the platform. The same reducer will run on the server.
export function AutomationsCenter() {
  const store = useRef<AutomationState>(newAutomationState());
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("list");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const send = (event: UiEvent): string | undefined => {
    const result = reduceAutomations(store.current, { at: new Date().toISOString(), ...event, tenantId: persona.tenantId, actor: persona.actor } as AutomationEvent);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
    return result.error;
  };
  const loadDemo = () => {
    const result = demoAutomationState();
    store.current = result.state;
    setMessage(result.errors[0] ?? null);
    setEditingId(null);
    setVersion((value) => value + 1);
  };
  const tenantName = (id: string) => DEMO_TENANTS.find((tenant) => tenant.id === id)?.name ?? id;
  const edit = (id: string | null) => { setEditingId(id); setTab("build"); setMessage(null); };
  const tenantPaused = state.pausedTenants.includes(persona.tenantId);
  const props: AutomationsTabProps = { state, send, persona, tenantName, edit, editingId };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: nada se envía ni sale de la plataforma. Las automatizaciones solo preparan tareas, avisos y borradores; una persona decide qué hacer con ellos.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Actuar como
            <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); setEditingId(null); }}>
              {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <Button size="sm" variant="secondary" disabled={state.automations.length > 0} onClick={loadDemo}>Cargar datos de ejemplo</Button>
        </div>
      </div>

      {tenantPaused && <p role="status" className="rounded-xl bg-warning/15 px-3 py-2 text-sm text-warning">Las automatizaciones de su empresa están detenidas.</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tenantPaused ? "primary" : "ghost"} onClick={() => send({ type: "automation.killSwitch", paused: !tenantPaused })}>
          {tenantPaused ? "Reanudar las automatizaciones de mi empresa" : "Detener todas las automatizaciones de mi empresa"}
        </Button>
      </div>

      <div role="tablist" aria-label="Automatizaciones" className="flex flex-wrap gap-1.5">
        {TAB_KEYS.map((key) => (
          <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => { setTab(key); setMessage(null); }} className={tab === key ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}>
            {label("tabs", key)}
          </button>
        ))}
      </div>

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "list" && <ListTab {...props} />}
        {tab === "build" && <BuilderTab key={editingId ?? "new"} {...props} />}
        {tab === "simulate" && <SimulateTab {...props} />}
        {tab === "results" && <ResultsTab {...props} />}
        {tab === "activity" && <ActivityTab {...props} />}
      </div>
    </div>
  );
}
