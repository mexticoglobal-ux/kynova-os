/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PROVIDER_FAMILIES, newConnectorsState, reduceConnectors, type ConnectorEnv, type ConnectorsEvent } from "@/lib/contracts/platform/connectors";
import type { ExecutionPlan } from "@/lib/nex/execution";
import { ExecutionGateway, requestIdFor, type GatewayRecord } from "@/lib/nex/execution-gateway";
import { WorkerOsEngine, type Principal as OsPrincipal } from "@/lib/nex/worker-os";
import { WorkerRuntimeEngine, type Principal as RuntimePrincipal } from "@/lib/nex/worker-runtime";
import { TOOL_OF_CONNECTOR, connectorAction, gatewaySources, osFact, planFact, runtimeFact } from "./execution-bridge";

const T1 = "tenant-nova";
const START = Date.parse("2026-11-13T10:00:00.000Z");
const iso = (minutes: number) => new Date(START + minutes * 60_000).toISOString();
const ROLES: Record<string, "member" | "manager" | "admin" | "owner"> = { ana: "owner", adela: "admin", marta: "manager" };
const adela: OsPrincipal & RuntimePrincipal = { kind: "person", tenantId: T1, id: "adela", role: "admin" };

/** A plan as the Execution layer would hand it over (hand-built: the Copilot is not needed to prove the bridge). */
const plan = (over: Record<string, unknown> = {}, stepOver: Record<string, unknown> = {}): ExecutionPlan =>
  ({
    id: "xp:f1", tenantId: T1, status: "Approved", priority: "normal", decidedBy: "adela", dependsOn: [],
    steps: [{ id: "s1", action: "message.draft", authorizationLevel: 1, approverRole: "member", worker: { specialty: "sales" }, timeoutMs: 60_000, retry: { maxAttempts: 1, backoffMs: 1_000 }, dependsOn: [], state: "pending", connector: "gmail", ...stepOver }],
    ...over,
  }) as unknown as ExecutionPlan;

/** The REAL Worker OS and Worker Runtime engines, with one worker brought up the way a person would. */
function layers() {
  const clock = { t: START, advance(ms: number) { this.t += ms; } };
  const os = new WorkerOsEngine({ now: () => clock.t });
  const runtime = new WorkerRuntimeEngine({ now: () => clock.t });
  expect(os.create(adela, T1, {
    workerId: "w1", companyId: T1, version: "1.2.0", build: "b1", runtimeVersion: "1.0.0", platformVersion: "1.0.0", specialty: "Sales", capabilities: [{ id: "read", version: "1.0.0" }], skills: [], tools: ["Email"],
    permissions: ["message.draft"], limits: { maxConcurrent: 2, queueLimit: 1, timeoutMs: 120_000, maxActionsPerDay: 100 },
  }).ok).toBe(true);
  expect(runtime.register(adela, T1, { id: "w1", name: "Ventas", specialty: "sales", permissions: ["*"], version: "1.2.0", build: "b1", capabilities: [], maxConcurrent: 2, queueLimit: 1 }).ok).toBe(true);
  expect(runtime.start(adela, T1, "w1").ok).toBe(true);
  clock.advance(1_000);
  expect(runtime.heartbeat({ kind: "worker", tenantId: T1, id: "w1" }, T1, { workerId: "w1", companyId: T1, timestamp: new Date(clock.t).toISOString(), cpu: 1, memory: 1, queueLength: 0, runningTasks: 0, version: "1.2.0" }).ok).toBe(true);
  return { clock, os, runtime };
}
function gateway(plans: readonly ExecutionPlan[], parts = layers()) {
  const gw = new ExecutionGateway({ now: () => parts.clock.t, sources: () => gatewaySources({ plans, runtimeWorkers: parts.runtime.workersFor(adela), osWorkers: parts.os.workersFor(adela), roleOf: (id) => ROLES[id] }) });
  return { gw, parts };
}
const system: RuntimePrincipal = { kind: "system", tenantId: T1 };

