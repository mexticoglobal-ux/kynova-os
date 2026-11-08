"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isAdmin, newKoeState, reduceKoe, workerActor, type KoeEvent, type KoeState } from "@/lib/contracts/platform/koe-engine";
import { DEMO_ADMINS, DEMO_PERSONAS, DEMO_TENANTS, demoKoeState } from "@/lib/contracts/platform/koe-demo";
import { label } from "@/lib/contracts/platform/koe-messages";
import { ActivityTab, MemoryTab, ModelsTab, WorkersTab } from "./WorkersTabs";
import { RunsTab } from "./WorkersRuns";
import { BuilderTab } from "./WorkerBuilder";
import { Tabs } from "@/components/ui/Tabs";

const TAB_KEYS = ["workers", "runs", "models", "memory", "build", "activity"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<KoeEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
// `asWorker` takes the step AS that Worker (the engine only lets a run's own Worker move it); it returns the refusal, if any.
export type WorkersTabProps = { state: KoeState; send: (event: UiEvent, asWorker?: string) => string | undefined; persona: Persona; admin: boolean; tenantName: (id: string) => string };

// Local simulation only: no model, no tool, no network. The same engine will run on the server, reaching models through lib/ai/.
export function WorkersCenter() {
  const store = useRef<KoeState>(newKoeState(DEMO_ADMINS));
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("workers");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const send = (event: UiEvent, asWorker?: string): string | undefined => {
    const actor = asWorker ? workerActor(asWorker) : persona.actor;
    const result = reduceKoe(store.current, { at: new Date().toISOString(), ...event, tenantId: persona.tenantId, actor } as KoeEvent);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
    return result.error;
  };
  const loadDemo = () => {
    const result = demoKoeState();
    store.current = result.state;
    setMessage(result.errors[0] ?? null);
    setVersion((value) => value + 1);
  };
  const tenantName = (id: string) => DEMO_TENANTS.find((tenant) => tenant.id === id)?.name ?? id;
  const admin = isAdmin(state, persona.actor);
  const props: WorkersTabProps = { state, send, persona, admin, tenantName };
  const tenantPaused = state.pausedTenants.includes(persona.tenantId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: sin modelos ni herramientas reales. Los niveles de autonomía los decide el código; lo que sale de la plataforma o mueve dinero espera a una persona.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Actuar como
            <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); }}>
              {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <Button size="sm" variant="secondary" disabled={state.instances.length > 0} onClick={loadDemo}>Cargar datos de ejemplo</Button>
        </div>
      </div>

      {(state.platformPaused || tenantPaused) && (
        <p role="status" className="rounded-xl bg-warning/15 px-3 py-2 text-sm text-warning">
          {state.platformPaused ? "Todos los Workers de la plataforma están detenidos." : "Los Workers de su empresa están detenidos."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tenantPaused ? "primary" : "ghost"} onClick={() => send({ type: "tenant.pause", paused: !tenantPaused })}>{tenantPaused ? "Reanudar los Workers de mi empresa" : "Detener todos los Workers de mi empresa"}</Button>
        {admin && <Button size="sm" variant={state.platformPaused ? "primary" : "ghost"} onClick={() => send({ type: "platform.pause", paused: !state.platformPaused })}>{state.platformPaused ? "Reanudar la plataforma" : "Detener toda la plataforma"}</Button>}
      </div>

      <Tabs label="NEX Workers" items={TAB_KEYS.map((key) => ({ key, label: label("tabs", key) }))} value={tab} onChange={(key) => { setTab(key); setMessage(null); }} />

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "workers" && <WorkersTab {...props} />}
        {tab === "runs" && <RunsTab {...props} />}
        {tab === "models" && <ModelsTab {...props} />}
        {tab === "memory" && <MemoryTab {...props} />}
        {tab === "build" && <BuilderTab {...props} />}
        {tab === "activity" && <ActivityTab {...props} />}
      </div>
    </div>
  );
}
