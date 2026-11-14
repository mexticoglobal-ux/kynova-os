/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_IDS, CATALOG, DEFAULT_CONFIG, FUTURE_TABLES, SPECIALTIES, TOOL_IDS, WorkerOsEngine, WorkerOsObservability, OsEventLog, buildWorkerOsDashboard, checkCapabilities, checkLimits, checkPermissions, checkSkills,
  checkTools, compareVersions, compatibility, evaluateRequest, meetsSkill, newWorkerOsState, permits, provides, reduceWorkerOs, sanitizeDetail, toBusMessage, validateDefinition,
  type Capability, type Principal, type WorkerInput, type WorkerOsEvent,
} from "./index";

const T1 = "tenant-nova";
const T2 = "tenant-vida";
const START = Date.parse("2026-11-13T10:00:00.000Z");
const MIN = 60_000;
const person = (tenantId: string, id: string, role: "viewer" | "member" | "manager" | "admin" | "owner"): Principal => ({ kind: "person", tenantId, id, role });
const ana = person(T1, "ana", "owner");
const adela = person(T1, "adela", "admin");
const marta = person(T1, "marta", "manager");
const mario = person(T1, "mario", "member");
const vera = person(T1, "vera", "viewer");
const luis = person(T2, "luis", "owner");
const system = (tenantId = T1): Principal => ({ kind: "system", tenantId });
const nex = (tenantId = T1): Principal => ({ kind: "nex", tenantId });
const wk = (id: string, tenantId = T1): Principal => ({ kind: "worker", tenantId, id });

const cap = (id: string, version = "1.0.0"): Capability => ({ id, version });
const input = (workerId: string, over: Partial<WorkerInput> = {}, companyId = T1): WorkerInput => ({
  workerId, companyId, version: "1.2.0", build: "b100", runtimeVersion: "1.0.0", platformVersion: "1.0.0", specialty: "Sales", capabilities: [cap("read"), cap("communicate")],
  skills: [{ id: "Sales", level: 85 }, { id: "CRM", level: 60 }], tools: ["CRM", "Email"], permissions: ["crm.read", "task.create"], limits: { maxConcurrent: 2, queueLimit: 1, timeoutMs: 60_000, maxActionsPerDay: 100 }, ...over,
});
function world(config: Partial<typeof DEFAULT_CONFIG> = {}) {
  const clock = { t: START, advance(ms: number) { this.t += ms; } };
  const engine = new WorkerOsEngine({ now: () => clock.t, config });
  return { clock, engine };
}
type World = ReturnType<typeof world>;
const ok = (result: { ok: boolean; refusal?: string; reasons?: readonly string[] }, label = "") => expect(result.ok, `${label} ${result.refusal} ${result.reasons}`).toBe(true);
const row = (w: World, id: string, tenantId = T1) => w.engine.workersFor(person(tenantId, "x", "owner")).find((entry) => entry.workerId === id)!;
const make = (w: World, id = "w1", over: Partial<WorkerInput> = {}) => { w.clock.advance(MIN); const result = w.engine.create(ana, T1, input(id, over)); ok(result, `create ${id}`); return result.worker!; };
const target = (version: string, over: Partial<{ build: string; runtimeVersion: string; platformVersion: string }> = {}) => ({ version, build: `b-${version}`, runtimeVersion: "1.0.0", platformVersion: "1.0.0", ...over });
const upgrade = (w: World, id: string, version: string) => {
  w.clock.advance(MIN);
  ok(w.engine.requestUpgrade(ana, T1, id, target(version)), "request");
  ok(w.engine.approveUpgrade(adela, T1, id), "approve");
  ok(w.engine.installUpgrade(ana, T1, id), "install");
};

describe("Catalog", () => {
  it("has exactly the fifteen specialties, once", () => {
    expect([...SPECIALTIES]).toEqual(["General", "Sales", "Marketing", "Support", "Finance", "CRM", "SEO", "Content", "Video", "Automation", "Developer", "Operations", "Analytics", "Research", "Administration"]);
    expect(CATALOG.specialties).toBe(SPECIALTIES);
    expect(CATALOG.skills).toBe(SPECIALTIES); // skills are named after the specialties: not repeated
  });
  it("has the capabilities, each with its version, and the tools", () => {
    expect(CAPABILITY_IDS).toEqual(["read", "write", "search", "analyze", "execute", "schedule", "communicate", "calculate", "monitor", "report", "organize", "generate", "validate", "approve"]);
    expect(Object.values(CATALOG.capabilities).every((version) => version === "1.0.0")).toBe(true);
    expect([...TOOL_IDS]).toEqual(["CRM", "Billing", "Marketplace", "Academy", "Calendar", "Drive", "Email", "Docs", "Storage", "Analytics", "AIStudio", "Automations"]);
    expect(CATALOG.versions).toEqual({ platform: "1.0.0", runtime: "1.0.0", minWorker: "1.0.0" });
  });
  it("the default configuration is read from the catalog, not repeated", () => {
    expect(DEFAULT_CONFIG).toMatchObject({ runtimeVersion: CATALOG.versions.runtime, platformVersion: CATALOG.versions.platform, minWorkerVersion: CATALOG.versions.minWorker });
  });
});