describe("the facts of the real layers, in the shape the Gateway reads", () => {
  it("maps the plan, the Worker Runtime record and the Worker OS record without inventing anything", () => {
    const { os, runtime } = layers();
    expect(planFact(plan())).toEqual({
      planId: "xp:f1", tenantId: T1, status: "Approved", priority: "normal", decidedBy: "adela", dependsOn: [],
      steps: [{ stepId: "s1", actionId: "message.draft", level: 1, approverRole: "member", specialty: "sales", state: "pending", dependsOn: [], timeoutMs: 60_000, retry: { maxAttempts: 1, backoffMs: 1_000 }, tools: ["Email"], capabilities: [] }],
    });
    expect(runtimeFact(runtime.workersFor(adela)[0]!)).toEqual({ workerId: "w1", tenantId: T1, state: "Idle", version: "1.2.0", maxConcurrent: 2, current: 0 });
    expect(osFact(os.workersFor(adela)[0]!)).toEqual({ workerId: "w1", companyId: T1, status: "Active", specialty: "sales", version: "1.2.0", capabilities: ["read"], tools: ["Email"], permissions: ["message.draft"], limits: { timeoutMs: 120_000 } });
    expect("decidedBy" in planFact(plan({ decidedBy: undefined }))).toBe(false); // nobody approved: nobody is named
  });
  it("a connector with no matching tool asks for none, and the mapped ones are fixed", () => {
    expect(planFact(plan({}, { connector: "whatsapp" })).steps[0]!.tools).toEqual([]);
    expect(planFact(plan({}, { connector: undefined })).steps[0]!.tools).toEqual([]);
    expect(TOOL_OF_CONNECTOR).toEqual({ gmail: "Email", outlook: "Email", googleCalendar: "Calendar", msCalendar: "Calendar", googleDrive: "Drive", onedrive: "Drive" });
  });
});

