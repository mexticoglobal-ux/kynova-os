// Worker OS Reducer: the pure function `reduceWorkerOs(state, event, config)` that decides what each Worker of a company IS. The same state and event always give the same result; there is no clock (every
// event carries `at`), no network, no database and no AI, and NOTHING is run or installed: this only moves records.
//   · Level 3: only a person (administrator or owner) may create, update, change capabilities, permissions or tools, request, approve or install an upgrade, or roll back. Workers, the system and NEX never.
//     (Workers and the system may only report health.)
//   · Nothing outside the schema is accepted; capabilities, tools and permissions are validated apart and never mixed.
//   · An incompatibility among the worker, runtime, platform and capability versions BLOCKS the worker; an upgrade is never installed automatically (request → approve → install, three separate people-moves).
//   · Rollback goes back EXACTLY to the previous release (version, build, runtime and platform versions). Everything is isolated by company, and every change is written to the audit trail.

import { diffCapabilities } from "./worker-os-capabilities";
import { checkChanges, checkLimits, checkPermissions, checkSpecialty, checkTarget, compatibility, statusFor, validateDefinition } from "./worker-os-policy";
import { checkSkills } from "./worker-os-skills";
import { checkTools, diffIds } from "./worker-os-tools";
import { checkCapabilities } from "./worker-os-capabilities";
import {
  DEFAULT_CONFIG, compareVersions, isLevel3,
  type AuditEntry, type OsEventInput, type OsEventType, type Principal, type Refusal, type WorkerConfigLike, type WorkerOsConfig, type WorkerOsEvent, type WorkerOsOutcome, type WorkerOsState, type WorkerRecord,
} from "./worker-os-types";

export const newWorkerOsState = (): WorkerOsState => ({ workers: [], audit: [] });
const MAX_AUDIT = 5_000;
const name = (principal: Principal): string => (principal.kind === "system" || principal.kind === "nex" ? principal.kind : principal.id);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function refuse(state: WorkerOsState, event: WorkerOsEvent, refusal: Refusal, reasons: readonly string[] = []): WorkerOsOutcome {
  const who = name(event.actor);
  const input: OsEventInput = { at: event.at, tenantId: event.actor.tenantId, actorKind: event.actor.kind, actorId: who, type: "os.refused", detail: { reason: refusal, action: event.type } };
  const entry: AuditEntry = { at: event.at, actor: who, tenantId: event.actor.tenantId, action: `${event.type}.refused`, detail: { ok: false, reason: refusal, ...(reasons[0] ? { why: reasons[0] } : {}) } };
  return { state: { ...state, audit: [...state.audit, entry].slice(-MAX_AUDIT) }, result: { ok: false, refusal, ...(reasons.length > 0 ? { reasons } : {}), events: [input] } };
}

