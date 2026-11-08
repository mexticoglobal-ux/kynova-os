"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { isAdmin, newMarketState, reduceMarket, type MarketEvent, type MarketState } from "@/lib/contracts/platform/marketplace-center";
import { DEMO_ADMINS, DEMO_PERSONAS, DEMO_TENANTS, demoMarketState } from "@/lib/contracts/platform/marketplace-demo";
import { label } from "@/lib/contracts/platform/marketplace-messages";
import { ActivityTab, AdminTab, CatalogTab, FavoritesTab, ModerationTab, PurchasesTab, SellTab } from "./MarketplaceTabs";
import { Tabs } from "@/components/ui/Tabs";

const TAB_KEYS = ["catalog", "purchases", "favorites", "sell", "moderation", "admin", "activity"] as const;
type TabKey = (typeof TAB_KEYS)[number];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<MarketEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
export type MarketTabProps = { state: MarketState; send: (event: UiEvent) => void; persona: Persona; admin: boolean; tenantName: (id: string) => string };

// Local simulation only: no APIs, no real payments, nothing leaves the browser. The same reducer will run on the server.
export function MarketplaceCenter() {
  const store = useRef<MarketState>(newMarketState(DEMO_ADMINS));
  const [, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("catalog");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [message, setMessage] = useState<string | null>(null);

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const send = (event: UiEvent) => {
    const result = reduceMarket(store.current, { at: new Date().toISOString(), ...event, tenantId: persona.tenantId, actor: persona.actor } as MarketEvent);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
  };
  const loadDemo = () => {
    const result = demoMarketState();
    store.current = result.state;
    setMessage(result.errors[0] ?? null);
    setVersion((value) => value + 1);
  };
  const tenantName = (id: string) => DEMO_TENANTS.find((tenant) => tenant.id === id)?.name ?? id;
  const props: MarketTabProps = { state, send, persona, admin: isAdmin(state, persona.actor), tenantName };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: sin APIs ni pagos reales. Toda publicación requiere aprobación y todo cambio de reparto es Nivel 3.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Actuar como
            <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); }}>
              {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <Button size="sm" variant="secondary" disabled={state.listings.length > 0} onClick={loadDemo}>Cargar datos de ejemplo</Button>
        </div>
      </div>

      <Tabs label="Marketplace" items={TAB_KEYS.map((key) => ({ key, label: label("tabs", key) }))} value={tab} onChange={(key) => { setTab(key); setMessage(null); }} />

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {tab === "catalog" && <CatalogTab {...props} />}
        {tab === "purchases" && <PurchasesTab {...props} />}
        {tab === "favorites" && <FavoritesTab {...props} />}
        {tab === "sell" && <SellTab {...props} />}
        {tab === "moderation" && <ModerationTab {...props} />}
        {tab === "admin" && <AdminTab {...props} />}
        {tab === "activity" && <ActivityTab {...props} />}
      </div>
    </div>
  );
}
