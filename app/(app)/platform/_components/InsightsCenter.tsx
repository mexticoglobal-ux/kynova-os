"use client";

import { useMemo, useRef, useState } from "react";
import { reduceInsights, type InsightsEvent, type InsightsState } from "@/lib/contracts/platform/insights-center";
import { DEMO_PERSONAS, demoInsightsSource } from "@/lib/contracts/platform/insights-demo";
import { label } from "@/lib/contracts/platform/insights-messages";
import { computeInsights, presetPeriod, type PeriodPreset } from "@/lib/contracts/platform/koe-insights";
import { AiView, AnalyticsView, CustomersView, ExecutiveView, FinancialView, KoeView, ProductivityView } from "./InsightsViews";
import { ReportsTab } from "./InsightsReports";
import { Tabs } from "@/components/ui/Tabs";

const TAB_KEYS = ["executive", "analytics", "ai", "productivity", "financial", "customers", "koe", "reports"] as const;
type TabKey = (typeof TAB_KEYS)[number];
const PERIODS: readonly { key: PeriodPreset; text: string }[] = [{ key: "all", text: "Todo el periodo" }, { key: "14d", text: "Últimos 14 días" }, { key: "7d", text: "Últimos 7 días" }];

type Distribute<T> = T extends unknown ? Omit<T, "tenantId" | "actor" | "at"> & { at?: string } : never;
export type UiEvent = Distribute<InsightsEvent>;
export type Persona = (typeof DEMO_PERSONAS)[number];
export type InsightsTabProps = { send: (event: UiEvent) => string | undefined; persona: Persona };

// Local simulation only: every figure is computed by KOE's one statistics module (koe-insights.ts) from the KOE ledger of simulated
// events. This screen picks a company and a period and formats the answer; it counts nothing itself.
export function InsightsCenter() {
  const source = useRef(demoInsightsSource());
  const store = useRef<InsightsState>(source.current.state);
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState<TabKey>("executive");
  const [personaId, setPersonaId] = useState<string>(DEMO_PERSONAS[0].id);
  const [period, setPeriod] = useState<PeriodPreset>("all");
  const [message, setMessage] = useState<string | null>(null);

  const persona = DEMO_PERSONAS.find((item) => item.id === personaId) ?? DEMO_PERSONAS[0];
  const state = store.current;
  const send = (event: UiEvent): string | undefined => {
    const result = reduceInsights(store.current, { at: new Date().toISOString(), ...event, tenantId: persona.tenantId, actor: persona.actor } as InsightsEvent);
    store.current = result.state;
    setMessage(result.error ?? null);
    setVersion((value) => value + 1);
    return result.error;
  };
  const insights = useMemo(() => {
    const { executions, rosters } = source.current;
    return computeInsights({ tenantId: persona.tenantId, executions, facts: store.current.facts, roster: rosters[persona.tenantId] ?? { workers: [], agents: [] }, period: presetPeriod(period, persona.tenantId, executions, store.current.facts) });
    // `version` changes when a correction adds a fact: the figures are recomputed by the engine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona.tenantId, period, version]);
  const props: InsightsTabProps = { send, persona };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: eventos simulados, sin modelos ni llamadas reales. Todas las cifras salen de KOE, la única fuente de verdad, y cada empresa ve solo lo suyo.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Actuar como
            <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={personaId} onChange={(event) => { setPersonaId(event.target.value); setMessage(null); }}>
              {DEMO_PERSONAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Periodo
            <select aria-label="Periodo" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={period} onChange={(event) => setPeriod(event.target.value as PeriodPreset)}>
              {PERIODS.map((item) => <option key={item.key} value={item.key}>{item.text}</option>)}
            </select>
          </label>
        </div>
      </div>

      <Tabs label="Inteligencia empresarial" items={TAB_KEYS.map((key) => ({ key, label: label("tabs", key) }))} value={tab} onChange={(key) => { setTab(key); setMessage(null); }} />

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={label("tabs", tab)}>
        {insights.empty && tab !== "reports" ? <p className="text-sm text-ink-muted">Esta empresa todavía no tiene datos.</p> : (
          <>
            {tab === "executive" && <ExecutiveView insights={insights} />}
            {tab === "analytics" && <AnalyticsView insights={insights} />}
            {tab === "ai" && <AiView insights={insights} />}
            {tab === "productivity" && <ProductivityView insights={insights} />}
            {tab === "financial" && <FinancialView insights={insights} />}
            {tab === "customers" && <CustomersView insights={insights} />}
            {tab === "koe" && <KoeView insights={insights} />}
          </>
        )}
        {tab === "reports" && <ReportsTab {...props} state={state} />}
      </div>
    </div>
  );
}
