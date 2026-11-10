/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoAcademyOk } from "@/lib/contracts/platform/academy-demo";
import { newAgentState, playbookById, reduceAgent, type AgentEvent, type AgentState } from "@/lib/contracts/platform/agent-center";
import { demoAutomationsOk } from "@/lib/contracts/platform/automation-demo";
import { demoBillingOk } from "@/lib/contracts/platform/billing-demo";
import { demoCommsOk } from "@/lib/contracts/platform/comms-demo";
import { demoCrmOk } from "@/lib/contracts/platform/crm-demo";
import { demoDevOk } from "@/lib/contracts/platform/dev-demo";
import { GATEWAY_PROVIDERS } from "@/lib/contracts/platform/gateway-catalog";
import { newGatewayState, reduceGateway } from "@/lib/contracts/platform/gateway-center";
import { demoInsightsSource } from "@/lib/contracts/platform/insights-demo";
import { newAiState, reduceAi } from "@/lib/contracts/platform/koe-ai-center";
import { demoKoeOk } from "@/lib/contracts/platform/koe-demo";
import { newKoeState, reduceKoe } from "@/lib/contracts/platform/koe-engine";
import { demoOk as demoMarketOk } from "@/lib/contracts/platform/marketplace-demo";
import { demoOrgOk } from "@/lib/contracts/platform/org-demo";
import { demoStudioOk } from "@/lib/contracts/platform/studio-demo";
import { decrypt, generateEncryptionKey } from "../crypto";
import { ENTITIES } from "../entities";
import { MODULE_IDS } from "../events";
import { createBackendCore, koeView } from "../index";
import { ALLOWED_LABELS } from "../observability";
import { RLS_STATE } from "../rls";
import { canAccessPath } from "../storage";
import {
  BRIDGES, BRIDGE_IDS, Connector, NOT_CONNECTED, PERSISTED_TABLES, SimulatedDatabase, SupabasePersistence, auditRow, connectPlatform, eventRow, newStats, outcomeOfAction, persistedTablesReport,
  storageRow, validateRow, verifyCoverage, type Bridge, type DatabaseClient, type Row,
} from "./index";

const NOVA = "tenant-nova";
const VIDA = "tenant-vida";
const ANA = "ana";
const SYSTEM = "system";

let clockMs = Date.parse("2026-11-10T12:00:00.000Z");
const tick = () => (clockMs += 7);
let counter = 0;
const at = () => new Date(Date.parse("2026-11-10T12:00:00.000Z") + counter++ * 1_000).toISOString();

/** A core with a clock that moves on its own and the two secrets a real environment would have. The key is generated here: it is never a literal in the code. */
function setup(extra: Record<string, string> = {}) {
  const key = generateEncryptionKey();
  const core = createBackendCore({
    vars: { KYNOVA_ENCRYPTION_KEY: key, KYNOVA_HASH_PEPPER: "p".repeat(40), ...extra }, now: tick, clock: () => new Date(tick()).toISOString(),
  });
  return { core, platform: connectPlatform(core), key };
}

function agentWorld(): AgentState {
  let state = newAgentState(["admin:ana"]);
  for (const [tenantId, definitionId] of [[NOVA, "sales"], [NOVA, "collections"], [VIDA, "sales"]] as const) {
    const result = reduceKoe(state.koe, { type: "worker.enable", at: at(), tenantId, actor: ANA, definitionId });
    expect(result.error, result.error).toBeUndefined();
    state = { ...state, koe: result.state };
  }
  return state;
}
const instanceOf = (state: AgentState, tenantId: string, workerId: string) => state.koe.instances.find((item) => item.tenantId === tenantId && item.definitionId === workerId)!.id;
type StartEvent = Extract<AgentEvent, { type: "session.start" }>;
const startEvent = (state: AgentState, tenantId = NOVA, playbookId = "sales.qualify"): StartEvent => ({
  type: "session.start", at: at(), tenantId, actor: ANA, instanceId: instanceOf(state, tenantId, playbookById(playbookId)!.workerId), playbookId, goal: "Preparar el contacto",
  input: { contacto: "Clínica Vida", tema: "propuesta", cliente: "Clínica Vida", monto: "250" },
});

