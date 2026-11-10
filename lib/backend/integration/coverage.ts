// Coverage: the proof that everything that was audited went through the Event Bus. For one company, every audit record that came from a module's own trail has an
// event of that module on the bus with the same trace id and action; a refused attempt that left no trail entry has no event, because nothing happened to publish.

import type { BackendCore } from "../index";

export type Coverage = { ok: boolean; audited: number; events: number; missing: string[]; foreign: number };

export async function verifyCoverage(core: BackendCore, tenantId: string): Promise<Coverage> {
  const records = (await core.audit()).list(tenantId).filter((item) => item.category !== "refused");
  const store = (await core.events()).store;
  const events = store.read({ tenantId, after: 0, limit: 100_000 }).filter((item) => item.type.endsWith(".audit.recorded"));
  const available = new Map<string, number>();
  const key = (module: string, correlationId: string | undefined, action: unknown) => `${module}|${correlationId ?? ""}|${String(action)}`;
  for (const event of events) available.set(key(event.module, event.correlationId, event.payload["action"]), (available.get(key(event.module, event.correlationId, event.payload["action"])) ?? 0) + 1);
  const missing: string[] = [];
  for (const record of records) {
    const id = key(record.module, record.requestId, record.action);
    const left = available.get(id) ?? 0;
    if (left <= 0) missing.push(record.id);
    else available.set(id, left - 1);
  }
  // events that belong to another company can never be in the read of this one
  const foreign = store.read({ tenantId, after: 0, limit: 100_000 }).filter((item) => item.tenantId !== tenantId).length;
  return { ok: missing.length === 0 && foreign === 0, audited: records.length, events: events.length, missing, foreign };
}
