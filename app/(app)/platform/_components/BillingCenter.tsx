"use client";

import { useRef, useState } from "react";
import { reduceBilling, type BillingEvent, type BillingState } from "@/lib/contracts/platform/billing-center";
import { DEMO_NOW, DEMO_PERSONAS, demoBillingOk } from "@/lib/contracts/platform/billing-demo";
import { label } from "@/lib/contracts/platform/billing-messages";
import { InvoicesTab, UpgradeTab } from "./BillingAccount";
import { AddonsTab, AiTab, DashboardTab, ForecastTab, LicensesTab, PlansTab } from "./BillingViews";
import { Tabs } from "@/components/ui/Tabs";

const TAB_KEYS = ["dashboard", "plans", "licenses", "addons", "invoices", "ai", "forecast", "upgrade"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<BillingEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
export type BillingTabProps = {
  state: BillingState; env: ReturnType<typeof demoBillingOk>["env"]; asOf: string; persona: Persona;
  send: (event: UiEvent) => string | undefined; sendAsPlatform: (event: UiEvent) => string | undefined;
};

// Local simulation only. Every figure (the bill, the limits, the AI usage, the forecast, the ROI) comes from KOE's one billing module (koe-billing.ts);
// this screen only shows it and records what a person decides. No payment gateway is ever reached and nobody is ever charged.
export function BillingCenter() {
  const source = useRef(demoBillingOk());
  const store = useRef<BillingState>(source.current.state);
  const clock = useRef(Date.parse(DEMO_NOW)); // the simulation's own clock: each action moves it a minute
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const run = (event: UiEvent, actor: string): string | undefined => {
    clock.current += 60_000;
    const result = reduceBilling(store.current, { at: new Date(clock.current).toISOString(), ...event, tenantId: persona.tenantId, actor } as BillingEvent, source.current.env);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
    return result.error;
  };
  const send = (event: UiEvent) => run(event, persona.actor);
  const sendAsPlatform = (event: UiEvent) => run(event, "system"); // simulates what the platform reports: a trial that ended
  const props: BillingTabProps = { state, env: source.current.env, asOf: new Date(clock.current).toISOString(), persona, send, sendAsPlatform };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: no hay pasarela de pagos ni se cobra a nadie. KOE calcula el consumo, los límites, el forecast y el ROI; NEX solo prepara propuestas. Cobrar, cancelar, renovar, emitir pagos y modificar facturas lo decide siempre una persona.</p>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Actuar como
          <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); }}>
            {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>

      <Tabs label="Facturación y suscripciones" items={TAB_KEYS.map((key) => ({ key, label: label("tabs", key) }))} value={tab} onChange={(key) => { setTab(key); setMessage(null); }} />

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "dashboard" && <DashboardTab {...props} />}
        {tab === "plans" && <PlansTab {...props} />}
        {tab === "licenses" && <LicensesTab {...props} />}
        {tab === "addons" && <AddonsTab {...props} />}
        {tab === "invoices" && <InvoicesTab {...props} />}
        {tab === "ai" && <AiTab {...props} />}
        {tab === "forecast" && <ForecastTab {...props} />}
        {tab === "upgrade" && <UpgradeTab {...props} />}
      </div>
    </div>
  );
}
