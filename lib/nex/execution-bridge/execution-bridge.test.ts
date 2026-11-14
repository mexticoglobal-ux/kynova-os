/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateEncryptionKey } from "@/lib/backend/crypto";
import { MemorySecretsProvider, SecretsManager } from "@/lib/backend/secrets";
import { CONNECTORS, FAMILY_SECRETS, PROVIDER_FAMILIES, configuredFamilies, newConnectorsState, reduceConnectors, type ConnectorEnv, type ConnectorId, type ConnectorsEvent, type ConnectorsState } from "@/lib/contracts/platform/connectors";
import { newCrmState, reduceCrm, type CrmEvent, type CrmState } from "@/lib/contracts/platform/crm-center";
import { EncryptedMemoryVault, GoogleWorkspace, workspaceView, type GoogleDeps, type WorkspaceResult } from "@/lib/integrations/google";
import { fakeGoogle } from "@/lib/integrations/google/fake-google";
import { ExecutionEngine, type ExecutionPlan } from "@/lib/nex/execution";
import { ExecutionGateway, requestIdFor, type GatewayRecord } from "@/lib/nex/execution-gateway";
import { OrchestratorEngine } from "@/lib/nex/runtime-orchestrator";
import { WorkerOsEngine, type Principal as OsPrincipal } from "@/lib/nex/worker-os";
import { WorkerRuntimeEngine, type Principal as RuntimePrincipal } from "@/lib/nex/worker-runtime";
import { EXPIRED_REASON, approvalInbox, approveAction, expireDue, holdForApproval, rejectAction } from "./approval-center";
import { ACTION_OF_TASK_KIND, GOOGLE_OPERATION_OF_ACTION, TOOL_OF_CONNECTOR, connectorAction, crmCopilotOutput, crmRecordsAfterApproval, gatewaySources, googleOperationOf, googleRequest, mailParams, osFact, planFact, planFromCrmTasks, runtimeFact, syncOrchestrator, visitParams, withQueueStates, type SyncOutcome } from "./execution-bridge";

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
  // the second worker does what the planner gives to Operations: the Calendar
  expect(os.create(adela, T1, {
    workerId: "w2", companyId: T1, version: "1.2.0", build: "b1", runtimeVersion: "1.0.0", platformVersion: "1.0.0", specialty: "Operations", capabilities: [{ id: "read", version: "1.0.0" }], skills: [], tools: ["Calendar"],
    permissions: ["calendar.write"], limits: { maxConcurrent: 2, queueLimit: 1, timeoutMs: 120_000, maxActionsPerDay: 100 },
  }).ok).toBe(true);
  expect(runtime.register(adela, T1, { id: "w2", name: "Operaciones", specialty: "operations", permissions: ["*"], version: "1.2.0", build: "b1", capabilities: [], maxConcurrent: 2, queueLimit: 1 }).ok).toBe(true);
  expect(runtime.start(adela, T1, "w1").ok).toBe(true);
  expect(runtime.start(adela, T1, "w2").ok).toBe(true);
  clock.advance(1_000);
  for (const id of ["w1", "w2"]) expect(runtime.heartbeat({ kind: "worker", tenantId: T1, id }, T1, { workerId: id, companyId: T1, timestamp: new Date(clock.t).toISOString(), cpu: 1, memory: 1, queueLength: 0, runningTasks: 0, version: "1.2.0" }).ok).toBe(true);
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