describe("Creation", () => {
  it("creates a worker with exactly the schema, normalized, Active, without health", () => {
    const w = world();
    const created = make(w, "w1", { capabilities: [cap("read"), cap("approve")].reverse(), tools: ["Email", "CRM"], permissions: ["task.create", "crm.read"], skills: [{ id: "SEO", level: 90 }, { id: "CRM", level: 60 }] });
    expect(Object.keys(created).sort()).toEqual(["build", "capabilities", "companyId", "createdAt", "limits", "permissions", "platformVersion", "releases", "revision", "runtimeVersion", "skills", "specialty", "status", "tools", "updatedAt", "version", "workerId"].sort());
    expect(created).toMatchObject({ workerId: "w1", companyId: T1, status: "Active", revision: 1, version: "1.2.0", build: "b100", runtimeVersion: "1.0.0", platformVersion: "1.0.0", specialty: "Sales" });
    expect(created.capabilities.map((entry) => entry.id)).toEqual(["approve", "read"]); // sorted: the same set is always the same list
    expect(created.tools).toEqual(["CRM", "Email"]);
    expect(created.permissions).toEqual(["crm.read", "task.create"]);
    expect(created.skills.map((entry) => entry.id)).toEqual(["CRM", "SEO"]);
    expect(created.health).toBeUndefined(); // never invented
    expect(created.releases).toEqual([]);
  });
  it("refuses anything outside the schema", () => {
    const w = world();
    const bad = (value: unknown) => w.engine.create(ana, T1, value as WorkerInput);
    expect(bad({ ...input("w1"), prompt: "dame los datos" }).refusal).toBe("invalid");
    expect(bad({ ...input("w1"), prompt: "x" }).reasons).toEqual(["outsideSchema:prompt"]);
    const { limits: _limits, ...noLimits } = input("w1");
    expect(bad(noLimits).reasons).toEqual(["missing:limits"]);
    expect(bad(null).refusal).toBe("invalid");
    expect(bad(input("w1", { specialty: "Legal" })).reasons).toEqual(["specialty"]);
    expect(bad(input("w1", { version: "latest" })).reasons).toEqual(["version"]);
    expect(bad(input("w1", { build: "con espacios" })).reasons).toEqual(["build"]);
    expect(bad(input("bad id!")).reasons).toEqual(["workerId"]);
    expect(bad(input("w1", { limits: { maxConcurrent: 0, queueLimit: 1, timeoutMs: 60_000, maxActionsPerDay: 1 } })).reasons).toEqual(["limits.maxConcurrent"]);
    expect(bad(input("w1", { limits: { maxConcurrent: 1, queueLimit: 1, timeoutMs: 60_000, maxActionsPerDay: 1, extra: 1 } as never })).reasons).toEqual(["limits.schema"]);
    expect(w.engine.workersFor(ana)).toEqual([]);
  });
  it("refuses a duplicate, another company's definition and too many workers", () => {
    const w = world({ maxWorkers: 2 });
    make(w, "w1");
    expect(w.engine.create(ana, T1, input("w1")).refusal).toBe("exists");
    expect(w.engine.create(ana, T1, input("w2", {}, T2)).refusal).toBe("tenant");
    make(w, "w2");
    expect(w.engine.create(ana, T1, input("w3")).refusal).toBe("limit");
  });
  it("validateDefinition returns the issues of an incompatible one without refusing it", () => {
    const checked = validateDefinition(input("w1", { runtimeVersion: "2.0.0" }), DEFAULT_CONFIG);
    expect(checked.ok && checked.issues).toEqual(["runtimeVersion"]);
  });
});

describe("Level 3: only people who administer", () => {
  it("workers, the system, NEX and people below administrator can never create, update, change or upgrade", () => {
    const w = world();
    make(w, "w1");
    const calls: ((actor: Principal) => { refusal?: string })[] = [
      (actor) => w.engine.create(actor, T1, input("zz")),
      (actor) => w.engine.update(actor, T1, "w1", { specialty: "SEO" }),
      (actor) => w.engine.setCapabilities(actor, T1, "w1", [cap("read")]),
      (actor) => w.engine.setPermissions(actor, T1, "w1", ["crm.read"]),
      (actor) => w.engine.setTools(actor, T1, "w1", ["CRM"]),
      (actor) => w.engine.requestUpgrade(actor, T1, "w1", target("1.3.0")),
      (actor) => w.engine.approveUpgrade(actor, T1, "w1"),
      (actor) => w.engine.installUpgrade(actor, T1, "w1"),
      (actor) => w.engine.rollback(actor, T1, "w1"),
    ];
    for (const actor of [wk("w1"), system(), nex(), vera, mario, marta]) for (const call of calls) expect(call(actor).refusal, JSON.stringify(actor)).toBe("forbidden");
    expect(row(w, "w1")).toMatchObject({ revision: 1, specialty: "Sales" });
    ok(w.engine.update(adela, T1, "w1", { specialty: "SEO" }));
    ok(w.engine.update(ana, T1, "w1", { specialty: "Sales" }));
  });
  it("only the worker itself or the system reports health", () => {
    const w = world();
    make(w, "w1");
    make(w, "w2");
    for (const actor of [wk("w2"), nex(), ana, adela, marta, vera]) expect(w.engine.reportHealth(actor, T1, "w1", 90).refusal, JSON.stringify(actor)).toBe("forbidden");
    ok(w.engine.reportHealth(wk("w1"), T1, "w1", 90));
    ok(w.engine.reportHealth(system(), T1, "w1", 80));
    expect(row(w, "w1").health).toEqual({ score: 80, reportedAt: iso(w.clock.t) });
    expect(w.engine.reportHealth(system(), T1, "w1", 101).refusal).toBe("invalid");
    expect(w.engine.reportHealth(system(), T1, "w1", 50.5).refusal).toBe("invalid");
    expect(w.engine.reportHealth(system(), T1, "ghost", 50).refusal).toBe("notFound");
  });
});
const iso = (ms: number) => new Date(ms).toISOString();

describe("Update", () => {
  it("updates specialty, skills and limits, bumping the revision", () => {
    const w = world();
    make(w, "w1");
    w.clock.advance(MIN);
    const result = w.engine.update(ana, T1, "w1", { specialty: "Marketing", skills: [{ id: "Marketing", level: 90 }], limits: { maxConcurrent: 4, queueLimit: 2, timeoutMs: 30_000, maxActionsPerDay: 10 } });
    ok(result);
    expect(result.worker).toMatchObject({ specialty: "Marketing", revision: 2, updatedAt: iso(w.clock.t), skills: [{ id: "Marketing", level: 90 }], limits: { maxConcurrent: 4 } });
  });
  it("is idempotent: the same change twice leaves nothing new", () => {
    const w = world();
    make(w, "w1");
    ok(w.engine.update(ana, T1, "w1", { specialty: "SEO" }));
    const again = w.engine.update(ana, T1, "w1", { specialty: "SEO" });
    expect(again.unchanged).toBe(true);
    expect(row(w, "w1").revision).toBe(2);
    expect(w.engine.log.ofType("worker.updated")).toHaveLength(1);
  });
  it("refuses changes outside the schema, empty changes and unknown values", () => {
    const w = world();
    make(w, "w1");
    expect(w.engine.update(ana, T1, "w1", { version: "9.9.9" } as never).refusal).toBe("invalid"); // a version only changes by upgrade
    expect(w.engine.update(ana, T1, "w1", { permissions: ["*"] } as never).refusal).toBe("invalid");
    expect(w.engine.update(ana, T1, "w1", {}).refusal).toBe("invalid");
    expect(w.engine.update(ana, T1, "w1", { specialty: "Legal" }).refusal).toBe("invalid");
    expect(w.engine.update(ana, T1, "ghost", { specialty: "SEO" }).refusal).toBe("notFound");
  });
});

