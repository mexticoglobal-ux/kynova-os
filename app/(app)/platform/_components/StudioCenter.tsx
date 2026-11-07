"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { newStudioState, reduceStudio, type Kind, type StudioEvent, type StudioState } from "@/lib/contracts/platform/studio-center";
import { DEMO_PERSONAS, DEMO_TENANTS, demoStudioEnv, demoStudioState } from "@/lib/contracts/platform/studio-demo";
import { label } from "@/lib/contracts/platform/studio-messages";
import { DashboardTab, HistoryTab, LibraryTab, TemplatesTab } from "./StudioTabs";
import { BuilderTab, PlaygroundTab } from "./StudioBuilder";

const TAB_KEYS = ["dashboard", "prompts", "agents", "builder", "playground", "history", "templates"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<StudioEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
export type BuilderTarget = { assetId?: string; kind: Kind };
export type StudioTabProps = {
  state: StudioState; send: (event: UiEvent) => string | undefined; persona: Persona; env: ReturnType<typeof demoStudioEnv>; tenantName: (id: string) => string;
  edit: (target: BuilderTarget) => void; test: (assetId: string, version?: number) => void; testTarget: { assetId?: string; version?: number };
};

// Local simulation only: no model and no provider. Every test goes through KOE (its Worker, its model choice), and nothing leaves the platform.
export function StudioCenter() {
  const store = useRef<StudioState>(newStudioState());
  const env = useRef(demoStudioEnv());
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);
  const [builder, setBuilder] = useState<BuilderTarget>({ kind: "prompt" });
  const [testTarget, setTestTarget] = useState<{ assetId?: string; version?: number }>({});

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const send = (event: UiEvent): string | undefined => {
    const result = reduceStudio(store.current, { at: new Date().toISOString(), ...event, tenantId: persona.tenantId, actor: persona.actor } as StudioEvent, env.current);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
    return result.error;
  };
  const loadDemo = () => {
    const result = demoStudioState(env.current);
    store.current = result.state;
    setMessage(result.errors[0] ?? null);
    setVersion((value) => value + 1);
  };
  const tenantName = (id: string) => DEMO_TENANTS.find((tenant) => tenant.id === id)?.name ?? id;
  const edit = (target: BuilderTarget) => { setBuilder(target); setTab("builder"); setMessage(null); };
  const test = (assetId: string, version?: number) => { setTestTarget({ assetId, version }); setTab("playground"); setMessage(null); };
  const props: StudioTabProps = { state, send, persona, env: env.current, tenantName, edit, test, testTarget };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: ningún modelo ni proveedor. Studio solo guarda configuraciones y pruebas; cada prueba pasa por KOE, que elige el Worker, y el Worker el modelo. NEX solo deja borradores y publicar lo decide una persona.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Actuar como
            <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); }}>
              {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <Button size="sm" variant="secondary" disabled={state.assets.length > 0} onClick={loadDemo}>Cargar datos de ejemplo</Button>
        </div>
      </div>

      <div role="tablist" aria-label="AI Studio" className="flex flex-wrap gap-1.5">
        {TAB_KEYS.map((key) => (
          <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => { setTab(key); setMessage(null); }} className={tab === key ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}>
            {label("tabs", key)}
          </button>
        ))}
      </div>

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "dashboard" && <DashboardTab {...props} />}
        {tab === "prompts" && <LibraryTab {...props} kind="prompt" />}
        {tab === "agents" && <LibraryTab {...props} kind="agent" />}
        {tab === "builder" && <BuilderTab key={`${builder.assetId ?? "new"}-${builder.kind}`} {...props} target={builder} />}
        {tab === "playground" && <PlaygroundTab key={`${testTarget.assetId ?? "none"}-${testTarget.version ?? 0}`} {...props} />}
        {tab === "history" && <HistoryTab {...props} />}
        {tab === "templates" && <TemplatesTab {...props} />}
      </div>
    </div>
  );
}