// ================================================================ the wiring
describe("the bridges", () => {
  it("wrap the module's OWN reducer, not a copy: every bridge points at the function the module exports", async () => {
    const { reduceBilling } = await import("@/lib/contracts/platform/billing-center");
    const { reduceAgent: agentReducer } = await import("@/lib/contracts/platform/agent-center");
    expect(BRIDGES.billing.reduce).toBe(reduceBilling);
    expect(BRIDGES.agents.reduce).toBe(agentReducer);
    expect(BRIDGES.gateway.reduce).toBe(reduceGateway);
    expect(BRIDGES.workers.reduce).toBe(reduceKoe);
    expect(BRIDGES.ai.reduce).toBe(reduceAi);
    expect(BRIDGE_IDS).toHaveLength(14);
  });

  it("report on the modules of the platform: every module id with a reducer is bridged, and the ones left out are declared", () => {
    const reported = new Set(BRIDGE_IDS.flatMap((id) => BRIDGES[id].modules));
    for (const moduleId of MODULE_IDS.filter((id) => id !== "users")) expect(reported.has(moduleId), moduleId).toBe(true);
    expect(NOT_CONNECTED).toEqual(["payments", "referrals"]);
    for (const id of BRIDGE_IDS) {
      expect(BRIDGES[id].label.trim(), id).not.toBe("");
      expect(BRIDGES[id].modules.every((module) => (MODULE_IDS as readonly string[]).includes(module)), id).toBe(true);
    }
  });

  it("leave no reducer of the platform outside the Event Bus: every center is bridged or declared as not connected", () => {
    const folder = join(process.cwd(), "lib", "contracts", "platform");
    const bridges = readFileSync(join(process.cwd(), "lib", "backend", "integration", "bridges.ts"), "utf8");
    const centers = readdirSync(folder).filter((name) => /-(center|engine)\.ts$/.test(name) && !name.endsWith(".test.ts"));
    expect(centers.length).toBeGreaterThanOrEqual(14);
    const unbridged: string[] = [];
    for (const name of centers) {
      const reducers = [...readFileSync(join(folder, name), "utf8").matchAll(/export function (reduce\w+)\(/g)].map((match) => match[1]!);
      for (const reducer of reducers) if (!bridges.includes(`reduce: ${reducer}`)) unbridged.push(`${name}:${reducer}`);
    }
    expect(unbridged.map((item) => item.split(":")[0]).sort()).toEqual(["referral-center.ts"]);
  });

  it("read an action's outcome so a refusal or a failure is audited as such", () => {
    expect(outcomeOfAction("tool.refused")).toBe("refused");
    expect(outcomeOfAction("approval.rejected")).toBe("refused");
    expect(outcomeOfAction("gateway.failed")).toBe("error");
    expect(outcomeOfAction("session.complete")).toBe("success");
  });
});

// ================================================================ every module's history goes through the bus
describe("backfill: the history of every existing module goes through the Event Bus and the central audit", () => {
  const sources = [
    ["workers", () => demoKoeOk()],
    ["automations", () => demoAutomationsOk()],
    ["marketplace", () => demoMarketOk()],
    ["academy", () => demoAcademyOk()],
    ["crm", () => demoCrmOk()],
    ["billing", () => demoBillingOk().state],
    ["insights", () => demoInsightsSource().state],
    ["developer", () => demoDevOk().state],
    ["communications", () => demoCommsOk().state],
    ["organizations", () => demoOrgOk().state],
    ["studio", () => demoStudioOk()],
  ] as const;

  it.each(sources)("%s: every entry of its trails becomes an event and an audit record of its own company", async (id, make) => {
    const { core, platform } = setup();
    const state = make() as never;
    const entries = BRIDGES[id].streams(state as never).flatMap((item) => item.entries);
    expect(entries.length, id).toBeGreaterThan(0);
    const carried = await platform.backfill(id, state);
    expect(carried).toBe(entries.length);
    let events = 0;
    for (const tenantId of new Set(entries.map((item) => item.tenantId!))) {
      const own = entries.filter((item) => item.tenantId === tenantId);
      const read = (await core.events()).store.read({ tenantId, after: 0, limit: 100_000 });
      expect(read.length, `${id}/${tenantId}`).toBe(own.length);
      expect(read.every((item) => item.tenantId === tenantId)).toBe(true);
      expect((await core.audit()).list(tenantId)).toHaveLength(own.length);
      expect((await core.audit()).verify(tenantId)).resolves.toMatchObject({ ok: true });
      events += read.length;
    }
    expect(events).toBe(entries.length);
    expect(platform.stats.violations).toBe(0);
  });

  it("is idempotent: carrying the same history again adds nothing", async () => {
    const { core, platform } = setup();
    const state = demoKoeOk();
    const first = await platform.backfill("workers", state);
    const tenant = BRIDGES.workers.streams(state)[0]!.entries[0]!.tenantId!;
    const events = (await core.events()).store.read({ tenantId: tenant, after: 0, limit: 100_000 }).length;
    const records = (await core.audit()).list(tenant).length;
    expect(await platform.backfill("workers", state)).toBe(first);
    expect((await core.events()).store.read({ tenantId: tenant, after: 0, limit: 100_000 })).toHaveLength(events);
    expect((await core.audit()).list(tenant)).toHaveLength(records);
  });
});

// ================================================================ live calls
describe("a live call: the module runs as before, and the Backend Core hears about it", () => {
  it("gives exactly the result of the module's own reducer", async () => {
    const { platform } = setup();
    const event = { type: "worker.enable", at: at(), tenantId: NOVA, actor: ANA, definitionId: "sales" } as const;
    const direct = reduceKoe(newKoeState(["admin:ana"]), event);
    const wrapped = await platform.run("workers", newKoeState(["admin:ana"]), event);
    expect(wrapped).toEqual(direct);
  });

  it("publishes, audits, counts and traces one call, and ties the four together with one trace id", async () => {
    const { core, platform } = setup();
    const event = { type: "worker.enable", at: at(), tenantId: NOVA, actor: ANA, definitionId: "sales" } as const;
    await platform.run("workers", newKoeState(["admin:ana"]), event);
    const events = (await core.events()).store.read({ tenantId: NOVA, after: 0, limit: 50 });
    expect(events.map((item) => item.type)).toEqual(["workers.audit.recorded"]);
    const span = core.spans.spans.find((item) => item.name === "reducer.workers")!;
    expect(span).toMatchObject({ status: "ok", attributes: expect.objectContaining({ module: "workers", tenantId: NOVA, outcome: "ok" }) });
    expect(events[0]!.correlationId).toBe(span.traceId);
    const records = (await core.audit()).list(NOVA);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ module: "workers", outcome: "success", requestId: span.traceId, actorKind: "person" });
    const series = (await core.metrics()).snapshot();
    expect(series.find((item) => item.name === "kynova_reducer_calls_total")).toMatchObject({ labels: { module: "workers", outcome: "ok" }, value: 1 });
    expect(series.find((item) => item.name === "kynova_reducer_duration_ms")?.count).toBe(1);
    expect(series.find((item) => item.name === "kynova_bus_events_total")?.value).toBe(1);
  });

  it("audits a refused attempt too, and publishes nothing for it", async () => {
    const { core, platform } = setup();
    const refused = await platform.run("workers", newKoeState(["admin:ana"]), { type: "worker.enable", at: at(), tenantId: NOVA, actor: "worker:nex", definitionId: "sales" });
    expect(refused.error).toBeDefined();
    const records = (await core.audit()).list(NOVA);
    expect(records.some((item) => item.outcome === "refused")).toBe(true);
    const counted = (await core.metrics()).snapshot().find((item) => item.name === "kynova_reducer_calls_total" && item.labels.outcome === "refused");
    expect(counted?.value).toBe(1);
    expect(core.spans.spans.find((item) => item.name === "reducer.workers")?.status).toBe("error");
  });

  it("refuses a call without a company before the module is touched", async () => {
    const { core, platform } = setup();
    const state = newKoeState(["admin:ana"]);
    const result = await platform.run("workers", state, { type: "worker.enable", at: at(), tenantId: "", actor: ANA, definitionId: "sales" });
    expect(result.errorCode).toBe("tenantRequired");
    expect(result.state).toBe(state);
    expect(platform.stats.violations).toBe(1);
    expect((await core.events()).store.read({ tenantId: NOVA, after: 0, limit: 10 })).toHaveLength(0);
    expect((await platform.health()).checks.find((item) => item.name === "tenancy")?.status).toBe("down");
  });

  it("never publishes an entry of another company that shows up inside a call", async () => {
    const { core } = setup();
    const stats = newStats();
    const leaky: Bridge<{ rows: { tenantId: string; at: string; actor: string; action: string }[] }, { type: string; tenantId: string; actor: string }> = {
      id: "leaky", label: "prueba", modules: ["crm"], tenantOf: (event) => event.tenantId, actorOf: (event) => event.actor, typeOf: (event) => event.type,
      reduce: (state) => ({ state: { rows: [...state.rows, { tenantId: VIDA, at: at(), actor: ANA, action: "lead.created" }] } }),
      streams: (state) => [{ name: "audit", module: "crm", entries: state.rows }],
    };
    const connector = new Connector(core, leaky, stats);
    await connector.reduce({ rows: [] }, { type: "x", tenantId: NOVA, actor: ANA });
    expect((await core.events()).store.read({ tenantId: VIDA, after: 0, limit: 10 })).toHaveLength(0);
    expect((await core.events()).store.read({ tenantId: NOVA, after: 0, limit: 10 })).toHaveLength(0);
    expect(stats.violations).toBe(1);
  });
});

