"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { newReferralState, reduceReferrals, type ReferralEvent, type ReferralState } from "@/lib/contracts/platform/referral-center";
import { DEMO_TENANTS, demoReferralState } from "@/lib/contracts/platform/referral-demo";
import { label } from "@/lib/contracts/platform/referral-messages";
import { ActivityTab, AffiliatesTab, CommissionsTab, FraudTab, OverviewTab, PayoutsTab, ProgramTab, ReferralsTab } from "./ReferralsTabs";

const TAB_KEYS = ["overview", "program", "affiliates", "referrals", "commissions", "payouts", "fraud", "activity"] as const;
type TabKey = (typeof TAB_KEYS)[number];

// "worker:" actors are NEX or another AI worker: the reducer refuses them for approvals and payouts (Constitution, Level 3).
export const REFERRAL_ACTORS = [
  { id: "ana", label: "Ana (solicita)" },
  { id: "bruno", label: "Bruno (aprueba)" },
  { id: "worker:nex", label: "NEX (IA)" },
] as const;

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "at"> : never;
export type UiEvent = Distribute<ReferralEvent>;
export type ReferralTabProps = { state: ReferralState; send: (event: UiEvent) => void; actor: string };

// Local simulation only: no API, no gateway, no money. One isolated state per company; the same reducer will run on the server.
export function ReferralsCenter() {
  const states = useRef<Record<string, ReferralState>>(Object.fromEntries(DEMO_TENANTS.map((tenant) => [tenant.id, newReferralState(tenant.id)])));
  const [tenantId, setTenantId] = useState<string>(DEMO_TENANTS[0].id);
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("overview");
  const [message, setMessage] = useState<string | null>(null);
  const [actor, setActor] = useState<string>(REFERRAL_ACTORS[0].id);

  const state = states.current[tenantId];
  const send = (event: UiEvent) => {
    const result = reduceReferrals(state, { ...event, tenantId, at: new Date().toISOString() } as ReferralEvent);
    states.current[tenantId] = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
  };
  const loadDemo = () => {
    const result = demoReferralState(tenantId);
    states.current[tenantId] = result.state;
    setMessage(result.errors[0] ?? null);
    setVersion((value) => value + 1);
  };
  const props: ReferralTabProps = { state, send, actor };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: sin APIs ni pasarelas. Pagar una comisión siempre lo decide una persona (Nivel 3).</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Empresa
            <select aria-label="Empresa" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={tenantId} onChange={(event) => { setTenantId(event.target.value); setMessage(null); }}>
              {DEMO_TENANTS.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Actuar como
            <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={actor} onChange={(event) => setActor(event.target.value)}>
              {REFERRAL_ACTORS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <Button size="sm" variant="secondary" disabled={state.affiliates.length > 0} onClick={loadDemo}>Cargar datos de ejemplo</Button>
        </div>
      </div>

      <div role="tablist" aria-label="Centro de Referidos" className="flex flex-wrap gap-1.5">
        {TAB_KEYS.map((key) => (
          <button key={key} role="tab" type="button" aria-selected={tab === key} onClick={() => { setTab(key); setMessage(null); }} className={tab === key ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}>
            {label("tabs", key)}
          </button>
        ))}
      </div>

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "overview" && <OverviewTab {...props} />}
        {tab === "program" && <ProgramTab key={tenantId} {...props} />}
        {tab === "affiliates" && <AffiliatesTab {...props} />}
        {tab === "referrals" && <ReferralsTab {...props} />}
        {tab === "commissions" && <CommissionsTab {...props} />}
        {tab === "payouts" && <PayoutsTab {...props} />}
        {tab === "fraud" && <FraudTab {...props} />}
        {tab === "activity" && <ActivityTab {...props} />}
      </div>
    </div>
  );
}