describe("Capabilities", () => {
  it("are declared, never assumed", () => {
    const w = world();
    make(w, "w1", { capabilities: [cap("read")] });
    const request = (capability: string) => w.engine.check(ana, T1, "w1", { capability });
    expect(request("read").allowed).toBe(true);
    expect(request("write").allowed).toBe(false);
    expect(request("write").violations).toEqual(["capability"]);
    make(w, "w2", { capabilities: [] });
    expect(w.engine.check(ana, T1, "w2", { capability: "read" }).allowed).toBe(false);
  });
  it("change by declaration, with the difference counted", () => {
    const w = world();
    make(w, "w1");
    const result = w.engine.setCapabilities(ana, T1, "w1", [cap("read"), cap("write"), cap("approve")]);
    ok(result);
    expect(result.worker!.capabilities.map((entry) => entry.id)).toEqual(["approve", "read", "write"]);
    expect(w.engine.log.ofType("worker.capabilities")[0]!.detail).toEqual({ added: 2, removed: 1 });
    expect(w.engine.setCapabilities(ana, T1, "w1", [cap("write"), cap("read"), cap("approve")]).unchanged).toBe(true);
  });
  it("only known ids, with valid versions, no duplicates and no extra fields", () => {
    expect(checkCapabilities([cap("teleport")])).toEqual({ ok: false, error: "capabilities.unknown" });
    expect(checkCapabilities([cap("read"), cap("read")])).toEqual({ ok: false, error: "capabilities.duplicate" });
    expect(checkCapabilities([cap("read", "uno")])).toEqual({ ok: false, error: "capabilities.version" });
    expect(checkCapabilities([{ id: "read", version: "1.0.0", extra: 1 }])).toEqual({ ok: false, error: "capabilities.schema" });
    expect(checkCapabilities("read")).toEqual({ ok: false, error: "capabilities.shape" });
    expect(checkCapabilities([])).toEqual({ ok: true, value: [] });
  });
});

describe("Skills", () => {
  it("are 0–100 whole numbers named after the catalog, with no duplicates", () => {
    expect(checkSkills([{ id: "SEO", level: 85 }, { id: "Marketing", level: 90 }, { id: "CRM", level: 60 }])).toMatchObject({ ok: true });
    expect(checkSkills([{ id: "SEO", level: 0 }, { id: "CRM", level: 100 }])).toMatchObject({ ok: true });
    expect(checkSkills([{ id: "SEO", level: 101 }])).toEqual({ ok: false, error: "skills.level" });
    expect(checkSkills([{ id: "SEO", level: -1 }])).toEqual({ ok: false, error: "skills.level" });
    expect(checkSkills([{ id: "SEO", level: 50.5 }])).toEqual({ ok: false, error: "skills.level" });
    expect(checkSkills([{ id: "SEO", level: 10 }, { id: "SEO", level: 20 }])).toEqual({ ok: false, error: "skills.duplicate" });
    expect(checkSkills([{ id: "Cooking", level: 10 }])).toEqual({ ok: false, error: "skills.unknown" });
    expect(checkSkills([{ id: "SEO", level: 10, note: "x" }])).toEqual({ ok: false, error: "skills.schema" });
  });
  it("a skill that is not declared is absent, not zero", () => {
    expect(meetsSkill([{ id: "SEO", level: 85 }], "SEO", 80)).toBe(true);
    expect(meetsSkill([{ id: "SEO", level: 85 }], "SEO", 90)).toBe(false);
    expect(meetsSkill([{ id: "SEO", level: 0 }], "SEO", 0)).toBe(true);
    expect(meetsSkill([], "SEO", 0)).toBe(false);
  });
  it("a skill grants nothing by itself", () => {
    const w = world();
    make(w, "w1", { skills: [{ id: "Finance", level: 100 }], tools: [], permissions: [], capabilities: [] });
    expect(w.engine.check(ana, T1, "w1", { skill: { id: "Finance", min: 90 }, permission: "finance.read" }).violations).toEqual(["permission"]);
  });
});

describe("Tools", () => {
  it("are registered from the catalog, only registered, with no duplicates", () => {
    const w = world();
    make(w, "w1");
    const result = w.engine.setTools(ana, T1, "w1", ["Storage", "AIStudio", "Calendar"]);
    ok(result);
    expect(result.worker!.tools).toEqual(["AIStudio", "Calendar", "Storage"]);
    expect(checkTools(["Slack"])).toEqual({ ok: false, error: "tools.unknown" });
    expect(checkTools(["CRM", "CRM"])).toEqual({ ok: false, error: "tools.duplicate" });
    expect(checkTools("CRM")).toEqual({ ok: false, error: "tools.shape" });
    expect(w.engine.setTools(ana, T1, "w1", ["Slack"]).refusal).toBe("invalid");
    expect(w.engine.setTools(ana, T1, "w1", ["Calendar", "AIStudio", "Storage"]).unchanged).toBe(true);
    expect(w.engine.check(ana, T1, "w1", { tool: "Calendar" }).allowed).toBe(true);
    expect(w.engine.check(ana, T1, "w1", { tool: "Billing" }).violations).toEqual(["tool"]);
  });
});

