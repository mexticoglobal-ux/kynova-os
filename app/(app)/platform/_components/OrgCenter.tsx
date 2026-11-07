"use client";

import { useRef, useState } from "react";
import { reduceOrg, type OrgEvent, type OrgState } from "@/lib/contracts/platform/org-center";
import { DEMO_NOW, DEMO_PERSONAS, demoOrgOk } from "@/lib/contracts/platform/org-demo";
import { label } from "@/lib/contracts/platform/org-messages";
import { DashboardTab, IdentityTab, TreeTab, WorkforceTab } from "./OrgViews";
import { BranchesTab, PermissionsTab, RolesTab, TeamsTab, UsersTab } from "./OrgPeople";

const TAB_KEYS = ["dashboard", "tree", "users", "teams", "roles", "permissions", "branches", "identity", "workforce"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<OrgEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
export type OrgTabProps = {
  state: OrgState; env: ReturnType<typeof demoOrgOk>["env"]; asOf: string; persona: Persona;
  send: (event: UiEvent) => string | undefined; sendAsPlatform: (event: UiEvent) => string | undefined;
};

// Local simulation only. Every workload figure, availability and recommendation comes from KOE's one organization module (koe-org.ts);
// this screen only shows it and records what a person decides. No directory, identity provider or sign-in is ever reached.
export function OrgCenter() {
  const source = useRef(demoOrgOk());
  const store = useRef<OrgState>(source.current.state);
  const clock = useRef(Date.parse(DEMO_NOW)); // the simulation's own clock: each action moves it a minute
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const run = (event: UiEvent, actor: string): string | undefined => {
    clock.current += 60_000;
    const result = reduceOrg(store.current, { at: new Date(clock.current).toISOString(), ...event, tenantId: persona.tenantId, actor } as OrgEvent, source.current.env);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
    return result.error;
  };
  const send = (event: UiEvent) => run(event, persona.actor);
  const sendAsPlatform = (event: UiEvent) => run(event, "system"); // simulates what the platform reports: an invitation accepted, a sign-in
  const props: OrgTabProps = { state, env: source.current.env, asOf: new Date(clock.current).toISOString(), persona, send, sendAsPlatform };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: no se conecta ningún directorio ni proveedor de identidad. KOE analiza la fuerza de trabajo y recomienda; NEX solo prepara propuestas. Crear administradores, eliminar usuarios, cambiar permisos críticos y cambiar al propietario lo decide siempre una persona.</p>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Actuar como
          <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); }}>
            {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>

      <div role="tablist" aria-label="Organización e identidad" className="flex flex-wrap gap-1.5">
        {TAB_KEYS.map((key) => (
          <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => { setTab(key); setMessage(null); }} className={tab === key ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}>
            {label("tabs", key)}
          </button>
        ))}
      </div>

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "dashboard" && <DashboardTab {...props} />}
        {tab === "tree" && <TreeTab {...props} />}
        {tab === "users" && <UsersTab {...props} />}
        {tab === "teams" && <TeamsTab {...props} />}
        {tab === "roles" && <RolesTab {...props} />}
        {tab === "permissions" && <PermissionsTab {...props} />}
        {tab === "branches" && <BranchesTab {...props} />}
        {tab === "identity" && <IdentityTab {...props} />}
        {tab === "workforce" && <WorkforceTab {...props} />}
      </div>
    </div>
  );
}
