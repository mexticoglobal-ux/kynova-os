"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { applyAll, newPaymentsState, reducePayments, type PaymentsEvent, type PaymentsState } from "@/lib/contracts/platform/ledger";
import { demoEvents } from "@/lib/contracts/platform/payments-demo";
import { ActivityTab, InvoicesTab, MethodsTab, OverviewTab, PaymentsTab, ReconciliationTab, RefundsTab, SubscriptionsTab, WebhooksTab } from "./PaymentsTabs";

const TABS = [
  { key: "overview", label: "Resumen" },
  { key: "methods", label: "Métodos" },
  { key: "payments", label: "Pagos" },
  { key: "refunds", label: "Reembolsos" },
  { key: "subscriptions", label: "Suscripciones" },
  { key: "invoices", label: "Facturación" },
  { key: "reconciliation", label: "Conciliación" },
  { key: "webhooks", label: "Webhooks" },
  { key: "activity", label: "Actividad" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// The two demo people exist to show the four-eyes rule: whoever requests a refund cannot approve it.
export const DEMO_ACTORS = [
  { id: "ana", label: "Ana (solicita)" },
  { id: "bruno", label: "Bruno (aprueba)" },
] as const;

export type TabProps = { state: PaymentsState; dispatch: (event: PaymentsEvent) => void; actor: string; now: () => string };

// Local simulation only: nothing here reaches a provider. The same reducer will run on the server once adapters exist.
export function PaymentsCenter() {
  const stateRef = useRef<PaymentsState>(newPaymentsState());
  const [state, setState] = useState(stateRef.current);
  const [tab, setTab] = useState<TabKey>("overview");
  const [message, setMessage] = useState<string | null>(null);
  const [actor, setActor] = useState<string>(DEMO_ACTORS[0].id);

  const commit = (next: PaymentsState, error?: string) => {
    stateRef.current = next;
    setState(next);
    setMessage(error ?? null);
  };
  const dispatch = (event: PaymentsEvent) => {
    const result = reducePayments(stateRef.current, event);
    commit(result.state, result.error);
  };
  const loadDemo = () => {
    const result = applyAll(stateRef.current, demoEvents());
    commit(result.state, result.errors[0]);
  };
  const now = () => new Date().toISOString();
  const props: TabProps = { state, dispatch, actor, now };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">Simulación local: no se contacta a ningún proveedor ni se mueve dinero real.</p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            Actuar como
            <select aria-label="Actuar como" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-ink" value={actor} onChange={(event) => setActor(event.target.value)}>
              {DEMO_ACTORS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="secondary" disabled={state.payments.length > 0} onClick={loadDemo}>Cargar datos de ejemplo</Button>
        </div>
      </div>

      <div role="tablist" aria-label="Centro de Pagos" className="flex flex-wrap gap-1.5">
        {TABS.map((item) => (
          <button key={item.key} role="tab" type="button" aria-selected={tab === item.key} onClick={() => { setTab(item.key); setMessage(null); }}
            className={tab === item.key ? "btn btn-sm btn-primary" : "btn btn-sm btn-ghost"}>
            {item.label}
          </button>
        ))}
      </div>

      {message && <p role="alert" className="rounded-xl bg-danger/15 px-3 py-2 text-sm text-danger-soft">{message}</p>}

      <div role="tabpanel" aria-label={TABS.find((item) => item.key === tab)?.label}>
        {tab === "overview" && <OverviewTab {...props} />}
        {tab === "methods" && <MethodsTab {...props} />}
        {tab === "payments" && <PaymentsTab {...props} />}
        {tab === "refunds" && <RefundsTab {...props} />}
        {tab === "subscriptions" && <SubscriptionsTab {...props} />}
        {tab === "invoices" && <InvoicesTab {...props} />}
        {tab === "reconciliation" && <ReconciliationTab {...props} />}
        {tab === "webhooks" && <WebhooksTab {...props} />}
        {tab === "activity" && <ActivityTab {...props} />}
      </div>
    </div>
  );
}