describe("Permissions are not capabilities and not tools", () => {
  it("a permission is an action id, a family or a star: never a bare capability or tool name", () => {
    expect(checkPermissions(["crm.read", "crm.*", "*", "task.create"])).toMatchObject({ ok: true });
    for (const bad of ["read", "execute", "CRM", "Email", "crm", "CRM.read", "crm..read", ".read", "crm.*.x"]) expect(checkPermissions([bad]), bad).toEqual({ ok: false, error: "permissions.format" });
    expect(checkPermissions(["crm.read", "crm.read"])).toEqual({ ok: false, error: "permissions.duplicate" });
    expect(checkPermissions("crm.read")).toEqual({ ok: false, error: "permissions.shape" });
  });
  it("a capability list cannot hold a tool or a permission, and a tool list cannot hold a capability", () => {
    expect(checkCapabilities([cap("CRM")]).ok).toBe(false);
    expect(checkCapabilities([cap("crm.read")]).ok).toBe(false);
    expect(checkTools(["read"]).ok).toBe(false);
    const w = world();
    expect(w.engine.create(ana, T1, input("w1", { permissions: ["read"] })).refusal).toBe("invalid");
    expect(w.engine.create(ana, T1, input("w1", { permissions: ["Email"] })).refusal).toBe("invalid");
  });
  it("changing one list never touches the others", () => {
    const w = world();
    make(w, "w1");
    const before = row(w, "w1");
    ok(w.engine.setPermissions(ana, T1, "w1", ["*"]));
    expect(row(w, "w1")).toMatchObject({ capabilities: before.capabilities, tools: before.tools, permissions: ["*"] });
    ok(w.engine.setTools(ana, T1, "w1", ["Docs"]));
    expect(row(w, "w1")).toMatchObject({ capabilities: before.capabilities, permissions: ["*"], tools: ["Docs"] });
    expect(w.engine.log.ofType("worker.permissions")[0]!.detail).toEqual({ added: 1, removed: 2 });
    expect(w.engine.setPermissions(ana, T1, "w1", ["bad"]).refusal).toBe("invalid");
  });
  it("matches exact actions, families and the star", () => {
    expect(permits(["*"], "anything.at.all")).toBe(true);
    expect(permits(["crm.*"], "crm.update")).toBe(true);
    expect(permits(["crm.*"], "crmx.update")).toBe(false);
    expect(permits(["crm.read"], "crm.read")).toBe(true);
    expect(permits(["crm.read"], "crm.write")).toBe(false);
    expect(permits([], "crm.read")).toBe(false);
  });
});

describe("Compatibility blocks the worker", () => {
  it("an incompatible worker version, runtime, platform or capability version creates a Blocked worker", () => {
    const w = world();
    expect(make(w, "a", { runtimeVersion: "2.0.0" }).status).toBe("Blocked");
    expect(make(w, "b", { platformVersion: "1.1.0" }).status).toBe("Blocked"); // needs a newer platform than offered
    expect(make(w, "c", { capabilities: [cap("read", "2.0.0")] }).status).toBe("Blocked");
    expect(make(w, "d", { capabilities: [cap("read", "1.1.0")] }).status).toBe("Blocked");
    expect(make(w, "e", { version: "0.9.0" }).status).toBe("Blocked"); // older than the minimum worker version
    expect(make(w, "f").status).toBe("Active");
    expect(w.engine.log.ofType("worker.blocked")).toHaveLength(5);
  });
  it("compatibility reports each reason", () => {
    expect(compatibility({ version: "0.9.0", runtimeVersion: "2.0.0", platformVersion: "1.5.0" }, [cap("read", "3.0.0")], DEFAULT_CONFIG)).toEqual(["workerVersion", "runtimeVersion", "platformVersion", "capabilityVersion:read"]);
    expect(compatibility({ version: "1.0.0", runtimeVersion: "1.0.0", platformVersion: "1.0.0" }, [], DEFAULT_CONFIG)).toEqual([]);
    expect(provides("1.4.0", "1.2.0")).toBe(true);
    expect(provides("1.2.0", "1.4.0")).toBe(false);
    expect(provides("2.0.0", "1.0.0")).toBe(false);
    expect(compareVersions("1.10.0", "1.9.0")).toBeGreaterThan(0);
    expect(compareVersions("x", "1.0.0")).toBeLessThan(0);
  });
  it("the platform decides: a newer runtime accepts workers that need an older minor", () => {
    const w = world({ runtimeVersion: "1.4.0", platformVersion: "1.2.0" });
    expect(make(w, "w1", { runtimeVersion: "1.3.0", platformVersion: "1.2.0" }).status).toBe("Active");
    expect(make(w, "w2", { runtimeVersion: "1.5.0" }).status).toBe("Blocked");
  });
  it("a capability change can block and unblock", () => {
    const w = world();
    make(w, "w1");
    expect(w.engine.setCapabilities(ana, T1, "w1", [cap("read", "2.0.0")]).worker!.status).toBe("Blocked");
    expect(w.engine.setCapabilities(ana, T1, "w1", [cap("read")]).worker!.status).toBe("Active");
    expect(w.engine.log.ofType("worker.blocked")).toHaveLength(1);
    expect(w.engine.log.ofType("worker.unblocked")).toHaveLength(1);
  });
  it("a blocked worker is refused by the policy", () => {
    const w = world();
    make(w, "w1", { runtimeVersion: "2.0.0" });
    expect(w.engine.check(ana, T1, "w1", { capability: "read" }).violations).toEqual(["status", "version"]);
  });
});

