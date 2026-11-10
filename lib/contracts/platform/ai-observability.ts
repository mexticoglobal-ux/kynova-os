// AI observability: the join of what KOE decided (its record: Worker, specialty, policy, priority, decision) with what the AI Gateway observed (model, provider, attempts,
// fallback and its reasons, latency, tokens, cost). Neither side reads the other's records; this file only reads both, so a view and its metrics can say everything about a
// call while KOE still knows no provider and the Gateway still knows no Worker. Read-only and pure: it changes nothing. The prompt text is in neither record.

import type { AiRecord } from "./koe-ai";
import type { AttemptRecord, GatewayCall } from "./gateway-engine";

export type ObservedState = { records: readonly AiRecord[]; gateway: { calls: readonly GatewayCall[] } };

export type AiCallView = AiRecord & {
  modelId?: string; providerId?: string; attempts: AttemptRecord[]; fallbackUsed: boolean; fallbackReasons: string[]; latencyMs: number; outputTokens: number; cache: string;
};

/** Each KOE record joined with what the Gateway observed for it. */
export function callsOf(state: ObservedState): AiCallView[] {
  return state.records.map((record) => {
    const call = state.gateway.calls.find((item) => item.id === record.gatewayCallId);
    return {
      ...record, attempts: call?.attempts ?? [], fallbackUsed: call?.fallbackUsed ?? false, fallbackReasons: call?.fallbackReasons ?? [], latencyMs: call?.latencyMs ?? 0,
      outputTokens: call?.outputTokens ?? 0, cache: call?.cache ?? "bypass", ...(call?.modelId ? { modelId: call.modelId } : {}), ...(call?.providerId ? { providerId: call.providerId } : {}),
    };
  });
}

// ---------------------------------------------------------------- metrics (what the company and KOE read, joined with the Gateway's observations)
export type AiMetrics = {
  calls: number; ok: number; failed: number; refused: number; fallbackCalls: number; fallbackRate: number; averageLatencyMs: number; tokens: number; costMicros: number;
  byModel: { modelId: string; calls: number; costMicros: number }[]; byPurpose: { purposeId: string; calls: number }[]; byWorker: { workerId: string; calls: number }[];
  errors: { code: string; count: number }[];
};
export function aiMetrics(views: readonly AiCallView[], tenantId: string): AiMetrics {
  const mine = views.filter((call) => call.tenantId === tenantId);
  const done = mine.filter((call) => call.status === "ok");
  const byModel: AiMetrics["byModel"] = [];
  const byPurpose: AiMetrics["byPurpose"] = [];
  const byWorker: AiMetrics["byWorker"] = [];
  const errors = new Map<string, number>();
  for (const call of mine) {
    if (call.modelId && call.status === "ok") {
      const row = byModel.find((item) => item.modelId === call.modelId);
      if (row) { row.calls += 1; row.costMicros += call.estimatedCostMicros; } else byModel.push({ modelId: call.modelId, calls: 1, costMicros: call.estimatedCostMicros });
    }
    const purposeRow = byPurpose.find((item) => item.purposeId === call.purposeId);
    if (purposeRow) purposeRow.calls += 1; else byPurpose.push({ purposeId: call.purposeId, calls: 1 });
    const workerRow = byWorker.find((item) => item.workerId === call.workerId);
    if (workerRow) workerRow.calls += 1; else byWorker.push({ workerId: call.workerId, calls: 1 });
    if (call.errorCode) errors.set(call.errorCode, (errors.get(call.errorCode) ?? 0) + 1);
  }
  const fallbackCalls = mine.filter((call) => call.fallbackUsed).length;
  return {
    calls: mine.length, ok: done.length, failed: mine.filter((call) => call.status === "failed").length, refused: mine.filter((call) => call.status === "refused").length,
    fallbackCalls, fallbackRate: mine.length === 0 ? 0 : Math.round((fallbackCalls / mine.length) * 100),
    averageLatencyMs: done.length === 0 ? 0 : Math.round(done.reduce((sum, call) => sum + call.latencyMs, 0) / done.length),
    tokens: done.reduce((sum, call) => sum + call.inputTokens + call.outputTokens, 0), costMicros: done.reduce((sum, call) => sum + call.estimatedCostMicros, 0),
    byModel, byPurpose, byWorker, errors: [...errors].map(([code, count]) => ({ code, count })),
  };
}