describe("approved plan → … → Gateway → Google Workspace (Gmail, Calendar, Drive) with the fake Google: no network, no credentials", () => {
  const CLIENT_ID = `client-id-${"a".repeat(20)}`;
  const CLIENT_SECRET = `client-secret-${"b".repeat(24)}`;
  const REDIRECT = "https://kynova.example/api/google/callback";
  /** The existing Sprint 41 harness, in short: a fake Google, an encrypted vault and the app's secrets from a memory provider. */
  function google() {
    const fake = fakeGoogle({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, now: START });
    const key = generateEncryptionKey();
    const vault = new EncryptedMemoryVault({ encrypt: (plain, context) => encrypt(plain, key, context), decrypt: (envelope, context) => decrypt(envelope, key, context) });
    const secrets = new SecretsManager(new MemorySecretsProvider({ [FAMILY_SECRETS.google.clientId]: CLIENT_ID, [FAMILY_SECRETS.google.clientSecret]: CLIENT_SECRET }), () => new Date(fake.now()).toISOString());
    const deps: GoogleDeps = { fetchImpl: fake.fetch, secrets, vault, now: () => fake.now(), sleep: async () => undefined };
    const env: ConnectorEnv = { configuredFamilies: configuredFamilies(secrets), workers: [{ tenantId: T1, id: "w1", status: "active" }, { tenantId: T1, id: "w2", status: "active" }] };
    return { fake, env, ws: new GoogleWorkspace(deps), at: () => new Date(fake.now()).toISOString() };
  }
  type World = ReturnType<typeof google>;
  /** The company authorizes the three Google apps (reads automatic, writes on approval), as a person would. */
  async function authorized(w: World): Promise<ConnectorsState> {
    let state = reduceConnectors(newConnectorsState(), { tenantId: T1, actor: "ana", at: w.at(), type: "tenant.enable" }, w.env).state;
    for (const connectorId of ["gmail", "googleCalendar", "googleDrive"] as const) {
      const scopes = CONNECTORS[connectorId].scopes.map((row) => row.id);
      const begun = await w.ws.begin(state, w.env, { tenantId: T1, actor: "ana", at: w.at(), connectorId, scopes, redirectUri: REDIRECT });
      const url = new URL((begun.result as { url: string }).url);
      const oauth = url.searchParams.get("state")!;
      w.fake.grantCode({ code: `code-${oauth}`, challenge: url.searchParams.get("code_challenge")!, email: `${connectorId}@nova.test`, scopes: url.searchParams.get("scope")!.split(" ") });
      const finished = await w.ws.finish(begun.state, w.env, { tenantId: T1, at: w.at(), connectorId, state: oauth, code: `code-${oauth}`, redirectUri: REDIRECT });
      expect(finished.ok, finished.error).toBe(true);
      state = finished.state;
      for (const scope of finished.connection!.grantedScopes) {
        const write = CONNECTORS[connectorId].scopes.find((row) => row.id === scope)?.effect === "write";
        state = reduceConnectors(state, { tenantId: T1, actor: "ana", at: w.at(), type: "permissions.set", connectionId: finished.connection!.id, scope, grant: write ? "approval" : "auto" }, w.env).state;
      }
    }
    return state;
  }
  /** Three Level 3 steps (send an email, create an event, create a folder), each through its connector, approved by an administrator. */
  function readyRecords() {
    const parts = layers();
    expect(parts.os.setPermissions(adela, T1, "w1", ["calendar.write", "drive.*", "followup.send"]).ok).toBe(true);
    expect(parts.os.setTools(adela, T1, "w1", ["Calendar", "Drive", "Email"]).ok).toBe(true);
    const step = (id: string, action: string, connector: ConnectorId) => ({ id, action, authorizationLevel: 3, approverRole: "admin", worker: { specialty: "sales" }, timeoutMs: 60_000, retry: { maxAttempts: 1, backoffMs: 1_000 }, dependsOn: [], state: "pending", connector });
    const p = plan({ steps: [step("mail", "followup.send", "gmail"), step("event", "calendar.write", "googleCalendar"), step("folder", "drive.createFolder", "googleDrive")] });
    const { gw } = gateway([p], parts);
    const records: Record<string, GatewayRecord> = {};
    for (const stepId of ["mail", "event", "folder"]) {
      expect(gw.submit(system, T1, { planId: "xp:f1", stepId, workerId: "w1" }).ok).toBe(true);
      records[stepId] = gw.validate(system, T1, requestIdFor("xp:f1", stepId)).record!;
      expect(records[stepId]!.state).toBe("Ready");
    }
    return records;
  }
  const PARAMS = {
    mail: { to: ["cliente@x.test"], subject: "Propuesta", text: "Hola" },
    event: { summary: "Reunión", start: "2026-11-13T15:00:00Z", end: "2026-11-13T16:00:00Z" },
    folder: { name: "Propuestas" },
  };

  it("maps the platform's actions to the service's operations, and lets a Google operation id stand for itself", () => {
    expect(GOOGLE_OPERATION_OF_ACTION).toEqual({ "followup.send": "gmail.send", "message.sendFirst": "gmail.send", "message.sendSensitive": "gmail.send", "comms.send": "gmail.send", "calendar.write": "calendar.create" });
    expect(googleOperationOf("followup.send")).toBe("gmail.send");
    expect(googleOperationOf("drive.upload")).toBe("drive.upload");
    expect(googleOperationOf("task.create")).toBeUndefined();
    expect(googleOperationOf("payment.refund")).toBeUndefined();
  });
  it("Gmail, Calendar and Drive: a Ready request waits for a person in the connector, and only the approval makes the (fake) Google call", async () => {
    const w = google();
    let state = await authorized(w);
    const records = readyRecords();
    for (const [stepId, record] of Object.entries(records)) {
      const built = googleRequest(record, state, PARAMS[stepId as keyof typeof PARAMS], w.at());
      expect(built.ok, stepId).toBe(true);
      const held = await w.ws.request(state, w.env, (built as { input: Parameters<GoogleWorkspace["request"]>[2] }).input);
      expect(held.status, `${stepId} ${held.code}`).toBe("awaitingApproval");
      state = held.state;
    }
    expect(w.fake.sent).toHaveLength(0); // nothing left the platform yet
    expect(Object.keys(w.fake.events)).toHaveLength(0);
    expect(Object.keys(w.fake.files)).toHaveLength(0);
    const pending = state.actions.filter((row) => row.status === "awaitingApproval");
    expect(pending.map((row) => row.operation).sort()).toEqual(["calendar.create", "drive.createFolder", "gmail.send"]);
    for (const action of pending) {
      const approved = await w.ws.approve(state, w.env, { tenantId: T1, actor: "ana", actionId: action.id, at: w.at() });
      expect(approved.ok, `${action.operation} ${approved.code}`).toBe(true);
      state = approved.state;
    }
    expect(w.fake.sent).toHaveLength(1);
    expect(Object.keys(w.fake.events)).toHaveLength(1);
    expect(Object.keys(w.fake.files)).toHaveLength(1);
    expect(w.ws.executions.map((row) => `${row.operation}:${row.outcome}`).sort()).toEqual(["calendar.create:ok", "drive.createFolder:ok", "gmail.send:ok"]);
    expect(JSON.stringify([state, w.ws.executions])).not.toMatch(/cliente@x\.test|Propuesta|Hola/); // no content in the audit trail or the execution log
  });
  it("a Worker cannot approve its own request, and nothing else may ask the service for the worker", async () => {
    const w = google();
    const state = await authorized(w);
    const built = googleRequest(readyRecords()["mail"]!, state, PARAMS.mail, w.at()) as { ok: true; input: Parameters<GoogleWorkspace["request"]>[2] };
    const held = await w.ws.request(state, w.env, built.input);
    const attempt = await w.ws.approve(held.state, w.env, { tenantId: T1, actor: "worker:w1", actionId: held.action!.id, at: w.at() });
    expect(attempt.ok).toBe(false);
    expect(w.fake.sent).toHaveLength(0);
  });
  it("only a Ready request, a mapped operation and the company's own connection are passed on", async () => {
    const w = google();
    const state = await authorized(w);
    const records = readyRecords();
    expect(googleRequest({ ...records["mail"]!, state: "Blocked" }, state, {}, w.at())).toEqual({ ok: false, reason: "notReady" });
    expect(googleRequest({ ...records["mail"]!, request: { ...records["mail"]!.request, actionId: "task.create" } }, state, {}, w.at())).toEqual({ ok: false, reason: "unknownOperation" });
    expect(googleRequest(records["mail"]!, newConnectorsState(), {}, w.at())).toEqual({ ok: false, reason: "notConnected" });
    const otherCompany = { ...state, connections: state.connections.map((row) => ({ ...row, tenantId: "tenant-vida" })) };
    expect(googleRequest(records["mail"]!, otherCompany, {}, w.at())).toEqual({ ok: false, reason: "notConnected" }); // another company's connection is never used
  });

  describe("Approval Center: one inbox, approve, reject, expire", () => {
    /** A Ready request for an email, held in the inbox. */
    async function held() {
      const w = google();
      const state = await authorized(w);
      const result = await holdForApproval(w.ws, state, w.env, readyRecords()["mail"]!, PARAMS.mail, w.at());
      expect("status" in result && result.status).toBe("awaitingApproval");
      return { w, state: (result as { state: ConnectorsState }).state, actionId: (result as { action: { id: string } }).action.id };
    }
    const HOUR = 3_600_000;

    it("a Ready request waits in the inbox, with its deadline, and nothing leaves the platform", async () => {
      const { w, state, actionId } = await held();
      const inbox = approvalInbox(state, T1, w.at());
      expect(inbox).toEqual([expect.objectContaining({ actionId, connectorId: "gmail", workerId: "w1", operation: "gmail.send", status: "pending", summary: "Enviar un correo" })]);
      expect(Date.parse(inbox[0]!.expiresAt) - Date.parse(inbox[0]!.requestedAt)).toBe(24 * HOUR);
      expect(w.fake.sent).toHaveLength(0);
      expect(JSON.stringify(inbox)).not.toMatch(/cliente@x\.test|Propuesta|Hola/);
      expect(approvalInbox(state, "tenant-vida", w.at())).toEqual([]); // another company's inbox is empty
      expect(await holdForApproval(w.ws, state, w.env, { ...readyRecords()["mail"]!, state: "Blocked" }, {}, w.at())).toEqual({ ok: false, reason: "notReady" });
    });
    it("a person who administers the company approves: the connector continues and Google is called once, and the audit trail has it", async () => {
      const { w, state, actionId } = await held();
      const approved = await approveAction(w.ws, state, w.env, { tenantId: T1, actor: "ana", actionId, at: w.at() });
      expect(approved.ok, approved.code).toBe(true);
      expect(approved.status).toBe("done");
      expect(w.fake.sent).toHaveLength(1);
      expect(approvalInbox(approved.state, T1, w.at())).toEqual([]);
      expect(approved.state.audit.map((row) => `${row.actor}:${row.action}`).slice(-2)).toEqual(["worker:w1:action.request", "ana:action.approve"]);
      expect((await approveAction(w.ws, approved.state, w.env, { tenantId: T1, actor: "ana", actionId, at: w.at() })).ok).toBe(false); // it cannot be approved twice
      expect(w.fake.sent).toHaveLength(1);
    });
    it("a person rejects it with a reason: nothing is sent and it cannot be approved afterwards", async () => {
      const { w, state, actionId } = await held();
      const rejected = await rejectAction(w.ws, state, w.env, { tenantId: T1, actor: "ana", actionId, reason: "No es el cliente correcto", at: w.at() });
      expect(rejected.status).toBe("rejected");
      expect(rejected.state.actions.find((row) => row.id === actionId)).toMatchObject({ status: "rejected", decidedBy: "ana", failure: "No es el cliente correcto" });
      expect((await approveAction(w.ws, rejected.state, w.env, { tenantId: T1, actor: "ana", actionId, at: w.at() })).ok).toBe(false);
      expect(w.fake.sent).toHaveLength(0);
      expect(approvalInbox(rejected.state, T1, w.at())).toEqual([]);
    });
    it("only a person who administers the company decides: a Worker, the system, NEX and a non-administrator never do", async () => {
      const { w, state, actionId } = await held();
      for (const actor of ["worker:w1", "system", "nex", "agent:comercial", "marta"]) {
        const approve = await approveAction(w.ws, state, w.env, { tenantId: T1, actor, actionId, at: w.at() });
        const reject = await rejectAction(w.ws, state, w.env, { tenantId: T1, actor, actionId, reason: "x", at: w.at() });
        expect(approve.ok, actor).toBe(false);
        expect(reject.ok, actor).toBe(false);
      }
      expect((await approveAction(w.ws, state, w.env, { tenantId: "tenant-vida", actor: "luis", actionId, at: w.at() })).ok).toBe(false); // nor another company's
      expect(w.fake.sent).toHaveLength(0);
      expect(approvalInbox(state, T1, w.at())).toHaveLength(1);
    });
    it("a request past its deadline expires: it shows as expired, cannot be approved, and is closed by a person's rejection as expirada", async () => {
      const { w, state, actionId } = await held();
      w.fake.setClock(w.fake.now() + 25 * HOUR);
      expect(approvalInbox(state, T1, w.at()).map((row) => row.status)).toEqual(["expired"]);
      const late = await approveAction(w.ws, state, w.env, { tenantId: T1, actor: "ana", actionId, at: w.at() });
      expect(late).toMatchObject({ ok: false, status: "refused", code: "expired" });
      expect(w.fake.sent).toHaveLength(0);
      const system = await expireDue(w.ws, state, w.env, { tenantId: T1, actor: "system", at: w.at() });
      expect(system).toMatchObject({ expired: [], refused: [actionId] }); // the system cannot reject: nothing changes
      expect(system.state.actions.find((row) => row.id === actionId)!.status).toBe("awaitingApproval");
      const swept = await expireDue(w.ws, state, w.env, { tenantId: T1, actor: "ana", at: w.at() });
      expect(swept.expired).toEqual([actionId]);
      expect(swept.state.actions.find((row) => row.id === actionId)).toMatchObject({ status: "rejected", failure: EXPIRED_REASON });
      expect(approvalInbox(swept.state, T1, w.at())).toEqual([]);
      expect(w.fake.sent).toHaveLength(0);
    });
    it("the deadline is configurable, and a request inside it can still be approved", async () => {
      const { w, state, actionId } = await held();
      w.fake.setClock(w.fake.now() + 30 * 60_000);
      expect(approvalInbox(state, T1, w.at(), 60)[0]!.status).toBe("pending");
      expect(approvalInbox(state, T1, w.at(), 20)[0]!.status).toBe("expired");
      expect((await approveAction(w.ws, state, w.env, { tenantId: T1, actor: "ana", actionId, at: w.at(), ttlMinutes: 60 })).ok).toBe(true);
    });
  });

  /** Each worker gets only what its own job needs: Sales sends the email, Operations books the date. */
  function equip(parts: ReturnType<typeof layers>) {
    expect(parts.os.setPermissions(adela, T1, "w1", ["followup.send"]).ok).toBe(true);
    expect(parts.os.setTools(adela, T1, "w1", ["Email"]).ok).toBe(true);
    expect(parts.os.setPermissions(adela, T1, "w2", ["calendar.write"]).ok).toBe(true);
    expect(parts.os.setTools(adela, T1, "w2", ["Calendar"]).ok).toBe(true);
  }
  /** The accepted CRM tasks become the approved plan through the REAL Execution engine (no hand-built plan); the date task waits for the email task. */
  function crmPlan(parts: ReturnType<typeof layers>, crm: CrmState, leadId: string, mailTaskId: string, meetTaskId: string) {
    const exec = new ExecutionEngine({
      env: { isWorkerActive: (_tenantId, workerId) => ["w1", "w2"].includes(workerId) }, now: () => parts.clock.t, connected: () => ["gmail", "googleCalendar"],
      roster: () => ({ workers: [{ id: "w1", name: "Ventas", specialty: "sales", status: "active" }, { id: "w2", name: "Operaciones", specialty: "operations", status: "active" }] }),
    });
    const people = { preparer: { kind: "person" as const, tenantId: T1, id: "ana", role: "owner" as const }, approver: { kind: "person" as const, tenantId: T1, id: "adela", role: "admin" as const } };
    const result = planFromCrmTasks(exec, people, { tenantId: T1, leadId, tasks: crm.tasks, at: iso(0), after: { [meetTaskId]: [mailTaskId] } });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const approved = (result as { plan: ExecutionPlan }).plan;
    return { exec, plan: approved, mail: approved.steps.find((row) => row.action === "followup.send")!, meet: approved.steps.find((row) => row.action === "calendar.write")! };
  }


  describe("Nova Marketing Studio, end to end: lead → CRM task → plan → Gateway → bridge → Approval Center → Gmail + Calendar → CRM, audit and dashboard", () => {
    const crmEvent = (type: string, actor: string, extra: Record<string, unknown> = {}, minute = 0) => ({ type, tenantId: T1, actor, at: iso(minute), ...extra }) as CrmEvent;
    const apply = (state: CrmState, event: CrmEvent): CrmState => { const result = reduceCrm(state, event); expect(result.error, `${event.type}: ${result.error}`).toBeUndefined(); return result.state; };

    it("a new lead travels the whole way, with Google simulated, and everything is audited and on the dashboard", async () => {
      // 1. CRM: a Worker registers the lead and prepares the task (Level 1); a person accepts it
      let crm = apply(newCrmState(), crmEvent("lead.create", "worker:w1", { input: { name: "Laura Gómez", company: "Clínica Aurora", email: "laura@aurora.test", source: "web", estimatedValueMicros: 3_000_000_000, fit: 80 } }));
      const lead = crm.leads[0]!;
      crm = apply(crm, crmEvent("task.generate", "worker:w1", { leadId: lead.id }, 1));
      const task = crm.tasks.find((row) => row.kind === "email") ?? crm.tasks[0]!;
      expect(task).toMatchObject({ leadId: lead.id, status: "proposed" });
      expect(task.draft.length).toBeGreaterThan(0);
      crm = apply(crm, crmEvent("task.propose", "worker:w1", { leadId: lead.id, kind: "meeting", title: "Reunión de presentación", draft: "Agendar la reunión", dueInDays: 3 }, 2));
      const meetTask = crm.tasks.find((row) => row.kind === "meeting")!;
      for (const taskId of [task.id, meetTask.id]) crm = apply(crm, crmEvent("task.accept", "ana", { taskId }, 3));
      expect(crm.tasks.find((row) => row.id === task.id)!.status).toBe("accepted");

      // 2. the approved plan comes from the adapter (CRM tasks → the Execution engine's own plan): send the email, then book the meeting (it waits for the email)
      const parts = layers();
      equip(parts);
      const { plan: approved, mail, meet } = crmPlan(parts, crm, lead.id, task.id, meetTask.id);
      const planId = approved.id;
      const osys = { kind: "system" as const, tenantId: T1 };
      const orch = newOrchestrator(parts);
      expect(orch.enqueue(osys, T1, approved).ok).toBe(true);
      expect(orch.tick(osys, T1).ok).toBe(true);
      const gw = new ExecutionGateway({ now: () => parts.clock.t, sources: () => gatewaySources({ plans: [withQueueStates(approved, orch.queueFor(osys))], runtimeWorkers: parts.runtime.workersFor(adela), osWorkers: parts.os.workersFor(adela), roleOf: (id) => ROLES[id] }) });

      // 3. the Gateway: the email is Ready, the meeting waits for it
      for (const [step, workerId] of [[mail, "w1"], [meet, "w2"]] as const) expect(gw.submit(system, T1, { planId, stepId: step.id, workerId }).ok).toBe(true);
      const mailReady = gw.validate(system, T1, requestIdFor(planId, mail.id)).record!;
      const meetBlocked = gw.validate(system, T1, requestIdFor(planId, meet.id)).record!;
      expect(mailReady.state).toBe("Ready");
      expect([meetBlocked.state, meetBlocked.reasons]).toEqual(["Blocked", ["dependency.pending"]]);

      // 4. the bridge and the Approval Center: the email waits for a person, nothing is sent
      const w = google();
      let state = await authorized(w);
      const mailParams = { to: [lead.email!], subject: task.title, text: task.draft };
      const held = await holdForApproval(w.ws, state, w.env, mailReady, mailParams, w.at());
      expect("status" in held && held.status).toBe("awaitingApproval");
      state = (held as { state: ConnectorsState }).state;
      expect(approvalInbox(state, T1, w.at()).map((row) => row.operation)).toEqual(["gmail.send"]);
      expect(w.fake.sent).toHaveLength(0);

      // 5. a person approves: Gmail sends (simulated) with what the CRM prepared
      const mailSync = syncTo(orch, planId, mail.id);
      const sent = await approveAction(w.ws, state, w.env, { tenantId: T1, actor: "ana", actionId: (held as { action: { id: string } }).action.id, at: w.at(), after: mailSync.after });
      expect(sent.ok, sent.code).toBe(true);
      state = sent.state;
      expect(w.fake.sent).toHaveLength(1);
      expect(w.fake.sent[0]!.raw).toContain(`To: ${lead.email!}`);

      // 6. the Orchestrator reports the email done: now the meeting is Ready, waits for a person, and Calendar books it on approval
      expect(mailSync.seen).toEqual([{ outcome: "completed", item: "Completed" }]); // the Orchestrator was told by the adapter, not by hand
      parts.clock.advance(1_000);
      const meetReady = gw.validate(system, T1, requestIdFor(planId, meet.id)).record!;
      expect(meetReady.state).toBe("Ready");
      const meetParams = { summary: `Reunión con ${lead.name}`, start: "2026-11-16T15:00:00Z", end: "2026-11-16T16:00:00Z", attendees: [lead.email!] };
      const heldMeet = await holdForApproval(w.ws, state, w.env, meetReady, meetParams, w.at());
      expect("status" in heldMeet && heldMeet.status).toBe("awaitingApproval");
      expect(Object.keys(w.fake.events)).toHaveLength(0);
      const meetSync = syncTo(orch, planId, meet.id);
      const booked = await approveAction(w.ws, (heldMeet as { state: ConnectorsState }).state, w.env, { tenantId: T1, actor: "ana", actionId: (heldMeet as { action: { id: string } }).action.id, at: w.at(), after: meetSync.after });
      expect(booked.ok, booked.code).toBe(true);
      expect(meetSync.seen).toEqual([{ outcome: "completed", item: "Completed" }]);
      state = booked.state;
      expect(Object.keys(w.fake.events)).toHaveLength(1);

      // 7. the CRM records what happened (the system reports, a person books and closes)
      crm = apply(crm, crmEvent("timeline.record", "system", { subject: { kind: "lead", id: lead.id }, kind: "worker", summary: "Correo enviado por Gmail", ref: requestIdFor(planId, mail.id) }, 10));
      crm = apply(crm, crmEvent("meeting.schedule", "ana", { leadId: lead.id, scheduledFor: "2026-11-16T15:00:00Z", title: meetParams.summary }, 11));
      for (const taskId of [task.id, meetTask.id]) crm = apply(crm, crmEvent("task.complete", "ana", { taskId, note: "Correo enviado y reunión agendada" }, 12));
      expect(crm.meetings).toHaveLength(1);
      expect(crm.tasks.filter((row) => [task.id, meetTask.id].includes(row.id)).every((row) => row.status === "done")).toBe(true);

      // 8. everything is audited, in the layers' own trails, and the dashboards show the result
      expect(state.audit.map((row) => `${row.actor}:${row.action}`).filter((row) => /action\./.test(row))).toEqual(["worker:w1:action.request", "ana:action.approve", "worker:w2:action.request", "ana:action.approve"]);
      expect(gw.audit(T1).filter((row) => row.action === "request.created")).toHaveLength(2);
      expect(gw.audit(T1).some((row) => row.action === "request.validated")).toBe(true);
      expect(crm.audit.map((row) => row.action)).toEqual(expect.arrayContaining(["lead.create", "task.accept", "meeting.schedule", "task.complete"]));
      expect(w.ws.executions.map((row) => `${row.operation}:${row.outcome}`)).toEqual(["gmail.send:ok", "calendar.create:ok"]);
      expect(gw.dashboard(system).requests.byState).toMatchObject({ Ready: 2, Blocked: 0 });
      expect(approvalInbox(state, T1, w.at())).toEqual([]);
      const rows = workspaceView(state, w.ws.activities_(), T1, w.at());
      expect(rows.map((row) => `${row.connectorId}:${row.display}`)).toEqual(["gmail:Connected", "googleCalendar:Connected", "googleDrive:Connected"]);
      // no content of the lead or the email in any trail
      expect(JSON.stringify([state.audit, w.ws.executions, gw.exportState().audit, gw.log.all()])).not.toMatch(/laura@aurora\.test|Clínica Aurora|Laura Gómez/);
    });
  });

  describe("Real Estate, end to end: lead → opportunity → tasks → Orchestrator → Worker Runtime/OS → Gateway → Approval Center → Gmail + Calendar visit → CRM", () => {
    const crmEvent = (type: string, actor: string, extra: Record<string, unknown> = {}, minute = 0) => ({ type, tenantId: T1, actor, at: iso(minute), ...extra }) as CrmEvent;
    const apply = (state: CrmState, event: CrmEvent): CrmState => { const result = reduceCrm(state, event); expect(result.error, `${event.type}: ${result.error}`).toBeUndefined(); return result.state; };
    const osys = { kind: "system" as const, tenantId: T1 };

    it("a buyer's lead gets an email and a property visit, nothing leaves until an administrator approves, and the CRM records it all", async () => {
      // 1. CRM: a Worker registers the lead, a person qualifies it (the opportunity), KOE analyses it and prepares the commercial tasks; a person accepts them
      let crm = apply(newCrmState(), crmEvent("lead.create", "worker:w1", { input: { name: "Mariana Solís", company: "Solís Inversiones", email: "mariana@solis.test", source: "referido", estimatedValueMicros: 450_000_000_000, fit: 85 } }));
      const lead = crm.leads[0]!;
      crm = apply(crm, crmEvent("stage.move", "ana", { leadId: lead.id, to: "qualified", note: "Busca casa en Escazú" }, 1));
      crm = apply(crm, crmEvent("analysis.refresh", "worker:w1", { leadId: lead.id }, 2));
      crm = apply(crm, crmEvent("task.generate", "worker:w1", { leadId: lead.id }, 3));
      expect(crm.leads[0]!.stage).toBe("qualified");
      expect(crm.analyses.at(-1)).toMatchObject({ leadId: lead.id, trigger: "refresh" });
      expect(crm.tasks.length).toBeGreaterThan(0);
      const mailTask = crm.tasks.find((row) => row.kind === "email") ?? crm.tasks[0]!;
      crm = apply(crm, crmEvent("task.propose", "worker:w1", { leadId: lead.id, kind: "meeting", title: "Visita a la propiedad", draft: "Coordinar la visita", dueInDays: 4 }, 4));
      const visitTask = crm.tasks.find((row) => row.kind === "meeting")!;
      const taskIds = [mailTask.id, visitTask.id];
      for (const taskId of taskIds) crm = apply(crm, crmEvent("task.accept", "ana", { taskId }, 5));

      // 2. the approved plan comes from the adapter (CRM tasks → the Execution engine's own plan: send the email, then the property visit) and enters the Runtime Orchestrator, which assigns the workers
      const parts = layers();
      equip(parts);
      const { plan: approved, mail, meet: visitStep } = crmPlan(parts, crm, lead.id, mailTask.id, visitTask.id);
      const planId = approved.id;
      const orch = new OrchestratorEngine({
        env: { isWorkerActive: () => true }, now: () => parts.clock.t, roleOf: (_tenantId, personId) => ROLES[personId],
        workers: () => [
          { id: "w1", tenantId: T1, name: "Ventas", specialty: "sales", status: "active", capacity: 2, permissions: ["*"] },
          { id: "w2", tenantId: T1, name: "Operaciones", specialty: "operations", status: "active", capacity: 2, permissions: ["*"] },
        ],
      });
      expect(orch.enqueue(osys, T1, approved).ok).toBe(true);
      expect(orch.tick(osys, T1).ok).toBe(true);
      expect(orch.queueFor(osys).map((row) => `${approved.steps.find((entry) => entry.id === row.id)!.action}:${row.state}:${row.workerId ?? "-"}`).sort()).toEqual(["calendar.write:WaitingDependencies:-", "followup.send:Assigned:w1"]);

      // 3. the Gateway reads the plan with the Orchestrator's own step states: the email is Ready, the visit waits for it
      const gw = new ExecutionGateway({ now: () => parts.clock.t, sources: () => gatewaySources({ plans: [withQueueStates(approved, orch.queueFor(osys))], runtimeWorkers: parts.runtime.workersFor(adela), osWorkers: parts.os.workersFor(adela), roleOf: (id) => ROLES[id] }) });
      for (const [entry, workerId] of [[mail, "w1"], [visitStep, "w2"]] as const) expect(gw.submit(system, T1, { planId, stepId: entry.id, workerId }).ok).toBe(true);
      const mailReady = gw.validate(system, T1, requestIdFor(planId, mail.id)).record!;
      expect(mailReady.state).toBe("Ready");
      expect(gw.validate(system, T1, requestIdFor(planId, visitStep.id)).record).toMatchObject({ state: "Blocked", reasons: ["dependency.pending"] });

      // 4. the bridge and the Approval Center: the email waits for an administrator; nobody else can release it
      const w = google();
      let state = await authorized(w);
      const held = await holdForApproval(w.ws, state, w.env, mailReady, mailParams(lead, mailTask), w.at());
      expect("status" in held && held.status).toBe("awaitingApproval");
      state = (held as { state: ConnectorsState }).state;
      const mailAction = (held as { action: { id: string } }).action.id;
      expect(w.fake.sent).toHaveLength(0);
      expect((await approveAction(w.ws, state, w.env, { tenantId: T1, actor: "marta", actionId: mailAction, at: w.at() })).ok).toBe(false);
      expect((await approveAction(w.ws, state, w.env, { tenantId: T1, actor: "worker:w1", actionId: mailAction, at: w.at() })).ok).toBe(false);
      expect(w.fake.sent).toHaveLength(0);

      // 5. the administrator approves: Gmail sends (simulated); the Orchestrator is told the step ran
      const mailSync = syncTo(orch, planId, mail.id);
      const sent = await approveAction(w.ws, state, w.env, { tenantId: T1, actor: "ana", actionId: mailAction, at: w.at(), after: mailSync.after });
      expect(sent.ok, sent.code).toBe(true);
      state = sent.state;
      expect(w.fake.sent).toHaveLength(1);
      expect(w.fake.sent[0]!.raw).toContain(`To: ${lead.email!}`);
      expect(mailSync.seen).toEqual([{ outcome: "completed", item: "Completed" }]); // the Orchestrator was told by the adapter, not by hand

      // 6. the visit is Ready now; it waits for the administrator too, and Calendar creates it on approval
      const visitReady = gw.validate(system, T1, requestIdFor(planId, visitStep.id)).record!;
      expect(visitReady.state).toBe("Ready");
      const visit = { title: "Visita a la propiedad de Escazú", start: "2026-11-17T16:00:00Z", end: "2026-11-17T17:00:00Z", location: "Escazú, San José" };
      const heldVisit = await holdForApproval(w.ws, state, w.env, visitReady, visitParams(lead, visit), w.at());
      expect("status" in heldVisit && heldVisit.status).toBe("awaitingApproval");
      expect(Object.keys(w.fake.events)).toHaveLength(0);
      const visitSync = syncTo(orch, planId, visitStep.id);
      const booked = await approveAction(w.ws, (heldVisit as { state: ConnectorsState }).state, w.env, { tenantId: T1, actor: "ana", actionId: (heldVisit as { action: { id: string } }).action.id, at: w.at(), after: visitSync.after });
      expect(booked.ok, booked.code).toBe(true);
      state = booked.state;
      expect(Object.values(w.fake.events)).toHaveLength(1);
      expect(JSON.stringify(Object.values(w.fake.events)[0])).toContain("Escazú, San José");
      expect(visitSync.seen).toEqual([{ outcome: "completed", item: "Completed" }]);

      // 7. the CRM records it automatically: email sent, visit scheduled, timeline, tasks done
      for (const event of crmRecordsAfterApproval({ tenantId: T1, leadId: lead.id, taskIds, approver: "ana", at: iso(30), mailRequestId: requestIdFor(planId, mail.id), visit: { title: visit.title, scheduledFor: visit.start } })) crm = apply(crm, event);
      expect(crm.meetings).toEqual([expect.objectContaining({ leadId: lead.id, title: visit.title, scheduledBy: "ana" })]);
      expect(crm.timeline.filter((row) => row.subject.id === lead.id).map((row) => row.kind)).toEqual(expect.arrayContaining(["worker", "meeting"]));
      expect(crm.tasks.filter((row) => taskIds.includes(row.id)).every((row) => row.status === "done")).toBe(true);

      // 8. audit and dashboards: each layer's own trail, and nothing sensitive outside the CRM (which is the record of the lead itself)
      expect(state.audit.map((row) => `${row.actor}:${row.action}`).filter((row) => /action\./.test(row))).toEqual(["worker:w1:action.request", "ana:action.approve", "worker:w2:action.request", "ana:action.approve"]);
      expect(w.ws.executions.map((row) => `${row.operation}:${row.outcome}`)).toEqual(["gmail.send:ok", "calendar.create:ok"]);
      expect(gw.audit(T1).filter((row) => row.action === "request.created")).toHaveLength(2);
      expect(orch.runsFor(osys)[0]).toMatchObject({ planId, status: "Completed" });
      expect(orch.dashboard(osys).plans.completed).toEqual([planId]);
      expect(gw.dashboard(system).requests.byState).toMatchObject({ Ready: 2, Blocked: 0 });
      expect(approvalInbox(state, T1, w.at())).toEqual([]);
      expect(crm.audit.map((row) => row.action)).toEqual(expect.arrayContaining(["lead.create", "stage.move", "task.generate", "task.accept", "meeting.schedule", "task.complete"]));
      expect(JSON.stringify([state.audit, w.ws.executions, gw.exportState().audit, gw.log.all(), orch.audit(T1), orch.log.all()])).not.toMatch(/mariana@solis|Mariana|Solís|Escazú|Busca casa/);
      expect(JSON.stringify([state.audit, w.ws.executions])).not.toContain(mailTask.draft.slice(0, 24));
    });
  });

  describe("YouTube Faceless, end to end: video idea → CRM tasks → Orchestrator → Worker Runtime/OS → Gateway → Approval Center → sponsor email + recording date → CRM", () => {
    const crmEvent = (type: string, actor: string, extra: Record<string, unknown> = {}, minute = 0, tenantId = T1) => ({ type, tenantId, actor, at: iso(minute), ...extra }) as CrmEvent;
    const apply = (state: CrmState, event: CrmEvent): CrmState => { const result = reduceCrm(state, event); expect(result.error, `${event.type}: ${result.error}`).toBeUndefined(); return result.state; };
    const osys = { kind: "system" as const, tenantId: T1 };
    const T2 = "tenant-vida";

    /** The whole flow, once. It returns a summary made only of ids, states and counts, so two runs can be compared. */
    async function flow() {
      // 1–3. CRM: the sponsor lead with the video idea, KOE's tasks, a person accepts them
      let crm = apply(newCrmState(), crmEvent("lead.create", "worker:w1", { input: { name: "Equipo de Patrocinios", company: "Marca Verde", email: "patrocinios@marcaverde.test", source: "youtube-faceless", estimatedValueMicros: 12_000_000_000, fit: 70 } }));
      const lead = crm.leads[0]!;
      crm = apply(crm, crmEvent("interaction.record", "ana", { subject: { kind: "lead", id: lead.id }, kind: "note", summary: "Idea de video: los cinco errores al invertir en bienes raíces" }, 1));
      crm = apply(crm, crmEvent("analysis.refresh", "worker:w1", { leadId: lead.id }, 2));
      crm = apply(crm, crmEvent("task.generate", "worker:w1", { leadId: lead.id }, 3));
      const mailTask = crm.tasks.find((row) => row.kind === "email") ?? crm.tasks[0]!;
      crm = apply(crm, crmEvent("task.propose", "worker:w1", { leadId: lead.id, kind: "meeting", title: "Fecha de grabación y publicación", draft: "Fijar la fecha", dueInDays: 5 }, 4));
      const dateTask = crm.tasks.find((row) => row.kind === "meeting")!;
      const taskIds = [mailTask.id, dateTask.id];
      for (const taskId of taskIds) crm = apply(crm, crmEvent("task.accept", "ana", { taskId }, 5));
      expect(reduceCrm(crm, crmEvent("task.complete", "ana", { taskId: mailTask.id }, 6, T2)).error).toBeDefined(); // another company's person cannot touch this company's task

      // 4–5. the plan comes from the adapter (sponsor email, then the recording date), enters the Orchestrator, and the Worker Runtime/OS provide the workers
      const parts = layers();
      equip(parts);
      const { plan: approved, mail: sponsor, meet: recording } = crmPlan(parts, crm, lead.id, mailTask.id, dateTask.id);
      const planId = approved.id;
      const orch = new OrchestratorEngine({
        env: { isWorkerActive: () => true }, now: () => parts.clock.t, roleOf: (_tenantId, personId) => ROLES[personId],
        workers: () => [
          { id: "w1", tenantId: T1, name: "Ventas", specialty: "sales", status: "active", capacity: 2, permissions: ["*"] },
          { id: "w2", tenantId: T1, name: "Operaciones", specialty: "operations", status: "active", capacity: 2, permissions: ["*"] },
        ],
      });
      expect(orch.enqueue(osys, T1, approved).ok).toBe(true);
      expect(orch.tick(osys, T1).ok).toBe(true);
      expect(orch.queueFor(osys).map((row) => `${approved.steps.find((entry) => entry.id === row.id)!.action}:${row.state}:${row.workerId ?? "-"}`).sort()).toEqual(["calendar.write:WaitingDependencies:-", "followup.send:Assigned:w1"]);

      // 6. the Gateway: the sponsor email is Ready, the recording date waits for it
      const gw = new ExecutionGateway({ now: () => parts.clock.t, sources: () => gatewaySources({ plans: [withQueueStates(approved, orch.queueFor(osys))], runtimeWorkers: parts.runtime.workersFor(adela), osWorkers: parts.os.workersFor(adela), roleOf: (id) => ROLES[id] }) });
      for (const [entry, workerId] of [[sponsor, "w1"], [recording, "w2"]] as const) expect(gw.submit(system, T1, { planId, stepId: entry.id, workerId }).ok).toBe(true);
      const mailReady = gw.validate(system, T1, requestIdFor(planId, sponsor.id)).record!;
      expect(mailReady.state).toBe("Ready");
      expect(gw.validate(system, T1, requestIdFor(planId, recording.id)).record).toMatchObject({ state: "Blocked", reasons: ["dependency.pending"] });

      // 7–9. Gmail prepares the sponsor email; the Approval Center holds it; no Worker, agent, system, NEX or non-administrator can approve
      const w = google();
      let state = await authorized(w);
      const held = await holdForApproval(w.ws, state, w.env, mailReady, mailParams(lead, mailTask), w.at());
      expect("status" in held && held.status).toBe("awaitingApproval");
      state = (held as { state: ConnectorsState }).state;
      const mailAction = (held as { action: { id: string } }).action.id;
      for (const actor of ["worker:w1", "agent:comercial", "system", "nex", "marta"]) {
        expect((await approveAction(w.ws, state, w.env, { tenantId: T1, actor, actionId: mailAction, at: w.at() })).ok, actor).toBe(false);
        expect((await rejectAction(w.ws, state, w.env, { tenantId: T1, actor, actionId: mailAction, reason: "x", at: w.at() })).ok, actor).toBe(false);
      }
      expect(w.fake.sent).toHaveLength(0);
      // another company sees nothing and decides nothing
      expect(approvalInbox(state, T2, w.at())).toEqual([]);
      expect((await approveAction(w.ws, state, w.env, { tenantId: T2, actor: "luis", actionId: mailAction, at: w.at() })).ok).toBe(false);
      expect(gw.dashboard({ kind: "system", tenantId: T2 }).requests.total).toBe(0);
      expect(orch.queueFor({ kind: "system", tenantId: T2 })).toEqual([]);

      // 10. an administrator approves: the (fake) Gmail sends; the Orchestrator is told the step ran
      const mailSync = syncTo(orch, planId, sponsor.id);
      const sent = await approveAction(w.ws, state, w.env, { tenantId: T1, actor: "ana", actionId: mailAction, at: w.at(), after: mailSync.after });
      expect(sent.ok, sent.code).toBe(true);
      state = sent.state;
      expect(w.fake.sent[0]!.raw).toContain(`To: ${lead.email!}`);
      expect(mailSync.seen).toEqual([{ outcome: "completed", item: "Completed" }]); // the Orchestrator was told by the adapter, not by hand

      // 11. the recording and publication date: Ready now, held, and created by Calendar on approval
      const recordingReady = gw.validate(system, T1, requestIdFor(planId, recording.id)).record!;
      expect(recordingReady.state).toBe("Ready");
      const date = { title: "Grabación y publicación del video", start: "2026-11-20T15:00:00Z", end: "2026-11-20T16:00:00Z", location: "Estudio remoto" };
      const heldDate = await holdForApproval(w.ws, state, w.env, recordingReady, visitParams(lead, date), w.at());
      expect("status" in heldDate && heldDate.status).toBe("awaitingApproval");
      expect(Object.keys(w.fake.events)).toHaveLength(0);
      const dateSync = syncTo(orch, planId, recording.id);
      const booked = await approveAction(w.ws, (heldDate as { state: ConnectorsState }).state, w.env, { tenantId: T1, actor: "ana", actionId: (heldDate as { action: { id: string } }).action.id, at: w.at(), after: dateSync.after });
      expect(booked.ok, booked.code).toBe(true);
      state = booked.state;
      expect(dateSync.seen).toEqual([{ outcome: "completed", item: "Completed" }]);

      // 12. the CRM records: email sent, sponsor contacted, calendar created, tasks completed
      for (const event of crmRecordsAfterApproval({ tenantId: T1, leadId: lead.id, taskIds, approver: "ana", at: iso(30), mailRequestId: requestIdFor(planId, sponsor.id), visit: { title: date.title, scheduledFor: date.start } })) crm = apply(crm, event);
      crm = apply(crm, crmEvent("interaction.record", "ana", { subject: { kind: "lead", id: lead.id }, kind: "email", direction: "out", summary: "Patrocinador contactado" }, 31));
      expect(crm.meetings).toEqual([expect.objectContaining({ leadId: lead.id, title: date.title })]);
      expect(crm.tasks.filter((row) => taskIds.includes(row.id)).every((row) => row.status === "done")).toBe(true);

      // nothing sensitive outside the CRM (the record of the lead itself)
      expect(JSON.stringify([state.audit, w.ws.executions, gw.exportState().audit, gw.log.all(), orch.audit(T1), orch.log.all()])).not.toMatch(/patrocinios@marcaverde|Marca Verde|Equipo de Patrocinios|bienes ra|Estudio remoto/);
      return {
        connectors: state.audit.map((row) => `${row.actor}:${row.action}`).filter((row) => /action\./.test(row)), gateway: gw.audit(T1).map((row) => row.action), orchestrator: orch.audit(T1).map((row) => row.action),
        executions: w.ws.executions.map((row) => `${row.operation}:${row.outcome}`), crm: crm.timeline.filter((row) => row.subject.id === lead.id).map((row) => `${row.kind}:${row.summary}`), tasks: crm.tasks.map((row) => `${row.id}:${row.status}`),
        gatewayStates: gw.dashboard(system).requests.byState, run: orch.runsFor(osys)[0]!.status, sent: w.fake.sent.length, events: Object.keys(w.fake.events).length, inbox: approvalInbox(state, T1, w.at()).length,
      };
    }

    it("a sponsor email and a recording date, held for an administrator, sent and booked with Google simulated, recorded by the CRM; the whole run is deterministic", async () => {
      const first = await flow();
      expect(first).toMatchObject({ connectors: ["worker:w1:action.request", "ana:action.approve", "worker:w2:action.request", "ana:action.approve"], executions: ["gmail.send:ok", "calendar.create:ok"], run: "Completed", sent: 1, events: 1, inbox: 0 });
      expect(first.gatewayStates).toMatchObject({ Ready: 2, Blocked: 0 });
      expect(first.crm.some((row) => row.startsWith("worker:Correo enviado por Gmail"))).toBe(true);
      expect(first.crm.some((row) => row.includes("Patrocinador contactado"))).toBe(true);
      expect(first.tasks.every((row) => row.endsWith(":done") || row.endsWith(":proposed"))).toBe(true);
      expect(await flow()).toEqual(first);
    });
  });
});