describe("Upgrade: requested, approved, installed (never automatic)", () => {
  it("walks the three steps, each by a person, and installs only at the last", () => {
    const w = world();
    make(w, "w1");
    w.clock.advance(MIN);
    ok(w.engine.requestUpgrade(ana, T1, "w1", target("1.3.0")));
    expect(row(w, "w1")).toMatchObject({ version: "1.2.0", upgrade: { state: "requested", requestedBy: "ana" } });
    expect(w.engine.installUpgrade(ana, T1, "w1").refusal).toBe("state"); // not approved yet
    ok(w.engine.approveUpgrade(adela, T1, "w1"));
    expect(row(w, "w1")).toMatchObject({ version: "1.2.0", upgrade: { state: "approved", approvedBy: "adela" } }); // approving installs nothing
    w.clock.advance(MIN);
    const installed = w.engine.installUpgrade(ana, T1, "w1");
    ok(installed);
    expect(installed.worker).toMatchObject({ version: "1.3.0", build: "b-1.3.0", status: "Active" });
    expect(installed.worker!.upgrade).toBeUndefined();
    expect(installed.worker!.releases).toEqual([{ version: "1.2.0", build: "b100", runtimeVersion: "1.0.0", platformVersion: "1.0.0", replacedAt: iso(w.clock.t) }]);
    expect(w.engine.log.ofType("upgrade.requested")).toHaveLength(1);
    expect(w.engine.log.ofType("upgrade.approved")).toHaveLength(1);
    expect(w.engine.log.ofType("upgrade.installed")).toHaveLength(1);
  });
  it("nothing installs by waiting, ticking or reading", () => {
    const w = world();
    make(w, "w1");
    ok(w.engine.requestUpgrade(ana, T1, "w1", target("1.3.0")));
    ok(w.engine.approveUpgrade(ana, T1, "w1"));
    w.clock.advance(365 * 24 * 60 * MIN);
    w.engine.dashboard(ana);
    w.engine.check(ana, T1, "w1", { capability: "read" });
    expect(row(w, "w1").version).toBe("1.2.0");
  });
  it("refuses an approval without a request, a second request, an older target and an incompatible one", () => {
    const w = world();
    make(w, "w1");
    expect(w.engine.approveUpgrade(ana, T1, "w1").refusal).toBe("state");
    expect(w.engine.installUpgrade(ana, T1, "w1").refusal).toBe("state");
    expect(w.engine.requestUpgrade(ana, T1, "w1", target("1.2.0")).reasons).toEqual(["notNewer"]);
    expect(w.engine.requestUpgrade(ana, T1, "w1", target("1.1.0")).refusal).toBe("invalid");
    expect(w.engine.requestUpgrade(ana, T1, "w1", target("2.0.0", { runtimeVersion: "2.0.0" })).refusal).toBe("incompatible");
    expect(w.engine.requestUpgrade(ana, T1, "w1", target("2.0.0", { runtimeVersion: "2.0.0" })).reasons).toEqual(["runtimeVersion"]);
    expect(w.engine.requestUpgrade(ana, T1, "w1", { version: "1.3.0" } as never).refusal).toBe("invalid");
    expect(w.engine.requestUpgrade(ana, T1, "w1", { ...target("1.3.0"), extra: 1 } as never).refusal).toBe("invalid");
    ok(w.engine.requestUpgrade(ana, T1, "w1", target("1.3.0")));
    expect(w.engine.requestUpgrade(ana, T1, "w1", target("1.4.0")).reasons).toEqual(["upgradePending"]);
    ok(w.engine.approveUpgrade(ana, T1, "w1"));
    expect(w.engine.approveUpgrade(ana, T1, "w1").refusal).toBe("state"); // already approved
  });
  it("re-checks compatibility at approval and installation", () => {
    let state = newWorkerOsState();
    const at = (n: number) => iso(START + n * MIN);
    const step = (event: WorkerOsEvent, config = DEFAULT_CONFIG) => { const out = reduceWorkerOs(state, event, config); state = out.state; return out.result; };
    expect(step({ type: "create", actor: ana, tenantId: T1, at: at(0), worker: input("w1") }).ok).toBe(true);
    expect(step({ type: "upgradeRequested", actor: ana, tenantId: T1, at: at(1), workerId: "w1", to: target("1.3.0") }).ok).toBe(true);
    const stricter = { ...DEFAULT_CONFIG, minWorkerVersion: "1.5.0" };
    expect(step({ type: "upgradeApproved", actor: ana, tenantId: T1, at: at(2), workerId: "w1" }, stricter).refusal).toBe("incompatible");
    expect(step({ type: "upgradeApproved", actor: ana, tenantId: T1, at: at(3), workerId: "w1" }).ok).toBe(true);
    expect(step({ type: "upgradeInstalled", actor: ana, tenantId: T1, at: at(4), workerId: "w1" }, stricter).refusal).toBe("incompatible");
    expect(state.workers[0]!.version).toBe("1.2.0");
  });
  it("an upgrade of a blocked worker to a compatible release unblocks it", () => {
    const w = world();
    make(w, "w1", { version: "0.9.0" });
    expect(row(w, "w1").status).toBe("Blocked");
    upgrade(w, "w1", "1.0.0");
    expect(row(w, "w1")).toMatchObject({ version: "1.0.0", status: "Active" });
  });
});

describe("Rollback: exactly the previous release", () => {
  it("goes back, one release at a time, to exactly what was there", () => {
    const w = world();
    const original = make(w, "w1");
    upgrade(w, "w1", "1.3.0");
    upgrade(w, "w1", "1.4.0");
    expect(row(w, "w1").releases.map((release) => release.version)).toEqual(["1.2.0", "1.3.0"]);
    w.clock.advance(MIN);
    const first = w.engine.rollback(ana, T1, "w1");
    ok(first);
    expect(first.worker).toMatchObject({ version: "1.3.0", build: "b-1.3.0", runtimeVersion: "1.0.0", platformVersion: "1.0.0" });
    const second = w.engine.rollback(adela, T1, "w1");
    ok(second);
    expect(second.worker).toMatchObject({ version: original.version, build: original.build, runtimeVersion: original.runtimeVersion, platformVersion: original.platformVersion, releases: [] });
    expect(w.engine.rollback(ana, T1, "w1").reasons).toEqual(["noPreviousRelease"]);
    expect(w.engine.log.ofType("worker.rolledback")).toHaveLength(2);
  });
  it("restores the previous versions even when they differ in the runtime and platform", () => {
    const w = world({ runtimeVersion: "1.4.0", platformVersion: "1.4.0" });
    make(w, "w1", { runtimeVersion: "1.1.0", platformVersion: "1.2.0" });
    w.clock.advance(MIN);
    ok(w.engine.requestUpgrade(ana, T1, "w1", target("1.3.0", { runtimeVersion: "1.4.0", platformVersion: "1.3.0" })));
    ok(w.engine.approveUpgrade(ana, T1, "w1"));
    ok(w.engine.installUpgrade(ana, T1, "w1"));
    expect(row(w, "w1")).toMatchObject({ runtimeVersion: "1.4.0", platformVersion: "1.3.0" });
    ok(w.engine.rollback(ana, T1, "w1"));
    expect(row(w, "w1")).toMatchObject({ version: "1.2.0", build: "b100", runtimeVersion: "1.1.0", platformVersion: "1.2.0" });
  });
  it("is refused while an upgrade is pending, and a rolled-back worker that is no longer compatible is Blocked", () => {
    const w = world();
    make(w, "w1");
    upgrade(w, "w1", "1.3.0");
    ok(w.engine.requestUpgrade(ana, T1, "w1", target("1.4.0")));
    expect(w.engine.rollback(ana, T1, "w1").reasons).toEqual(["upgradePending"]);
    let state = w.engine.exportState();
    state = { ...state, workers: state.workers.map(({ upgrade: _upgrade, ...rest }) => rest) };
    const out = reduceWorkerOs(state, { type: "rollback", actor: ana, tenantId: T1, at: iso(START + 99 * MIN), workerId: "w1" }, { ...DEFAULT_CONFIG, minWorkerVersion: "1.3.0" });
    expect(out.result.worker).toMatchObject({ version: "1.2.0", status: "Blocked" });
  });
  it("keeps only as many releases as configured", () => {
    const w = world({ maxReleases: 2 });
    make(w, "w1");
    for (const version of ["1.3.0", "1.4.0", "1.5.0", "1.6.0"]) upgrade(w, "w1", version);
    expect(row(w, "w1").releases.map((release) => release.version)).toEqual(["1.4.0", "1.5.0"]);
  });
});