// ================================================================ the runtime, the AI request and the AI Gateway
describe("the agent runtime, KOE's AI request and the AI Gateway on the Event Bus, the audit, the metrics and the traces", () => {
  async function completedSession() {
    const { core, platform } = setup();
    let state = agentWorld();
    const started = await platform.run("agents", state, startEvent(state));
    state = started.state;
    const done = await platform.run("agents", state, { type: "session.run", at: at(), tenantId: NOVA, actor: SYSTEM, sessionId: started.session!.id });
    return { core, platform, state: done.state, result: done };
  }

  it("carries a whole session: the Workers audit, the runtime's log, the AI request and the Gateway all reach the bus", async () => {
    const { core, result } = await completedSession();
    expect(result.session?.status).toBe("completed");
    const events = (await core.events()).store.read({ tenantId: NOVA, after: 0, limit: 1_000 });
    const types = new Set(events.map((item) => item.type));
    expect(types).toEqual(new Set(["workers.audit.recorded", "koe.audit.recorded", "koe.ai.call.recorded", "workers.session.changed"]));
    const modules = new Set((await core.audit()).list(NOVA).map((item) => item.module));
    expect(modules).toEqual(new Set(["workers", "koe"]));
    expect(events.filter((item) => item.type === "koe.ai.call.recorded")).toHaveLength(1);
    expect(events.find((item) => item.type === "workers.session.changed" && item.payload["status"] === "completed")).toBeDefined();
  });

  it("does not put the prompt, a credential or a person's data on the bus or in the audit", async () => {
    const { core, platform } = setup();
    let state = agentWorld();
    const started = await platform.run("agents", state, { ...startEvent(state), goal: "Calificar a ana.privada@clinica.com con la frase ZETA-QUASAR-77" });
    state = started.state;
    await platform.run("agents", state, { type: "session.run", at: at(), tenantId: NOVA, actor: SYSTEM, sessionId: started.session!.id });
    const dump = JSON.stringify([(await core.events()).store.read({ tenantId: NOVA, after: 0, limit: 1_000 }), (await core.audit()).list(NOVA), core.logs.entries, core.spans.spans]);
    expect(dump).not.toMatch(/ZETA-QUASAR/);
    expect(dump).not.toMatch(/ana\.privada/);
  });

  it("measures the AI Gateway: calls, latency and fallbacks as metrics, never by company or by model", async () => {
    const { core, platform } = setup();
    let state = agentWorld();
    const first = await platform.run("agents", state, startEvent(state));
    const done = await platform.run("agents", first.state, { type: "session.run", at: at(), tenantId: NOVA, actor: SYSTEM, sessionId: first.session!.id });
    const provider = done.state.ai.gateway.calls[0]!.providerId!;
    const down = await platform.run("gateway", done.state.ai.gateway, { type: "provider.incident", at: at(), tenantId: "platform", actor: SYSTEM, providerId: provider, mode: "down" });
    state = { ...done.state, ai: { ...done.state.ai, gateway: down.state } };
    const second = await platform.run("agents", state, startEvent(state));
    await platform.run("agents", second.state, { type: "session.run", at: at(), tenantId: NOVA, actor: SYSTEM, sessionId: second.session!.id });
    const series = (await core.metrics()).snapshot();
    const calls = series.filter((item) => item.name === "kynova_ai_gateway_calls_total");
    expect(calls.find((item) => item.labels.outcome === "ok")?.value).toBe(2);
    expect(series.find((item) => item.name === "kynova_ai_gateway_fallbacks_total")?.value).toBe(1);
    expect(series.find((item) => item.name === "kynova_ai_gateway_latency_ms")?.count).toBe(2);
    expect(series.find((item) => item.name === "kynova_agent_sessions_total" && item.labels.status === "completed")?.value).toBe(2);
    for (const item of series) {
      expect(Object.keys(item.labels).every((key) => (ALLOWED_LABELS as readonly string[]).includes(key)), item.name).toBe(true);
      expect(JSON.stringify(item.labels)).not.toMatch(/tenant|gw-|nova|vida/);
    }
  });

  it("traces it: one trace per call, with a child span for each AI Gateway call that keeps the duration the Gateway simulated", async () => {
    const { core, result } = await completedSession();
    const gateway = core.spans.spans.find((item) => item.name === "ai.gateway.call")!;
    const root = core.spans.spans.find((item) => item.spanId === gateway.parentId)!;
    expect(root.name).toBe("reducer.agents");
    expect(gateway.traceId).toBe(root.traceId);
    const call = result.state.ai.gateway.calls[0]!;
    expect(gateway.durationMs).toBe(call.latencyMs);
    expect(gateway.attributes).toMatchObject({ tenantId: NOVA, callId: call.id, fallback: false });
    expect(new Date(gateway.endedAt).getTime() - new Date(gateway.startedAt).getTime()).toBe(call.latencyMs);
  });

  it("puts the same trace id on the events and the audit records of a call", async () => {
    const { core } = await completedSession();
    const run = core.spans.spans.filter((item) => item.name === "reducer.agents").at(-1)!;
    const events = (await core.events()).store.read({ tenantId: NOVA, after: 0, limit: 1_000 }).filter((item) => item.correlationId === run.traceId);
    const records = (await core.audit()).list(NOVA).filter((item) => item.requestId === run.traceId);
    expect(events.length).toBeGreaterThan(3);
    expect(records.length).toBeGreaterThan(3);
  });

  it("connects the AI request and the Gateway on their own too, with the incident under the platform and the call under its company", async () => {
    const { core, platform } = setup();
    const incident = await platform.run("gateway", newGatewayState(), { type: "provider.incident", at: at(), tenantId: "platform", actor: SYSTEM, providerId: GATEWAY_PROVIDERS[0]!.id, mode: "down" });
    expect(incident.error).toBeUndefined();
    expect((await core.events()).store.read({ tenantId: "platform", after: 0, limit: 10 }).map((item) => item.type)).toEqual(["koe.audit.recorded"]);
    const asked = await platform.run("ai", newAiState(), { type: "ai.request", at: at(), tenantId: NOVA, actor: "worker:nex", caller: "nex", purposeId: "faq.answer", input: { user: "¿Horario?" } });
    expect(asked.record?.status).toBe("ok");
    const types = (await core.events()).store.read({ tenantId: NOVA, after: 0, limit: 50 }).map((item) => item.type);
    expect(types).toContain("koe.ai.call.recorded");
    expect(types).toContain("koe.audit.recorded");
    expect((await core.metrics()).snapshot().find((item) => item.name === "kynova_ai_requests_total")?.labels.outcome).toBe("ok");
  });

  it("keeps the module's own results untouched: the same session through the connector and without it gives the same state", async () => {
    const { platform } = setup();
    const state = agentWorld();
    const event = startEvent(state);
    const direct = reduceAgent(state, event);
    const wrapped = await platform.run("agents", state, event);
    expect(wrapped.state).toEqual(direct.state);
    expect(wrapped.session).toEqual(direct.session);
  });
});