/** The adapter wired to one step: the Approval Center hands every decision's result to it, so nobody tells the Orchestrator by hand. */
function syncTo(orch: OrchestratorEngine, planId: string, stepId: string) {
  const seen: SyncOutcome[] = [];
  return { seen, after: (result: WorkspaceResult) => { seen.push(syncOrchestrator(orch, { tenantId: T1, planId, stepId }, result)); } };
}
/** The Runtime Orchestrator with the two workers (Sales and Operations) the planner's steps need. */
function newOrchestrator(parts: ReturnType<typeof layers>) {
  return new OrchestratorEngine({
    env: { isWorkerActive: () => true }, now: () => parts.clock.t, roleOf: (_tenantId, personId) => ROLES[personId],
    workers: () => [
      { id: "w1", tenantId: T1, name: "Ventas", specialty: "sales", status: "active", capacity: 2, permissions: ["*"] },
      { id: "w2", tenantId: T1, name: "Operaciones", specialty: "operations", status: "active", capacity: 2, permissions: ["*"] },
    ],
  });
}

describe("CRM task → Execution plan adapter, and execution result → Runtime Orchestrator adapter", () => {
  const task = (id: string, kind: "email" | "meeting" | "call" | "whatsapp" | "followup" | "proposal", over: Record<string, unknown> = {}) =>
    ({ id, tenantId: T1, leadId: "ld_00001", kind, title: "SECRETO-TITULO", reason: "SECRETO-MOTIVO", draft: "SECRETO-BORRADOR", dueAt: iso(60), status: "accepted", proposedBy: "worker:w1", proposedAt: iso(0), ...over }) as never;
  const exec = (clock: { t: number }) => new ExecutionEngine({
    env: { isWorkerActive: () => true }, now: () => clock.t, connected: () => ["gmail", "googleCalendar"],
    roster: () => ({ workers: [{ id: "w1", name: "Ventas", specialty: "sales", status: "active" }, { id: "w2", name: "Operaciones", specialty: "operations", status: "active" }] }),
  });
  const people = { preparer: { kind: "person" as const, tenantId: T1, id: "ana", role: "owner" as const }, approver: { kind: "person" as const, tenantId: T1, id: "adela", role: "admin" as const } };
  const base = { tenantId: T1, leadId: "ld_00001", at: iso(0) };

  it("translates only the accepted tasks of that lead and company, by the catalog, and carries ids only", () => {
    const output = crmCopilotOutput({ ...base, tasks: [task("tk_1", "email"), task("tk_2", "meeting"), task("tk_3", "call"), task("tk_4", "email", { status: "proposed" }), task("tk_5", "email", { leadId: "ld_9" }), task("tk_6", "email", { tenantId: "tenant-vida" })] });
    expect(output.actions.map((row) => `${row.id}:${row.actionId}:${row.level}`)).toEqual(["act:tk_1:followup.send:3", "act:tk_2:calendar.write:3", "act:tk_3:crm.task:1"]);
    expect(output.recommendations).toHaveLength(1);
    expect(JSON.stringify(output)).not.toMatch(/SECRETO/);
    expect(ACTION_OF_TASK_KIND).toEqual({ email: "followup.send", followup: "followup.send", meeting: "calendar.write", call: "crm.task", whatsapp: "crm.task", proposal: "crm.task" });
    expect(crmCopilotOutput({ ...base, tasks: [task("tk_1", "email")], priority: "critical" }).recommendations[0]!.severity).toBe("critical");
  });
  it("the Execution engine's own planner decides the plan: levels, approvers, connectors, specialties and priority", () => {
    const clock = { t: START };
    const result = planFromCrmTasks(exec(clock), people, { ...base, tasks: [task("tk_1", "email"), task("tk_2", "meeting"), task("tk_3", "call")], priority: "high" });
    expect(result.ok).toBe(true);
    const approved = (result as { plan: ExecutionPlan }).plan;
    expect(approved).toMatchObject({ status: "Approved", decidedBy: "adela", priority: "high", findingId: "crm.lead.ld_00001" });
    expect(approved.steps.map((row) => `${row.action}:${row.authorizationLevel}:${row.approverRole}:${row.worker.specialty}:${row.connector ?? "-"}`)).toEqual(["crm.task:1:member:sales:-", "calendar.write:3:admin:operations:googleCalendar", "followup.send:3:admin:sales:gmail"]);
    expect(approved.steps.every((row) => row.sourceActionId.startsWith("act:tk_"))).toBe(true);
  });
  it("applies the stated order with the planner's own cycle check, and is the same plan every time", () => {
    const run = (after: Record<string, readonly string[]>) => planFromCrmTasks(exec({ t: START }), people, { ...base, tasks: [task("tk_1", "email"), task("tk_2", "meeting")], after });
    const ordered = run({ tk_2: ["tk_1"] });
    expect(ordered.ok).toBe(true);
    const plan = (ordered as { plan: ExecutionPlan }).plan;
    const meet = plan.steps.find((row) => row.action === "calendar.write")!;
    expect(meet.dependsOn).toEqual([plan.steps.find((row) => row.action === "followup.send")!.id]);
    expect(run({ tk_2: ["tk_1"] })).toEqual(ordered);
    expect(run({ tk_2: ["tk_1"], tk_1: ["tk_2"] })).toMatchObject({ ok: false, step: "dependency", reasons: ["cycle"] });
    expect(run({ tk_2: ["tk_99"] })).toMatchObject({ ok: false, step: "dependency" });
  });
  it("refuses with nothing to translate, and does not let a non-administrator approve", () => {
    expect(planFromCrmTasks(exec({ t: START }), people, { ...base, tasks: [task("tk_1", "email", { status: "proposed" })] })).toEqual({ ok: false, step: "empty" });
    const weak = { ...people, approver: { kind: "person" as const, tenantId: T1, id: "marta", role: "manager" as const } };
    expect(planFromCrmTasks(exec({ t: START }), weak, { ...base, tasks: [task("tk_1", "email")] })).toMatchObject({ ok: false, step: "approve", refusal: "level" });
    const other = { ...people, preparer: { ...people.preparer, tenantId: "tenant-vida" }, approver: { ...people.approver, tenantId: "tenant-vida" } };
    expect(planFromCrmTasks(exec({ t: START }), other, { ...base, tasks: [task("tk_1", "email")] }).ok).toBe(false); // another company's people cannot prepare this company's tasks
  });

  const osys = { kind: "system" as const, tenantId: T1 };
  /** An approved plan from CRM tasks, already in the Orchestrator and assigned. */
  function orchestrated(kinds: ("call" | "email" | "meeting")[], after: Record<string, readonly string[]> = {}) {
    const parts = layers();
    const planned = planFromCrmTasks(exec(parts.clock), people, { ...base, tasks: kinds.map((kind, index) => task(`tk_${index + 1}`, kind)), after });
    expect(planned.ok, JSON.stringify(planned)).toBe(true);
    const approved = (planned as { plan: ExecutionPlan }).plan;
    const orch = newOrchestrator(parts);
    expect(orch.enqueue(osys, T1, approved).ok).toBe(true);
    expect(orch.tick(osys, T1).ok).toBe(true);
    const target = (action: string) => ({ tenantId: T1, planId: approved.id, stepId: approved.steps.find((row) => row.action === action)!.id });
    return { parts, orch, approved, target, state: (stepId: string) => orch.queueFor(osys).find((row) => row.id === stepId)!.state };
  }

  it("a result that ran completes the step; the run completes with it", () => {
    const { orch, target, state } = orchestrated(["call"]);
    expect(syncOrchestrator(orch, target("crm.task"), { status: "done" })).toEqual({ outcome: "completed", item: "Completed" });
    expect(state(target("crm.task").stepId)).toBe("Completed");
    expect(orch.runsFor(osys)[0]!.status).toBe("Completed");
  });
  it("a failed result is the Orchestrator's to retry (its own backoff and attempts), then to fail", () => {
    const { parts, orch, target, state } = orchestrated(["call"]); // an internal task: Level 1, three attempts
    const t = target("crm.task");
    expect(syncOrchestrator(orch, t, { status: "failed" })).toEqual({ outcome: "retry", item: "Pending" });
    expect(orch.tick(osys, T1).ok).toBe(true);
    expect(state(t.stepId)).toBe("Pending"); // still backing off
    parts.clock.advance(1_000);
    expect(orch.tick(osys, T1).ok).toBe(true);
    expect(state(t.stepId)).toBe("Assigned");
    expect(syncOrchestrator(orch, t, { status: "failed" }).outcome).toBe("retry");
    parts.clock.advance(2_000); // the backoff doubles
    expect(orch.tick(osys, T1).ok).toBe(true);
    expect(syncOrchestrator(orch, t, { status: "failed" })).toEqual({ outcome: "failed", item: "Failed" });
    expect(orch.runsFor(osys)[0]!.status).toBe("Failed");
    expect(orch.log.ofType("execution.retry")).toHaveLength(2);
  });
  it("a Level 3 action is never retried: its failure fails the step, the run and what waited for it", () => {
    const { orch, target, state } = orchestrated(["email", "meeting"], { tk_2: ["tk_1"] });
    expect(syncOrchestrator(orch, target("followup.send"), { status: "failed" })).toEqual({ outcome: "failed", item: "Failed" });
    expect(state(target("calendar.write").stepId)).toBe("Cancelled");
    expect(orch.runsFor(osys)[0]!.status).toBe("Failed");
  });
  it("an action a person rejected cancels the plan's run (the Orchestrator cancels by run)", () => {
    const { orch, target, state } = orchestrated(["email", "meeting"], { tk_2: ["tk_1"] });
    expect(syncOrchestrator(orch, target("followup.send"), { status: "rejected" })).toEqual({ outcome: "cancelled" });
    expect(orch.queueFor(osys).every((row) => row.state === "Cancelled")).toBe(true);
    expect(orch.runsFor(osys)[0]!.status).toBe("Cancelled");
    expect(state(target("calendar.write").stepId)).toBe("Cancelled");
  });
  it("reports nothing while a person still has to decide, or when the connector refused", () => {
    const { orch, target } = orchestrated(["email"]);
    const before = JSON.stringify(orch.exportState());
    for (const status of ["awaitingApproval", "refused", undefined] as const) expect(syncOrchestrator(orch, target("followup.send"), { status })).toEqual({ outcome: "none" });
    expect(JSON.stringify(orch.exportState())).toBe(before);
  });
  it("is idempotent, and never reaches another company's plan", () => {
    const { orch, target, state } = orchestrated(["call"]);
    const t = target("crm.task");
    expect(syncOrchestrator(orch, t, { status: "done" }).outcome).toBe("completed");
    expect(syncOrchestrator(orch, t, { status: "done" })).toEqual({ outcome: "none", refusal: "state" }); // the same result twice changes nothing
    const other = orchestrated(["call"]);
    const snapshot = () => JSON.stringify([other.orch.exportState().queue, other.orch.exportState().runs]); // the refusals are audited (in the asker's company), but nothing moves
    const before = snapshot();
    expect(syncOrchestrator(other.orch, { ...other.target("crm.task"), tenantId: "tenant-vida" }, { status: "done" })).toEqual({ outcome: "none", refusal: "notFound" });
    expect(syncOrchestrator(other.orch, { ...other.target("crm.task"), tenantId: "tenant-vida" }, { status: "rejected" })).toEqual({ outcome: "none", refusal: "notFound" });
    expect(snapshot()).toBe(before);
    expect(other.orch.exportState().audit.filter((row) => row.tenantId === T1 && row.action.endsWith(".refused"))).toEqual([]);
    expect(state(t.stepId)).toBe("Completed");
  });
  it("is deterministic: the same results give the same queue and log", () => {
    const run = () => {
      const { orch, target } = orchestrated(["email", "meeting"], { tk_2: ["tk_1"] });
      syncOrchestrator(orch, target("followup.send"), { status: "done" });
      syncOrchestrator(orch, target("calendar.write"), { status: "done" });
      return [orch.exportState(), orch.log.all()];
    };
    expect(run()).toEqual(run());
  });

});