describe("approved plan → Worker Runtime → Worker OS → Gateway → connector action (simulated)", () => {
  /** Enables the company, authorizes Gmail (read and send) and puts sending on "approval": all through the existing Connectors reducer. */
  function connected() {
    const env: ConnectorEnv = { configuredFamilies: [...PROVIDER_FAMILIES], workers: [{ tenantId: T1, id: "w1", status: "active" }] };
    const send = (state: ReturnType<typeof newConnectorsState>, event: ConnectorsEvent) => { const result = reduceConnectors(state, event, env); expect(result.error, result.error).toBeUndefined(); return result; };
    let state = send(newConnectorsState(), { tenantId: T1, actor: "ana", at: iso(0), type: "tenant.enable" }).state;
    const code = "state-0000000001-abcdef";
    const started = send(state, { tenantId: T1, actor: "ana", at: iso(1), type: "connect.start", connectorId: "gmail", scopes: ["readMail", "sendMail"], redirectUri: "https://kynova.example/oauth/callback", state: code, codeChallenge: "x".repeat(43) });
    const done = send(started.state, { tenantId: T1, actor: "system", at: iso(2), type: "oauth.callback", connectorId: "gmail", state: code, code: "provider-code", accountId: "gmail-1", accountLabel: "nova@gmail", grantedScopes: ["readMail", "sendMail"] });
    state = send(done.state, { tenantId: T1, actor: "ana", at: iso(3), type: "permissions.set", connectionId: done.connection!.id, scope: "sendMail", grant: "approval" }).state;
    return { state, env, connectionId: done.connection!.id };
  }
  const route = (connectionId: string) => ({ connectionId, scope: "sendMail", operation: "send", summary: "Enviar borrador" });

  it("a Ready request becomes the connector's own action request, and the connector still waits for a person", () => {
    const { gw } = gateway([plan()]);
    expect(gw.submit(system, T1, { planId: "xp:f1", stepId: "s1", workerId: "w1" }).ok).toBe(true);
    const ready = gw.validate(system, T1, requestIdFor("xp:f1", "s1")).record!;
    expect(ready.state).toBe("Ready");
    const { state, env, connectionId } = connected();
    const event = connectorAction(ready, route(connectionId), iso(10))!;
    expect(event).toMatchObject({ tenantId: T1, actor: "worker:w1", workerId: "w1", type: "action.request", scope: "sendMail" });
    const result = reduceConnectors(state, event, env);
    expect(result.error).toBeUndefined();
    expect(result.action).toMatchObject({ status: "awaitingApproval", workerId: "w1", connectorId: "gmail" }); // the connector, not the bridge, holds the person's approval
    expect(reduceConnectors(state, { ...event, actor: "system" }, env).errorCode).toBe("workerRequired"); // and nobody else may ask it
  });
  it("only a Ready request is passed on", () => {
    const { gw } = gateway([plan({ status: "WaitingApproval" })]);
    gw.submit(system, T1, { planId: "xp:f1", stepId: "s1", workerId: "w1" });
    const waiting = gw.validate(system, T1, requestIdFor("xp:f1", "s1")).record!;
    expect(waiting.state).toBe("WaitingApproval");
    expect(connectorAction(waiting, route("c1"), iso(10))).toBeUndefined();
    const blocked = { ...waiting, state: "Blocked" } as GatewayRecord;
    expect(connectorAction(blocked, route("c1"), iso(10))).toBeUndefined();
  });
  it("the real layers' facts are what blocks: a worker the runtime reports as stopped is not given the step", () => {
    const parts = layers();
    expect(parts.runtime.stop(adela, T1, "w1").ok).toBe(true);
    const { gw } = gateway([plan()], parts);
    gw.submit(system, T1, { planId: "xp:f1", stepId: "s1", workerId: "w1" });
    const verdict = gw.validate(system, T1, requestIdFor("xp:f1", "s1")).record!;
    expect(verdict.state).toBe("Blocked");
    expect(verdict.reasons).toEqual(["worker.state"]);
  });
  it("a permission the Worker OS does not declare blocks it, and a step above the approver's role waits", () => {
    const parts = layers();
    expect(parts.os.setPermissions(adela, T1, "w1", ["crm.read"]).ok).toBe(true);
    const a = gateway([plan()], parts);
    a.gw.submit(system, T1, { planId: "xp:f1", stepId: "s1", workerId: "w1" });
    expect(a.gw.validate(system, T1, requestIdFor("xp:f1", "s1")).record!.reasons).toEqual(["action.denied"]);
    const b = gateway([plan({}, { authorizationLevel: 3, approverRole: "admin", action: "message.draft" })]);
    b.gw.submit(system, T1, { planId: "xp:f1", stepId: "s1", workerId: "w1" });
    expect(b.gw.validate(system, T1, requestIdFor("xp:f1", "s1")).record!.state).toBe("Ready"); // adela is an administrator
    const c = gateway([plan({ decidedBy: "marta" }, { authorizationLevel: 3, approverRole: "admin" })]);
    c.gw.submit(system, T1, { planId: "xp:f1", stepId: "s1", workerId: "w1" });
    expect(c.gw.validate(system, T1, requestIdFor("xp:f1", "s1")).record!.reasons).toEqual(["role.insufficient"]);
  });
});

describe("the bridge is glue only", () => {
  it("reads no clock, calls no provider, no adapter and no network, and approves nothing", () => {
    const source = readFileSync(join(process.cwd(), "lib", "nex", "execution-bridge", "execution-bridge.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
    expect(source).not.toMatch(/Date\.now|new Date\(\)|Math\.random|\bfetch\(|process\.env|ADAPTERS|\.perform\(|\.sync\(|\.exchangeCode\(|action\.approve|reduceConnectors|reduceGateway/);
    expect(source).toMatch(/import type/);
    expect(source.match(/^import (?!type)/gm)).toBeNull(); // type-only imports: nothing of the other layers runs through here
  });
});