// ================================================================ isolation between companies
describe("total isolation between companies", () => {
  async function twoCompanies() {
    const made = setup();
    let state = agentWorld();
    const nova = await made.platform.run("agents", state, startEvent(state, NOVA));
    state = nova.state;
    const vida = await made.platform.run("agents", state, startEvent(state, VIDA));
    state = vida.state;
    state = (await made.platform.run("agents", state, { type: "session.run", at: at(), tenantId: NOVA, actor: SYSTEM, sessionId: nova.session!.id })).state;
    state = (await made.platform.run("agents", state, { type: "session.run", at: at(), tenantId: VIDA, actor: SYSTEM, sessionId: vida.session!.id })).state;
    return { ...made, state };
  }

  it("keeps each company's events, audit and chain apart", async () => {
    const { core, platform } = await twoCompanies();
    expect(platform.tenants()).toEqual([VIDA, NOVA].sort());
    for (const tenantId of [NOVA, VIDA]) {
      const events = (await core.events()).store.read({ tenantId, after: 0, limit: 10_000 });
      const records = (await core.audit()).list(tenantId);
      expect(events.length).toBeGreaterThan(0);
      expect(events.every((item) => item.tenantId === tenantId)).toBe(true);
      expect(records.every((item) => item.tenantId === tenantId)).toBe(true);
      expect(await (await core.audit()).verify(tenantId)).toMatchObject({ ok: true, records: records.length });
      expect(await platform.coverage(tenantId)).toMatchObject({ ok: true });
    }
    const viewed = await koeView(core).readEvents(NOVA);
    expect(viewed.every((item) => item.tenantId === NOVA)).toBe(true);
  });

  it("keeps each company's persisted rows apart and valid against the data contract", async () => {
    const { platform } = await twoCompanies();
    const written = await platform.persist(NOVA);
    expect(written.events.inserted).toBeGreaterThan(0);
    expect(written.audit.inserted).toBeGreaterThan(0);
    await platform.persist(VIDA);
    for (const tenantId of [NOVA, VIDA]) {
      for (const table of ["platform_events", "audit_log"] as const) {
        const rows = await platform.database.select(table, tenantId);
        expect(rows.length, `${table}/${tenantId}`).toBeGreaterThan(0);
        expect(rows.every((row) => row["tenant_id"] === tenantId)).toBe(true);
        for (const row of rows.slice(0, 20)) expect(validateRow(table, row), `${table}`).toEqual([]);
      }
    }
    const again = await platform.persist(NOVA);
    expect(again.events.inserted).toBe(0);
    expect(again.events.skipped).toBe(written.events.inserted);
  });

  it("seals each company's archive with its own context, under its own folder, and no other company can read or open it", async () => {
    const { core, platform, key } = await twoCompanies();
    const archived = await platform.archive(NOVA);
    expect(archived.ok).toBe(true);
    if (!archived.ok) return;
    expect(archived.path.startsWith(`${NOVA}/`)).toBe(true);
    expect(canAccessPath(NOVA, archived.path)).toBe(true);
    expect(canAccessPath(VIDA, archived.path)).toBe(false);
    expect((await platform.readArchive(VIDA, archived.path)).ok).toBe(false);
    const opened = await platform.readArchive(NOVA, archived.path);
    expect(opened.ok && opened.records.length).toBe(archived.records);
    const sealed = new TextDecoder().decode((await platform.storage.get(archived.path))!);
    expect(sealed).not.toMatch(/worker\.enable|session\.start|tenant-nova/);
    await expect(decrypt(sealed, key, VIDA)).rejects.toThrow();
    expect(await decrypt(sealed, key, NOVA)).toContain(NOVA);
    const stored = await platform.database.select("storage_objects", NOVA);
    expect(stored).toHaveLength(1);
    expect(validateRow("storage_objects", stored[0]!)).toEqual([]);
    expect(await platform.database.select("storage_objects", VIDA)).toHaveLength(0);
    const log = core.secrets.accessLog();
    expect(log.length).toBeGreaterThan(0);
    expect(log.every((item) => item.name === "KYNOVA_ENCRYPTION_KEY" && item.purpose === "audit-archive")).toBe(true);
    expect(JSON.stringify([log, core.logs.entries])).not.toContain(key);
  });

  it("archives nothing without the key or without records, and says why", async () => {
    const bare = connectPlatform(createBackendCore({ vars: {}, now: tick }));
    expect((await bare.archive(NOVA)).ok).toBe(false);
    const { core, platform } = setup();
    await platform.run("workers", newKoeState(["admin:ana"]), { type: "worker.enable", at: at(), tenantId: NOVA, actor: ANA, definitionId: "sales" });
    const none = connectPlatform(createBackendCore({ vars: { KYNOVA_ENCRYPTION_KEY: generateEncryptionKey() }, now: tick }));
    await none.run("workers", newKoeState(["admin:ana"]), { type: "worker.enable", at: at(), tenantId: NOVA, actor: ANA, definitionId: "sales" });
    const noKey = connectPlatform(core);
    expect((await noKey.archive(VIDA)).ok).toBe(false);
    const withoutSecret = createBackendCore({ vars: {}, now: tick });
    const platformWithoutSecret = connectPlatform(withoutSecret);
    await platformWithoutSecret.run("workers", newKoeState(["admin:ana"]), { type: "worker.enable", at: at(), tenantId: NOVA, actor: ANA, definitionId: "sales" });
    const result = await platformWithoutSecret.archive(NOVA);
    expect(result).toMatchObject({ ok: false });
    expect(platformWithoutSecret.storage.constructor.name).toBe("MemoryStorage");
    expect((await platformWithoutSecret.database.select("storage_objects", NOVA))).toHaveLength(0);
  });
});