describe("Policy", () => {
  it("collects every violation: company, status, version, capability, skill, tool and permission", () => {
    const w = world();
    const worker = make(w, "w1", { runtimeVersion: "2.0.0" });
    const decision = evaluateRequest(worker, { tenantId: T2, capability: "write", skill: { id: "SEO", min: 50 }, tool: "Billing", permission: "payment.refund" }, DEFAULT_CONFIG);
    expect(decision).toEqual({ allowed: false, violations: ["tenant", "status", "version", "capability", "skill", "tool", "permission"] });
  });
  it("allows what is declared, in every dimension at once", () => {
    const w = world();
    make(w, "w1");
    const decision = w.engine.check(ana, T1, "w1", { capability: "read", skill: { id: "Sales", min: 80 }, tool: "CRM", permission: "crm.read" });
    expect(decision).toEqual({ ok: true, allowed: true, violations: [] });
    expect(w.engine.check(ana, T1, "w1", { skill: { id: "Sales", min: 90 } }).violations).toEqual(["skill"]);
    expect(w.engine.check(ana, T1, "w1", { permission: "payment.refund" }).violations).toEqual(["permission"]);
  });
  it("anyone of the company may ask, nobody of another company may, and asking runs nothing", () => {
    const w = world();
    make(w, "w1");
    for (const actor of [wk("w1"), system(), nex(), vera, mario]) expect(w.engine.check(actor, T1, "w1", { capability: "read" }).allowed, JSON.stringify(actor)).toBe(true);
    expect(w.engine.check(luis, T1, "w1", { capability: "read" })).toEqual({ ok: false, refusal: "tenant", allowed: false, violations: ["tenant"] });
    expect(w.engine.check(luis, T2, "w1", { capability: "read" }).refusal).toBe("notFound");
    expect(w.engine.check(ana, T1, "ghost", {}).refusal).toBe("notFound");
    expect(row(w, "w1").revision).toBe(1);
  });
  it("limits are whole numbers within their ranges", () => {
    expect(checkLimits({ maxConcurrent: 64, queueLimit: 0, timeoutMs: 1_000, maxActionsPerDay: 0 })).toMatchObject({ ok: true });
    expect(checkLimits({ maxConcurrent: 65, queueLimit: 0, timeoutMs: 1_000, maxActionsPerDay: 0 })).toEqual({ ok: false, error: "limits.maxConcurrent" });
    expect(checkLimits({ maxConcurrent: 1, queueLimit: -1, timeoutMs: 1_000, maxActionsPerDay: 0 })).toEqual({ ok: false, error: "limits.queueLimit" });
    expect(checkLimits({ maxConcurrent: 1, queueLimit: 0, timeoutMs: 999, maxActionsPerDay: 0 })).toEqual({ ok: false, error: "limits.timeoutMs" });
    expect(checkLimits([])).toEqual({ ok: false, error: "limits.shape" });
  });
});

describe("Dashboard", () => {
  function fleet() {
    const w = world();
    make(w, "w1", { specialty: "SEO", version: "1.2.0", skills: [{ id: "SEO", level: 85 }, { id: "Marketing", level: 90 }] });
    make(w, "w2", { specialty: "Sales", version: "1.1.0", skills: [{ id: "SEO", level: 55 }], tools: ["CRM"], capabilities: [cap("read")] });
    make(w, "w3", { specialty: "Sales", runtimeVersion: "2.0.0" });
    upgrade(w, "w2", "1.3.0");
    ok(w.engine.requestUpgrade(ana, T1, "w1", target("1.9.0")));
    ok(w.engine.reportHealth(system(), T1, "w1", 90));
    ok(w.engine.reportHealth(system(), T1, "w2", 70));
    return w;
  }
  it("counts workers, versions, specialties, capabilities, skills, tools, compatibility, upgrades, rollbacks and health", () => {
    const d = fleet().engine.dashboard(ana);
    expect(d.workers).toEqual({ total: 3, active: 2, blocked: 1 });
    expect(d.versions).toEqual({ "1.2.0": 2, "1.3.0": 1 });
    expect(Object.keys(d.specialties)).toEqual([...SPECIALTIES]);
    expect(d.specialties).toMatchObject({ SEO: 1, Sales: 2, Finance: 0 });
    expect(d.capabilities).toMatchObject({ read: 3, communicate: 2, write: 0 });
    expect(d.skills["SEO"]).toEqual({ workers: 2, average: 70 });
    expect(d.skills["Marketing"]).toEqual({ workers: 1, average: 90 });
    expect(d.skills["Video"]).toEqual({ workers: 0, average: 0 });
    expect(d.tools).toMatchObject({ CRM: 3, Email: 2, Billing: 0 });
    expect(d.compatibility).toEqual({ compatible: 2, incompatible: 1, issues: { runtimeVersion: 1 }, blocked: ["w3"] });
    expect(d.pendingUpgrades).toEqual({ total: 1, requested: 1, approved: 0, workers: [{ workerId: "w1", state: "requested", to: "1.9.0" }] });
    expect(d.rollbacksAvailable).toEqual({ total: 1, workers: [{ workerId: "w2", to: "1.1.0" }] });
    expect(d.health).toEqual({ average: 80, reported: 2, unreported: 1, lowest: [{ workerId: "w2", score: 70 }, { workerId: "w1", score: 90 }] });
  });
  it("is isolated by company and never shows another company's workers", () => {
    const w = fleet();
    ok(w.engine.create(luis, T2, input("v1", {}, T2)));
    const other = w.engine.dashboard(luis);
    expect(other.workers.total).toBe(1);
    expect(JSON.stringify(other)).not.toMatch(/w1|w2|w3/);
    expect(w.engine.dashboard(ana).workers.total).toBe(3);
    expect(w.engine.log.ofType("os.dashboard")).toHaveLength(2);
  });
  it("builds from plain data with no engine, ignoring other companies' rows", () => {
    const dashboard = buildWorkerOsDashboard({ tenantId: T1, at: iso(START), workers: [], config: DEFAULT_CONFIG });
    expect(dashboard.workers.total).toBe(0);
    expect(dashboard.health).toEqual({ average: 0, reported: 0, unreported: 0, lowest: [] });
  });
});

