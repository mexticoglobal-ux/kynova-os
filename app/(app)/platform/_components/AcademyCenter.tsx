"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isAdmin, newAcademyState, reduceAcademy, type AcademyEvent, type AcademyState } from "@/lib/contracts/platform/academy-center";
import { DEMO_ADMINS, DEMO_PERSONAS, DEMO_TENANTS, demoAcademyState } from "@/lib/contracts/platform/academy-demo";
import { label } from "@/lib/contracts/platform/academy-messages";
import { ActivityTab, AdminTab, CatalogTab, CertificatesTab, LearningTab, TeachTab } from "./AcademyTabs";

const TAB_KEYS = ["catalog", "learning", "teach", "admin", "certificates", "activity"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<AcademyEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
// `as` lets the simulation play a part that is not the person's: the Marketplace adapter ("system") or NEX ("worker:nex").
export type SendAs = "system" | "worker:nex";
export type AcademyTabProps = { state: AcademyState; send: (event: UiEvent, as?: SendAs) => string | undefined; persona: Persona; admin: boolean; tenantName: (id: string) => string };

// Local simulation only: no APIs, no real video, no model. The same reducer will run on the server.
export function AcademyCenter() {
  const store = useRef<AcademyState>(newAcademyState(DEMO_ADMINS));
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("catalog");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  // returns the refusal (if any) so a form can keep what the person typed when the action was refused
  const send = (event: UiEvent, as?: SendAs): string | undefined => {
    const actor = as ?? persona.actor;
    const result = reduceAcademy(store.current, { at: new Date().toISOString(), ...event, tenantId: as === "system" ? "tenant-kynova" : persona.tenantId, actor } as AcademyEvent);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
    return result.error;
  };
  const loadDemo = () => {
    const result = demoAcademyState();
    store.current = result.state;
    setMessage(result.errors[0] ?? null);
    setVersion((value) => value + 1);
  };
  const tenantName = (id: string) => DEMO_TENANTS.find((tenant) => tenant.id === id)?.name ?? id;
  const props: AcademyTabProps = { state, send, persona, admin: isAdmin(state, persona.actor), tenantName };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: sin APIs, sin video real y sin modelo de IA. NEX solo responde con lo que dicen las lecciones y nunca califica ni certifica.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Actuar como
            <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); }}>
              {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <Button size="sm" variant="secondary" disabled={state.courses.length > 0} onClick={loadDemo}>Cargar datos de ejemplo</Button>
        </div>
      </div>

      <div role="tablist" aria-label="Academy" className="flex flex-wrap gap-1.5">
        {TAB_KEYS.map((key) => (
          <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => { setTab(key); setMessage(null); }} className={tab === key ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}>
            {label("tabs", key)}
          </button>
        ))}
      </div>

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "catalog" && <CatalogTab {...props} />}
        {tab === "learning" && <LearningTab {...props} />}
        {tab === "teach" && <TeachTab {...props} />}
        {tab === "admin" && <AdminTab {...props} />}
        {tab === "certificates" && <CertificatesTab {...props} />}
        {tab === "activity" && <ActivityTab {...props} />}
      </div>
    </div>
  );
}