// ================================================================ completeness and health
describe("coverage and health", () => {
  it("proves everything audited went through the Event Bus, and notices an audit record that did not", async () => {
    const { core, platform } = setup();
    let state = agentWorld();
    const started = await platform.run("agents", state, startEvent(state));
    state = (await platform.run("agents", started.state, { type: "session.run", at: at(), tenantId: NOVA, actor: SYSTEM, sessionId: started.session!.id })).state;
    expect(await verifyCoverage(core, NOVA)).toMatchObject({ ok: true, missing: [] });
    await (await core.audit()).record({ tenantId: NOVA, actorId: ANA, actorKind: "person", module: "crm", action: "lead.created", category: "other", outcome: "success", at: at() });
    const covered = await verifyCoverage(core, NOVA);
    expect(covered.ok).toBe(false);
    expect(covered.missing).toHaveLength(1);
    expect((await platform.health()).checks.find((item) => item.name === "bus_coverage")?.status).toBe("down");
  });

  it("reports the health of the join: the core's checks and the integration's, as one report and as gauges", async () => {
    const { core, platform } = setup();
    let state = agentWorld();
    const started = await platform.run("agents", state, startEvent(state));
    state = (await platform.run("agents", started.state, { type: "session.run", at: at(), tenantId: NOVA, actor: SYSTEM, sessionId: started.session!.id })).state;
    await platform.persist(NOVA);
    await platform.archive(NOVA);
    const report = await platform.health();
    const names = report.checks.map((item) => item.name);
    for (const name of ["environment", "secrets", "supabase", "rls", "storage", "event_bus", "audit_chain", "bus_coverage", "tenancy", "bridges", "persistence", "file_storage", "secrets_access"]) expect(names, name).toContain(name);
    for (const name of ["event_bus", "audit_chain", "bus_coverage", "tenancy", "bridges", "persistence", "file_storage", "secrets_access"]) expect(report.checks.find((item) => item.name === name)?.status, name).toBe("ok");
    expect(report.status).not.toBe("down");
    const gauges = (await core.metrics()).snapshot().filter((item) => item.name === "kynova_health_ok");
    expect(gauges.length).toBe(names.length);
    expect(report.checks.find((item) => item.name === "persistence")?.detail).toMatch(/no activado/);
  });
});