describe("Audit, observability and Event Bus", () => {
  it("records creation, update, capability, permission and tool changes, upgrade and rollback, with refusals", () => {
    const w = world();
    make(w, "w1");
    ok(w.engine.update(ana, T1, "w1", { specialty: "SEO" }));
    ok(w.engine.setCapabilities(ana, T1, "w1", [cap("read")]));
    ok(w.engine.setPermissions(ana, T1, "w1", ["crm.*"]));
    ok(w.engine.setTools(ana, T1, "w1", ["Docs"]));
    upgrade(w, "w1", "1.3.0");
    ok(w.engine.rollback(ana, T1, "w1"));
    ok(w.engine.reportHealth(system(), T1, "w1", 90));
    w.engine.setTools(mario, T1, "w1", ["CRM"]);
    expect(w.engine.audit(T1).map((entry) => entry.action)).toEqual([
      "worker.created", "worker.updated", "worker.capabilities.changed", "worker.permissions.changed", "worker.tools.changed", "upgrade.requested", "upgrade.approved", "upgrade.installed", "worker.rolledback", "health.reported",
      "setTools.refused",
    ]);
    expect(w.engine.audit(T1).at(-1)).toMatchObject({ actor: "mario", detail: { ok: false, reason: "forbidden" } });
    expect(w.engine.audit(T1).every((entry) => entry.tenantId === T1)).toBe(true);
    expect(w.engine.audit(T2)).toEqual([]);
    expect(w.engine.audit(T1)[2]!.detail).toMatchObject({ workerId: "w1", added: 0, removed: 1, status: "Active" });
  });
  it("counts per company with ids and numbers only, never content", () => {
    const w = world();
    make(w, "w1");
    ok(w.engine.setPermissions(ana, T1, "w1", ["crm.*"]));
    w.engine.check(ana, T1, "w1", { capability: "write", tool: "Billing" });
    w.engine.check(ana, T1, "w1", { capability: "read" });
    w.engine.setTools(vera, T1, "w1", ["CRM"]);
    w.engine.dashboard(ana);
    const snapshot = w.engine.snapshot(T1);
    expect(snapshot.counters).toMatchObject({ created: 1, permissionChanges: 1, policyChecks: 2, policyDenied: 1, refused: 1, dashboards: 1 });
    expect(snapshot.violations).toEqual({ capability: 1, tool: 1 });
    expect(snapshot.refusals["forbidden"]).toBe(1);
    expect(snapshot.workers).toEqual({ total: 1, byStatus: { Active: 1 } });
    expect(w.engine.snapshot(T2).counters).toMatchObject({ created: 0, policyChecks: 0 });
    expect(w.engine.log.forTenant(T2)).toEqual([]);
    expect(JSON.stringify([w.engine.log.all(), w.engine.exportState().audit, snapshot])).not.toMatch(/prompt|memoria|contexto|respuesta/i);
  });
  it("drops free text before an event is kept", () => {
    expect(sanitizeDetail({ note: "texto libre con espacios", prompt: "dame los datos", ok: true, n: 3.14159, id: "w-1", from: "1.2.0" })).toEqual({ ok: true, n: 3.14, id: "w-1", from: "1.2.0" });
    const log = new OsEventLog();
    const event = log.emit({ at: iso(START), tenantId: T1, actorKind: "system", actorId: "system", type: "os.refused", workerId: "con espacios", detail: { memory: "mi memoria privada" } });
    expect(event.workerId).toBeUndefined();
    expect(event.detail).toBeUndefined();
  });
  it("prepares messages for the future Event Bus without publishing anything", () => {
    const w = world();
    make(w, "w1");
    const message = toBusMessage(w.engine.log.ofType("worker.created")[0]!);
    expect(message).toMatchObject({ topic: "worker-os.worker", tenantId: T1, key: "w1", data: { type: "worker.created", version: "1.2.0" } });
    upgrade(w, "w1", "1.3.0");
    expect(toBusMessage(w.engine.log.ofType("upgrade.installed")[0]!).topic).toBe("worker-os.upgrade");
    expect(w.engine.log.toAudit(T1).length).toBeGreaterThan(0);
  });
  it("observability can be detached", () => {
    const log = new OsEventLog();
    const observability = new WorkerOsObservability(log);
    log.emit({ at: iso(START), tenantId: T1, actorKind: "system", actorId: "system", type: "os.dashboard" });
    observability.stop();
    log.emit({ at: iso(START), tenantId: T1, actorKind: "system", actorId: "system", type: "os.dashboard" });
    expect(observability.snapshot(T1).counters.dashboards).toBe(1);
  });
  it("declares the future tables with company scope and row level security, and creates no migration", () => {
    expect(FUTURE_TABLES.map((table) => table.name)).toEqual(["worker_os_workers", "worker_os_releases", "worker_os_upgrades", "worker_os_audit"]);
    expect(FUTURE_TABLES.every((table) => table.tenantScoped && table.policy.length > 0)).toBe(true);
    const dir = join(process.cwd(), "supabase", "migrations");
    if (existsSync(dir)) for (const name of readdirSync(dir)) expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/worker_os/);
  });
});

describe("Multitenancy: workers are never shared", () => {
  it("the same worker id lives in both companies without touching each other", () => {
    const w = world();
    make(w, "w1");
    ok(w.engine.create(luis, T2, input("w1", { specialty: "Finance" }, T2)));
    expect(row(w, "w1", T1).specialty).toBe("Sales");
    expect(row(w, "w1", T2).specialty).toBe("Finance");
    ok(w.engine.setTools(luis, T2, "w1", ["Billing"]));
    expect(row(w, "w1", T1).tools).toEqual(["CRM", "Email"]);
    expect(w.engine.workersFor(luis)).toHaveLength(1);
    expect(w.engine.workersFor(ana)).toHaveLength(1);
  });
  it("a company never reaches another's worker, and cannot claim a company that is not its own", () => {
    const w = world();
    make(w, "w1");
    make(w, "only-t1");
    expect(w.engine.update(luis, T2, "only-t1", { specialty: "SEO" }).refusal).toBe("notFound");
    expect(w.engine.rollback(luis, T2, "only-t1").refusal).toBe("notFound");
    expect(w.engine.setPermissions(luis, T1, "only-t1", ["*"]).refusal).toBe("tenant");
    expect(w.engine.reportHealth(wk("only-t1", T2), T2, "only-t1", 10).refusal).toBe("notFound");
    expect(row(w, "only-t1")).toMatchObject({ revision: 1, permissions: ["crm.read", "task.create"] });
  });
  it("an event of one company changes nothing of another's records", () => {
    const w = world();
    make(w, "w1");
    ok(w.engine.create(luis, T2, input("v1", {}, T2)));
    const before = JSON.stringify(w.engine.exportState().workers.filter((entry) => entry.companyId === T2));
    ok(w.engine.setCapabilities(ana, T1, "w1", [cap("write")]));
    upgrade(w, "w1", "1.3.0");
    expect(JSON.stringify(w.engine.exportState().workers.filter((entry) => entry.companyId === T2))).toBe(before);
  });
});