describe("the bridge is glue only", () => {
  it("reads no clock, calls no provider, no adapter and no network, and approves nothing", () => {
    const source = readFileSync(join(process.cwd(), "lib", "nex", "execution-bridge", "execution-bridge.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
    expect(source).not.toMatch(/Date\.now|new Date\(\)|Math\.random|\bfetch\(|process\.env|ADAPTERS|\.perform\(|\.sync\(|\.exchangeCode\(|action\.approve|reduceConnectors|reduceGateway/);
    expect(source).toMatch(/import type/);
    // the only runtime imports are the catalog's level lookup, the planner's own dependency helpers and the Gateway's role table: nothing of the other layers runs through here
    expect(source.match(/^import {[^}]*} from "[^"]+"/gm)?.map((line) => line.match(/from "([^"]+)"/)?.[1]).sort()).toEqual(["@/lib/contracts/platform/workers", "@/lib/nex/execution", "@/lib/nex/execution-gateway"]);
  });
  it("the Approval Center reads no clock, creates no event, decides nobody's approval and reaches no provider directly", () => {
    const source = readFileSync(join(process.cwd(), "lib", "nex", "execution-bridge", "approval-center.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
    expect(source).not.toMatch(/Date\.now|new Date\(\)|Math\.random|\bfetch\(|process\.env|ADAPTERS|\.perform\(|reduceConnectors|reduceGateway|type: "action\./);
    expect(source.match(/^import (?!type)/gm)).toEqual(["import "]); // the one runtime import is the bridge's own `googleRequest`
  });
});
