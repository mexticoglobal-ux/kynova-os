"use client";

import { useRef, useState } from "react";
import { reduceDev, type DevEvent, type DevState, type Reveal } from "@/lib/contracts/platform/dev-center";
import { DEMO_NOW, DEMO_PERSONAS, demoDevOk } from "@/lib/contracts/platform/dev-demo";
import { label } from "@/lib/contracts/platform/dev-messages";
import { AppsTab, ExplorerTab, LogsTab, SandboxTab, SdkTab } from "./DevBuild";
import { DashboardTab, KeysTab, WebhooksTab } from "./DevViews";
import { Tabs } from "@/components/ui/Tabs";

const TAB_KEYS = ["dashboard", "keys", "webhooks", "sandbox", "logs", "apps", "explorer", "sdk"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<DevEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
export type DevTabProps = {
  state: DevState; env: ReturnType<typeof demoDevOk>["env"]; asOf: string; persona: Persona;
  send: (event: UiEvent) => string | undefined; sendAsPlatform: (event: UiEvent) => string | undefined;
};

// Local simulation only. Every figure (rate limits, consumption, the answer to a request, a delivery, a recommendation) comes from KOE's one developer
// module (koe-dev.ts); this screen only shows it and records what a person decides. No API, OAuth, webhook or SDK is ever reached, and the credentials
// are simulated. A secret is shown once, right after it is created, and is never kept.
export function DevCenter() {
  const source = useRef(demoDevOk());
  const store = useRef<DevState>(source.current.state);
  const clock = useRef(Date.parse(DEMO_NOW)); // the simulation's own clock: each action moves it a minute
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);
  const [reveal, setReveal] = useState<Reveal | null>(null);

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const run = (event: UiEvent, actor: string): string | undefined => {
    clock.current += 60_000;
    const result = reduceDev(store.current, { at: new Date(clock.current).toISOString(), ...event, tenantId: persona.tenantId, actor } as DevEvent, source.current.env);
    store.current = result.state;
    setMessage(result.error ?? null);
    setReveal(result.reveal ?? null); // the secret lives only here, until the next action
    setVersion((value) => value + 1);
    return result.error;
  };
  const send = (event: UiEvent) => run(event, persona.actor);
  const sendAsPlatform = (event: UiEvent) => run(event, "system"); // simulates what the platform reports: a key that reached its date
  const props: DevTabProps = { state, env: source.current.env, asOf: new Date(clock.current).toISOString(), persona, send, sendAsPlatform };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: no hay API, OAuth, webhooks ni SDK reales, y las credenciales son simuladas. KOE calcula los límites, el consumo y las respuestas; NEX solo prepara propuestas. Crear credenciales, activar apps, publicar y borrar logs lo decide siempre una persona.</p>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Actuar como
          <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); setReveal(null); }}>
            {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>

      <Tabs label="Plataforma para desarrolladores" items={TAB_KEYS.map((key) => ({ key, label: label("tabs", key) }))} value={tab} onChange={(key) => { setTab(key); setMessage(null); setReveal(null); }} />

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}
      {reveal && (
        <div role="status" aria-label="Secreto creado" className="space-y-1 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          <p className="font-medium">{reveal.kind === "apiKey" ? "Nueva API Key (simulada)" : "Secreto de firma del webhook (simulado)"} · {reveal.id}</p>
          <p className="break-all font-mono text-xs">{reveal.secret}</p>
          <p className="text-xs text-ink-muted">Cópiela ahora: no se vuelve a mostrar. KYNOVA solo guarda su prefijo, los últimos cuatro caracteres y un hash.</p>
        </div>
      )}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "dashboard" && <DashboardTab {...props} />}
        {tab === "keys" && <KeysTab {...props} />}
        {tab === "webhooks" && <WebhooksTab {...props} />}
        {tab === "sandbox" && <SandboxTab {...props} />}
        {tab === "logs" && <LogsTab {...props} />}
        {tab === "apps" && <AppsTab {...props} />}
        {tab === "explorer" && <ExplorerTab {...props} />}
        {tab === "sdk" && <SdkTab />}
      </div>
    </div>
  );
}