describe("Determinism and purity", () => {
  const script = (w: World) => {
    make(w, "w1");
    make(w, "w2", { specialty: "SEO", runtimeVersion: "2.0.0" });
    ok(w.engine.setCapabilities(ana, T1, "w1", [cap("write"), cap("read")]));
    ok(w.engine.setTools(ana, T1, "w1", ["Docs", "CRM"]));
    upgrade(w, "w1", "1.3.0");
    ok(w.engine.rollback(ana, T1, "w1"));
    ok(w.engine.reportHealth(system(), T1, "w1", 77));
    w.engine.check(ana, T1, "w1", { capability: "write" });
    w.engine.dashboard(ana);
  };
  it("the same script in two worlds gives the same state, log and numbers", () => {
    const a = world();
    const b = world();
    script(a);
    script(b);
    expect(a.engine.exportState()).toEqual(b.engine.exportState());
    expect(a.engine.log.all()).toEqual(b.engine.log.all());
    expect(a.engine.snapshot(T1)).toEqual(b.engine.snapshot(T1));
    expect(a.engine.dashboard(ana)).toEqual(b.engine.dashboard(ana));
  });
  it("the same set in a different order is the same worker", () => {
    const a = world();
    const b = world();
    make(a, "w1", { tools: ["CRM", "Email"], permissions: ["a.b", "c.d"], capabilities: [cap("read"), cap("write")] });
    make(b, "w1", { tools: ["Email", "CRM"], permissions: ["c.d", "a.b"], capabilities: [cap("write"), cap("read")] });
    expect(a.engine.exportState()).toEqual(b.engine.exportState());
  });
  it("the reducer does not mutate its inputs and gives the same answer twice", () => {
    const deepFreeze = <T,>(value: T): T => { if (value && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; };
    let state = newWorkerOsState();
    const at = (n: number) => iso(START + n * MIN);
    const events: WorkerOsEvent[] = [
      { type: "create", actor: ana, tenantId: T1, at: at(0), worker: input("w1") },
      { type: "setCapabilities", actor: ana, tenantId: T1, at: at(1), workerId: "w1", capabilities: [cap("write")] },
      { type: "upgradeRequested", actor: ana, tenantId: T1, at: at(2), workerId: "w1", to: target("1.3.0") },
      { type: "upgradeApproved", actor: ana, tenantId: T1, at: at(3), workerId: "w1" },
      { type: "upgradeInstalled", actor: ana, tenantId: T1, at: at(4), workerId: "w1" },
      { type: "rollback", actor: ana, tenantId: T1, at: at(5), workerId: "w1" },
      { type: "health", actor: system(), tenantId: T1, at: at(6), workerId: "w1", score: 50 },
    ];
    for (const event of events) {
      deepFreeze(state);
      deepFreeze(event);
      const one = reduceWorkerOs(state, event);
      const two = reduceWorkerOs(state, event);
      expect(one).toEqual(two);
      expect(one.result.ok, `${event.type} ${one.result.refusal}`).toBe(true);
      state = one.state;
    }
    expect(state.workers[0]).toMatchObject({ version: "1.2.0", health: { score: 50 } });
  });
  it("a bad instant is refused, never guessed", () => {
    const result = reduceWorkerOs(newWorkerOsState(), { type: "create", actor: ana, tenantId: T1, at: "mañana", worker: input("w1") });
    expect(result.result.refusal).toBe("invalid");
    expect(result.state.workers).toEqual([]);
  });
});

describe("Pure and isolated: nothing is executed", () => {
  const dir = join(process.cwd(), "lib", "nex", "worker-os");
  const FILES = [
    "index.ts", "worker-os-capabilities.ts", "worker-os-dashboard.ts", "worker-os-events.ts", "worker-os-observability.ts", "worker-os-policy.ts", "worker-os-reducer.ts", "worker-os-skills.ts", "worker-os-tools.ts",
    "worker-os-types.ts", "worker-os.ts",
  ];
  const code = (name: string) => readFileSync(join(dir, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
  it("has exactly the eleven files of the layer", () => {
    for (const name of FILES) expect(existsSync(join(dir, name)), name).toBe(true);
    expect(readdirSync(dir).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).sort()).toEqual([...FILES].sort());
  });
  it("reads no clock, no randomness, no network, no environment, no database and no AI", () => {
    for (const name of FILES) {
      const source = code(name);
      expect(source, name).not.toMatch(/Date\.now|new Date\(\)|Math\.random|performance\.now|setTimeout|setInterval|\bfetch\(|XMLHttpRequest|WebSocket|process\.env|randomUUID|supabase|createClient|openai|anthropic|workers-ai|AI_GATEWAY|docker|kubernetes/i);
      expect(source, name).not.toMatch(/from "@\/|from "node:|from "react|from "next/);
    }
  });
  it("imports only its own files", () => {
    for (const name of FILES) for (const match of code(name).matchAll(/from "([^"]+)"/g)) expect(match[1]!.startsWith("./"), `${name}: ${match[1]}`).toBe(true);
  });
  it("runs no tool, Connector, Runtime or provider and calls no other layer", () => {
    for (const name of FILES) expect(code(name), name).not.toMatch(/ADAPTERS|adapter\.|\.execute\(|executeAction|runAction|runStep|callWorker|callConnector|callTool|\.invoke\(|\.connect\(|reduceKoe|reduceConnectors|reduceMemory|reduceKnowledge|reduceCopilot|reduceRag|reduceExecution|reduceWorkerRuntime|reduceRuntime\b|\.ask\(|\.remember\(|\.subscribe\(|\.publish\(|lib\/nex|lib\/backend/);
  });
  it("is used by nothing else in the repository yet", () => {
    const importers: string[] = [];
    const walk = (folder: string) => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (["node_modules", ".next", ".git", ".open-next"].includes(entry.name)) continue;
        const path = join(folder, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(entry.name) && !path.includes(join("lib", "nex", "worker-os")) && !path.includes("execution-bridge") && /lib\/nex\/worker-os/.test(readFileSync(path, "utf8"))) importers.push(path);
      }
    };
    for (const folder of ["app", "lib", "components"]) walk(join(process.cwd(), folder));
    expect(importers).toEqual([]);
  });
});