export function reduceWorkerOs(start: WorkerOsState, event: WorkerOsEvent, config: WorkerOsConfig = DEFAULT_CONFIG): WorkerOsOutcome {
  const { actor, tenantId, at } = event;
  if (actor.tenantId !== tenantId) return refuse(start, event, "tenant");
  if (Number.isNaN(Date.parse(at))) return refuse(start, event, "invalid", ["at"]);
  // Level 3: workers, the system and NEX never change what a Worker is; they may only report its health
  if (event.type === "health") { if (!(actor.kind === "system" || (actor.kind === "worker" && actor.id === event.workerId))) return refuse(start, event, "forbidden"); }
  else if (!isLevel3(actor)) return refuse(start, event, "forbidden");

  let workers: WorkerRecord[] = [...start.workers];
  const events: OsEventInput[] = [];
  const who = name(actor);
  const note = (type: OsEventType, workerId?: string, detail?: Readonly<Record<string, unknown>>) =>
    events.push({ at, tenantId, actorKind: actor.kind, actorId: who, type, ...(workerId ? { workerId } : {}), ...(detail ? { detail } : {}) });
  const find = (id: string): WorkerRecord | undefined => workers.find((row) => row.workerId === id && row.companyId === tenantId);
  const put = (next: WorkerRecord): WorkerRecord => { workers = workers.map((row) => (row.workerId === next.workerId && row.companyId === next.companyId ? next : row)); return next; };
  const bump = (row: WorkerRecord): WorkerRecord => ({ ...row, revision: row.revision + 1, updatedAt: at });
  /** The status always follows the compatibility: an incompatibility blocks the worker, and fixing it unblocks it. */
  const withStatus = (row: WorkerRecord, scoped: WorkerConfigLike = config): WorkerRecord => {
    const status = statusFor(compatibility(row, row.capabilities, scoped));
    if (status !== row.status) note(status === "Blocked" ? "worker.blocked" : "worker.unblocked", row.workerId, { issues: compatibility(row, row.capabilities, scoped).length });
    return { ...row, status };
  };
  const done = (worker: WorkerRecord | undefined, action: string, detail: Record<string, string | number | boolean> = {}, unchanged = false): WorkerOsOutcome => {
    const entry: AuditEntry = { at, actor: who, tenantId, action, detail: { ok: true, ...(worker ? { workerId: worker.workerId } : {}), ...detail } };
    return { state: { workers, audit: [...start.audit, entry].slice(-MAX_AUDIT) }, result: { ok: true, ...(unchanged ? { unchanged: true } : {}), ...(worker ? { worker } : {}), events } };
  };
  const unknown = (id: string) => refuse(start, event, "notFound", [`worker:${id}`]);

  switch (event.type) {
    case "create": {
      const checked = validateDefinition(event.worker, config);
      if (!checked.ok) return refuse(start, event, "invalid", checked.errors);
      if (checked.definition.companyId !== tenantId) return refuse(start, event, "tenant", ["companyId"]);
      if (find(checked.definition.workerId)) return refuse(start, event, "exists");
      if (workers.filter((row) => row.companyId === tenantId).length >= config.maxWorkers) return refuse(start, event, "limit", ["maxWorkers"]);
      const created: WorkerRecord = { ...checked.definition, status: statusFor(checked.issues), revision: 1, createdAt: at, updatedAt: at, releases: [] };
      workers.push(created);
      note("worker.created", created.workerId, { specialty: created.specialty, version: created.version, status: created.status, capabilities: created.capabilities.length, tools: created.tools.length });
      if (created.status === "Blocked") note("worker.blocked", created.workerId, { issues: checked.issues.length });
      return done(created, "worker.created", { version: created.version, status: created.status });
    }

    case "update": {
      const row = find(event.workerId);
      if (!row) return unknown(event.workerId);
      if (!checkChanges(event.changes)) return refuse(start, event, "invalid", ["changes"]);
      const changes = event.changes as Record<string, unknown>;
      let next = row;
      let fields = 0;
      if ("specialty" in changes) {
        if (!checkSpecialty(changes["specialty"])) return refuse(start, event, "invalid", ["specialty"]);
        if (changes["specialty"] !== row.specialty) { next = { ...next, specialty: changes["specialty"] as string }; fields += 1; }
      }
      if ("skills" in changes) {
        const skills = checkSkills(changes["skills"]);
        if (!skills.ok) return refuse(start, event, "invalid", [skills.error]);
        if (!same(skills.value, row.skills)) { next = { ...next, skills: skills.value }; fields += 1; }
      }
      if ("limits" in changes) {
        const limits = checkLimits(changes["limits"]);
        if (!limits.ok) return refuse(start, event, "invalid", [limits.error]);
        if (!same(limits.value, row.limits)) { next = { ...next, limits: limits.value }; fields += 1; }
      }
      if (fields === 0) return done(row, "worker.updated", { fields: 0 }, true);
      const saved = put(bump(next));
      note("worker.updated", row.workerId, { fields });
      return done(saved, "worker.updated", { fields });
    }

    case "setCapabilities": {
      const row = find(event.workerId);
      if (!row) return unknown(event.workerId);
      const checked = checkCapabilities(event.capabilities);
      if (!checked.ok) return refuse(start, event, "invalid", [checked.error]);
      if (same(checked.value, row.capabilities)) return done(row, "worker.capabilities.changed", { added: 0, removed: 0 }, true);
      const diff = diffCapabilities(row.capabilities, checked.value);
      const saved = put(withStatus(bump({ ...row, capabilities: checked.value })));
      note("worker.capabilities", row.workerId, diff);
      return done(saved, "worker.capabilities.changed", { ...diff, status: saved.status });
    }

    case "setPermissions": {
      const row = find(event.workerId);
      if (!row) return unknown(event.workerId);
      const checked = checkPermissions(event.permissions);
      if (!checked.ok) return refuse(start, event, "invalid", [checked.error]);
      if (same(checked.value, row.permissions)) return done(row, "worker.permissions.changed", { added: 0, removed: 0 }, true);
      const diff = diffIds(row.permissions, checked.value);
      const saved = put(bump({ ...row, permissions: checked.value }));
      note("worker.permissions", row.workerId, diff);
      return done(saved, "worker.permissions.changed", diff);
    }

    case "setTools": {
      const row = find(event.workerId);
      if (!row) return unknown(event.workerId);
      const checked = checkTools(event.tools);
      if (!checked.ok) return refuse(start, event, "invalid", [checked.error]);
      if (same(checked.value, row.tools)) return done(row, "worker.tools.changed", { added: 0, removed: 0 }, true);
      const diff = diffIds(row.tools, checked.value);
      const saved = put(bump({ ...row, tools: checked.value }));
      note("worker.tools", row.workerId, diff);
      return done(saved, "worker.tools.changed", diff);
    }

    case "upgradeRequested": {
      const row = find(event.workerId);
      if (!row) return unknown(event.workerId);
      if (!checkTarget(event.to)) return refuse(start, event, "invalid", ["to"]);
      const to = { version: event.to.version, build: event.to.build, runtimeVersion: event.to.runtimeVersion, platformVersion: event.to.platformVersion };
      if (row.upgrade) return refuse(start, event, "state", ["upgradePending"]);
      if (compareVersions(to.version, row.version) <= 0) return refuse(start, event, "invalid", ["notNewer"]);
      const issues = compatibility(to, row.capabilities, config);
      if (issues.length > 0) return refuse(start, event, "incompatible", issues);
      const saved = put(bump({ ...row, upgrade: { state: "requested", to, requestedBy: who, requestedAt: at } }));
      note("upgrade.requested", row.workerId, { from: row.version, to: to.version });
      return done(saved, "upgrade.requested", { from: row.version, to: to.version });
    }

    case "upgradeApproved": {
      const row = find(event.workerId);
      if (!row) return unknown(event.workerId);
      if (row.upgrade?.state !== "requested") return refuse(start, event, "state", [row.upgrade ? row.upgrade.state : "noUpgrade"]);
      const issues = compatibility(row.upgrade.to, row.capabilities, config);
      if (issues.length > 0) return refuse(start, event, "incompatible", issues);
      const saved = put(bump({ ...row, upgrade: { ...row.upgrade, state: "approved", approvedBy: who, approvedAt: at } }));
      note("upgrade.approved", row.workerId, { to: row.upgrade.to.version });
      return done(saved, "upgrade.approved", { to: row.upgrade.to.version });
    }

    case "upgradeInstalled": {
      const row = find(event.workerId);
      if (!row) return unknown(event.workerId);
      // installing is a person's decision, recorded: nothing installs by itself
      if (row.upgrade?.state !== "approved") return refuse(start, event, "state", [row.upgrade ? row.upgrade.state : "noUpgrade"]);
      const target = row.upgrade.to;
      const issues = compatibility(target, row.capabilities, config);
      if (issues.length > 0) return refuse(start, event, "incompatible", issues);
      const { upgrade: _upgrade, ...rest } = row;
      const previous = { version: row.version, build: row.build, runtimeVersion: row.runtimeVersion, platformVersion: row.platformVersion, replacedAt: at };
      const saved = put(withStatus(bump({ ...rest, ...target, releases: [...row.releases, previous].slice(-config.maxReleases) })));
      note("upgrade.installed", row.workerId, { from: row.version, to: target.version });
      return done(saved, "upgrade.installed", { from: row.version, to: target.version, status: saved.status });
    }

    case "rollback": {
      const row = find(event.workerId);
      if (!row) return unknown(event.workerId);
      if (row.upgrade) return refuse(start, event, "state", ["upgradePending"]);
      const previous = row.releases.at(-1);
      if (!previous) return refuse(start, event, "state", ["noPreviousRelease"]);
      // back to EXACTLY the previous release
      const saved = put(withStatus(bump({ ...row, version: previous.version, build: previous.build, runtimeVersion: previous.runtimeVersion, platformVersion: previous.platformVersion, releases: row.releases.slice(0, -1) })));
      note("worker.rolledback", row.workerId, { from: row.version, to: previous.version });
      return done(saved, "worker.rolledback", { from: row.version, to: previous.version, status: saved.status });
    }

    case "health": {
      const row = find(event.workerId);
      if (!row) return unknown(event.workerId);
      if (typeof event.score !== "number" || !Number.isInteger(event.score) || event.score < 0 || event.score > 100) return refuse(start, event, "invalid", ["score"]);
      const saved = put({ ...row, health: { score: event.score, reportedAt: at } });
      note("health.reported", row.workerId, { score: event.score });
      return done(saved, "health.reported", { score: event.score });
    }
  }
}