// ================================================================ prepared Supabase and RLS
describe("Supabase and RLS, prepared and never used", () => {
  const row: Row = eventRow({ id: "e1", type: "crm.audit.recorded", version: 1, module: "crm", tenantId: NOVA, actor: ANA, at: "2026-11-10T12:00:00.000Z", payload: { action: "x", category: "y" }, seq: 1 });
  const fake = () => {
    const calls: string[] = [];
    const client: DatabaseClient = {
      from: (table) => ({
        insert: async (rows) => { calls.push(`insert:${table}:${rows.length}`); return { error: null }; },
        select: () => ({ eq: async (column, value) => { calls.push(`select:${table}:${column}=${value}`); return { data: [], error: null }; } }),
      }),
    };
    return { calls, client };
  };

  it("writes nothing while no environment admits real data, and never even loads the client", async () => {
    for (const environment of ["development", "preview", "production"] as const) {
      let loaded = false;
      const adapter = new SupabasePersistence({ environment, client: async () => { loaded = true; return fake().client; } });
      const written = await adapter.insert("platform_events", [row]);
      expect(written).toMatchObject({ inserted: 0, skipped: 1 });
      expect(written.blocked).toMatch(/datos reales/);
      expect(await adapter.select("platform_events", NOVA)).toEqual([]);
      expect(loaded, environment).toBe(false);
    }
  });

  it("when real data is allowed (a test says so), reads only by company, inserts only into the three append-only tables, and checks every row first", async () => {
    const { calls, client } = fake();
    const adapter = new SupabasePersistence({ environment: "development", client: async () => client, policy: { realData: true } });
    expect(await adapter.insert("platform_events", [row])).toMatchObject({ inserted: 1 });
    await adapter.select("audit_log", NOVA);
    expect(calls).toEqual(["insert:platform_events:1", `select:audit_log:tenant_id=${NOVA}`]);
    await expect(adapter.insert("platform_events", [{ ...row, tenant_id: null }])).rejects.toThrow(/fila no válida/);
    await expect(adapter.insert("users" as never, [row])).rejects.toThrow();
    expect(Object.getOwnPropertyNames(SupabasePersistence.prototype).filter((name) => /update|delete|remove|upsert/i.test(name))).toEqual([]);
    expect(Object.getOwnPropertyNames(SimulatedDatabase.prototype).filter((name) => /update|delete|remove|upsert/i.test(name))).toEqual([]);
  });

  it("shapes its rows by the data contract: complete, typed, and nothing the table does not have", () => {
    expect(validateRow("platform_events", row)).toEqual([]);
    expect(validateRow("platform_events", { ...row, extra: "x" })).toEqual(["la columna extra no existe en platform_events"]);
    const { id: _id, ...withoutId } = row;
    expect(validateRow("platform_events", withoutId)).toContain("falta la columna id");
    expect(validateRow("audit_log", auditRow({ id: "a1", seq: 1, prevHash: "0", hash: "h", tenantId: NOVA, actorId: ANA, actorKind: "person", module: "crm", action: "a", category: "c", outcome: "success", at: "2026-11-10T12:00:00.000Z" }))).toEqual([]);
    expect(validateRow("storage_objects", storageRow({ id: "o1", tenantId: NOVA, bucket: "documents", path: `${NOVA}/documents/system/x.txt`, mime: "text/plain", bytes: 10, at: "2026-11-10T12:00:00.000Z" }))).toEqual([]);
  });

  it("uses the policies already written: every table it touches is per company and has them, and none is activated", () => {
    const report = persistedTablesReport();
    expect(report.map((item) => item.table)).toEqual([...PERSISTED_TABLES]);
    for (const item of report) {
      expect(item.tenantScoped, item.table).toBe(true);
      expect(item.policies, item.table).toBeGreaterThan(0);
      expect(item.activated).toBe(false);
    }
    expect(report.find((item) => item.table === "platform_events")?.appendOnly).toBe(true);
    expect(RLS_STATE.activated).toBe(false);
    const migrations = join(process.cwd(), "supabase", "migrations");
    const sql = readdirSync(migrations).map((name) => readFileSync(join(migrations, name), "utf8")).join("\n");
    for (const table of PERSISTED_TABLES) expect(ENTITIES.some((item) => item.table === table), table).toBe(true);
    expect(sql).not.toMatch(/platform_events|storage_objects/);
    expect(readdirSync(migrations)).toHaveLength(6);
  });
});

