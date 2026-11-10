// The bridges: one per platform module that has a reducer, plus the AI path (KOE's AI request, the AI Gateway) and the agent runtime. A bridge only SAYS where a
// module keeps its append-only trails and how to read the company, the actor and the type of one of its events: it adds nothing to the module and changes
// nothing in it. The modules are imported here, never the other way round: no module imports the Backend Core.

import { reduceAcademy, type AcademyEvent, type AcademyState } from "@/lib/contracts/platform/academy-center";
import { reduceAgent, type AgentEvent, type AgentState } from "@/lib/contracts/platform/agent-center";
import { reduceAutomations, type AutomationEvent, type AutomationState } from "@/lib/contracts/platform/automation-center";
import { reduceBilling, type BillingEvent, type BillingState } from "@/lib/contracts/platform/billing-center";
import { reduceComms, type CommsEvent, type CommsState } from "@/lib/contracts/platform/comms-center";
import { reduceCrm, type CrmEvent, type CrmState } from "@/lib/contracts/platform/crm-center";
import { reduceDev, type DevEvent, type DevState } from "@/lib/contracts/platform/dev-center";
import { reduceGateway, type GatewayEvent, type GatewayState } from "@/lib/contracts/platform/gateway-center";
import type { GatewayCall } from "@/lib/contracts/platform/gateway-engine";
import { reduceInsights, type InsightsEvent, type InsightsState } from "@/lib/contracts/platform/insights-center";
import { reduceAi, type AiEvent, type AiState } from "@/lib/contracts/platform/koe-ai-center";
import { reduceKoe, type KoeEvent, type KoeState } from "@/lib/contracts/platform/koe-engine";
import { reduceMarket, type MarketEvent, type MarketState } from "@/lib/contracts/platform/marketplace-center";
import { reduceOrg, type OrgEvent, type OrgState } from "@/lib/contracts/platform/org-center";
import { reduceStudio, type StudioEvent, type StudioState } from "@/lib/contracts/platform/studio-center";
import type { Bridge, Observation, ReduceResult, SourceEntry, Stream } from "./connector";

// The events of every module carry the company, the actor and a type. This reads them in one place.
type Eventlike = { type: string; tenantId: string; actor: string };
const read = {
  tenantOf: (event: Eventlike) => event.tenantId,
  actorOf: (event: Eventlike) => event.actor,
  typeOf: (event: Eventlike) => event.type,
};

const stream = (name: string, module: Stream["module"], entries: readonly SourceEntry[]): Stream => ({ name, module, entries });

// ---------------------------------------------------------------- domain telemetry of the AI path (worked out from the states, never from the prompts)
const day = (iso: string) => iso;

/** What the AI Gateway observed in the calls that are new: one domain event, a count and a latency each, and a child span with the simulated duration. */
function gatewayObservations(before: GatewayState, after: GatewayState): Observation[] {
  const out: Observation[] = [];
  for (const call of after.calls.slice(before.calls.length) as readonly GatewayCall[]) {
    out.push({
      kind: "event", module: "koe", name: "ai.call.recorded", id: `gateway.call:${call.id}`, tenantId: call.tenantId, actor: "system", at: call.at,
      payload: { callId: call.id, status: call.status, fallback: call.fallbackUsed, latencyMs: call.latencyMs, costMicros: call.estimatedCostMicros },
    });
    out.push({ kind: "metric", metric: "inc", name: "kynova_ai_gateway_calls_total", labels: { outcome: call.status } });
    out.push({ kind: "metric", metric: "observe", name: "kynova_ai_gateway_latency_ms", labels: { outcome: call.status }, value: call.latencyMs });
    if (call.fallbackUsed) out.push({ kind: "metric", metric: "inc", name: "kynova_ai_gateway_fallbacks_total", labels: {} });
    out.push({
      kind: "span", name: "ai.gateway.call", at: day(call.at), durationMs: call.latencyMs, status: call.status === "ok" ? "ok" : "error",
      attributes: { tenantId: call.tenantId, callId: call.id, attempts: call.attempts.length, fallback: call.fallbackUsed, ...(call.providerId ? { provider: call.providerId } : {}) },
    });
  }
  return out;
}

/** KOE's AI request: how every request ended, by outcome, never by company or by text. */
function aiObservations(before: AiState, after: AiState): Observation[] {
  const out: Observation[] = after.records.slice(before.records.length).map((record): Observation => ({ kind: "metric", metric: "inc", name: "kynova_ai_requests_total", labels: { outcome: record.status } }));
  return [...out, ...gatewayObservations(before.gateway, after.gateway)];
}

/** The agent runtime: a session that is new or changed status is a domain event, and the AI path under it reports as above. */
function agentObservations(before: AgentState, after: AgentState): Observation[] {
  const out: Observation[] = [];
  for (const session of after.sessions) {
    const prior = before.sessions.find((item) => item.id === session.id);
    if (prior && prior.status === session.status) continue;
    const at = session.finishedAt ?? session.steps.at(-1)?.at ?? session.startedAt;
    out.push({
      kind: "event", module: "workers", name: "session.changed", id: `agents.session:${session.id}:${session.status}:${session.steps.length}`, tenantId: session.tenantId, actor: "system", at,
      payload: { sessionId: session.id, status: session.status, ...(session.stopReason ? { stopReason: session.stopReason } : {}) },
    });
    out.push({ kind: "metric", metric: "inc", name: "kynova_agent_sessions_total", labels: { status: session.status } });
  }
  return [...out, ...aiObservations(before.ai, after.ai)];
}