// ================================================================ the rules, in the code
describe("the rules of the integration in the code", () => {
  const ROOT = process.cwd();
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next" || name === ".git" || name === ".open-next") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out); else out.push(full);
    }
    return out;
  };
  const files = walk(join(ROOT, "lib", "backend", "integration")).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
  const strip = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("only reads the modules: it imports their reducers and types, and no module imports the Backend Core", () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    const sources = ["app", "components", "lib", "config"].flatMap((dir) => walk(join(ROOT, dir))).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !file.replace(/\\/g, "/").includes("/lib/backend/") && !file.replace(/\\/g, "/").endsWith("lib/db/core-clients.ts"));
    expect(sources.filter((file) => /from "@\/lib\/backend/.test(readFileSync(file, "utf8")))).toEqual([]);
  });

  it("makes no network call, reads no environment, holds no key and calls no provider", () => {
    for (const file of files) {
      const code = strip(readFileSync(file, "utf8"));
      expect(code, file).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|process\.env|node:https?|node:net/);
      expect(code, file).not.toMatch(/\b(openai|anthropic|claude|gemini|stripe|twilio|whatsapp|gmail|outlook|googleapis|sendgrid|paypal)\b/i);
    }
  });

  it("never subscribes to the bus: it only publishes", () => {
    for (const file of files) expect(strip(readFileSync(file, "utf8")), file).not.toMatch(/\.subscribe\(/);
  });
});