// ---------------------------------------------------------------- the bridges
const bridge = <S, E extends Eventlike, R extends ReduceResult<S>>(definition: Bridge<S, E, R>): Bridge<S, E, R> => definition;

export const BRIDGES = {
  workers: bridge<KoeState, KoeEvent, ReturnType<typeof reduceKoe>>({
    id: "workers", label: "Workers (motor de KOE)", modules: ["workers"], reduce: reduceKoe, ...read,
    streams: (state) => [stream("audit", "workers", state.audit)],
  }),
  ai: bridge<AiState, AiEvent, ReturnType<typeof reduceAi>>({
    id: "ai", label: "IA de KOE (solicitudes)", modules: ["koe"], reduce: reduceAi, ...read, observe: aiObservations,
    streams: (state) => [stream("logs", "koe", state.logs), stream("gateway", "koe", state.gateway.logs)],
  }),
  gateway: bridge<GatewayState, GatewayEvent, ReturnType<typeof reduceGateway>>({
    id: "gateway", label: "AI Gateway", modules: ["koe"], reduce: reduceGateway, ...read, observe: gatewayObservations,
    streams: (state) => [stream("logs", "koe", state.logs)],
  }),
  agents: bridge<AgentState, AgentEvent, ReturnType<typeof reduceAgent>>({
    id: "agents", label: "Runtime de agentes", modules: ["workers", "koe"], reduce: reduceAgent, ...read, observe: agentObservations,
    streams: (state) => [stream("logs", "workers", state.logs), stream("audit", "workers", state.koe.audit), stream("ai", "koe", state.ai.logs), stream("gateway", "koe", state.ai.gateway.logs)],
  }),
  automations: bridge<AutomationState, AutomationEvent, ReturnType<typeof reduceAutomations>>({
    id: "automations", label: "Automatizaciones", modules: ["automations"], reduce: reduceAutomations, ...read,
    streams: (state) => [stream("audit", "automations", state.audit)],
  }),
  marketplace: bridge<MarketState, MarketEvent, ReturnType<typeof reduceMarket>>({
    id: "marketplace", label: "Marketplace", modules: ["marketplace"], reduce: reduceMarket, ...read,
    streams: (state) => [stream("audit", "marketplace", state.audit)],
  }),
  academy: bridge<AcademyState, AcademyEvent, ReturnType<typeof reduceAcademy>>({
    id: "academy", label: "Academy", modules: ["academy"], reduce: reduceAcademy, ...read,
    streams: (state) => [stream("audit", "academy", state.audit)],
  }),
  crm: bridge<CrmState, CrmEvent, ReturnType<typeof reduceCrm>>({
    id: "crm", label: "CRM", modules: ["crm"], reduce: reduceCrm, ...read,
    streams: (state) => [stream("audit", "crm", state.audit)],
  }),
  billing: bridge<BillingState, BillingEvent, ReturnType<typeof reduceBilling>>({
    id: "billing", label: "Billing", modules: ["billing"], reduce: reduceBilling, ...read,
    streams: (state) => [stream("audit", "billing", state.audit)],
  }),
  insights: bridge<InsightsState, InsightsEvent, ReturnType<typeof reduceInsights>>({
    id: "insights", label: "Insights", modules: ["insights"], reduce: reduceInsights, ...read,
    streams: (state) => [stream("audit", "insights", state.audit)],
  }),
  developer: bridge<DevState, DevEvent, ReturnType<typeof reduceDev>>({
    id: "developer", label: "Developer Platform", modules: ["developer"], reduce: reduceDev, ...read,
    streams: (state) => [stream("logs", "developer", state.logs)],
  }),
  communications: bridge<CommsState, CommsEvent, ReturnType<typeof reduceComms>>({
    id: "communications", label: "Communications", modules: ["communications"], reduce: reduceComms, ...read,
    streams: (state) => [stream("audit", "communications", state.audit)],
  }),
  organizations: bridge<OrgState, OrgEvent, ReturnType<typeof reduceOrg>>({
    id: "organizations", label: "Organización e identidad", modules: ["organizations"], reduce: reduceOrg, ...read,
    streams: (state) => [stream("audit", "organizations", state.audit)],
  }),
  studio: bridge<StudioState, StudioEvent, ReturnType<typeof reduceStudio>>({
    id: "studio", label: "AI Studio", modules: ["koe"], reduce: reduceStudio, ...read,
    streams: (state) => [stream("audit", "koe", state.audit)],
  }),
} as const;

export type BridgeId = keyof typeof BRIDGES;
export const BRIDGE_IDS = Object.keys(BRIDGES) as BridgeId[];
export type StateOf<K extends BridgeId> = Parameters<(typeof BRIDGES)[K]["reduce"]>[0];
export type EventOf<K extends BridgeId> = Parameters<(typeof BRIDGES)[K]["reduce"]>[1];
export type ResultOf<K extends BridgeId> = ReturnType<(typeof BRIDGES)[K]["reduce"]>;

/** Platform modules that have a reducer but no company-scoped trail to carry yet (payments and referrals keep their own ledger shape). Declared so the gap is visible. */
export const NOT_CONNECTED = ["payments", "referrals"] as const;
