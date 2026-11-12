// Memory Engine: `reduceMemory(state, event, env)` is a pure reducer: the same state and event always give the same new state, with no clock, no database and no AI. NEX remembers useful
// knowledge, never a conversation: a text is screened (no secrets, prompts, credentials, restricted data or transcripts), summarized, and only the summary is kept. NEX learns preferences,
// decisions and ways of working as ADVISORY memories; learning can never change a rule of the system. Level 3 (ADR-0009): a worker prepares, only a person decides what to archive,
// delete, pin, confirm or open to others.

import { MemoryEventLog } from "./memory-events";
import { MemoryObservability } from "./memory-observability";
import { RETENTION, expiryFor, isImportant, summarize, sweepTenant } from "./memory-retention";
import { searchMemories, type SearchQuery, type SearchResult } from "./memory-search";
import { canAdminister, canConfirm, canCreate, canManage, canRead, canSweep, canVote, maskPersonal, screenText, slug } from "./memory-security";
import { MAX_MEMORIES_PER_TENANT, aliveCount, dedupKey, getIn, newMemoryState, nextId, removeMany, replaceOne, withAudit, withMemories } from "./memory-store";
import {
  LEARN_KINDS, MEMORY_TYPES, ROLES, principalId,
  type LearnInput, type Memory, type MemoryEnv, type MemoryEvent, type MemoryEventInput, type MemoryEventType, type MemoryOutcome, type MemoryPermissions, type MemoryResult, type MemoryState, type MemoryType, type Principal,
  type Refusal, type RememberInput, type Vote,
} from "./memory-types";

const ID = /^[\w.:-]{1,64}$/;
const REF = /^[\w.:/-]{1,64}$/;
const EMBEDDING = /^emb:[a-z0-9_-]{4,64}$/;
const RAW_MAX = 4_000;
const LEARNED_IMPORTANCE_CAP = 70;
const LEARNED_CONFIDENCE_CAP = 85;
const CONFIRMED_CONFIDENCE_CAP = 95;
const uniq = <T>(values: readonly T[]): T[] => [...new Set(values)];

// ------------------------------------------------------------------------------------------ result helpers
const note = (event: MemoryEvent, type: MemoryEventType, memoryId?: string, detail?: Readonly<Record<string, unknown>>): MemoryEventInput => ({
  at: event.at, tenantId: event.actor.tenantId, actorKind: event.actor.kind, actorId: principalId(event.actor), type, ...(memoryId ? { memoryId } : {}), ...(detail ? { detail } : {}),
});
function finish(state: MemoryState, event: MemoryEvent, result: Omit<MemoryResult, "events">, events: readonly MemoryEventInput[]): MemoryOutcome {
  // the audit trail names the action and the memory, never the knowledge; it is written in the ACTOR's company (a claimed company that is not theirs is not polluted)
  const detail: Record<string, string | number | boolean> = { ok: result.ok, ...(result.refusal ? { reason: result.refusal } : {}), ...(result.memory ? { memoryId: result.memory.id } : {}) };
  return { state: withAudit(state, { at: event.at, actor: principalId(event.actor), tenantId: event.actor.tenantId, action: `${event.type}${result.ok ? "" : ".refused"}`, detail }), result: { ...result, events } };
}
const refuse = (state: MemoryState, event: MemoryEvent, refusal: Refusal, reasons: readonly string[] = []): MemoryOutcome =>
  finish(state, event, { ok: false, refusal, ...(reasons.length > 0 ? { reasons } : {}) }, [note(event, "memory.refused", undefined, { reason: refusal, action: event.type })]);

// ------------------------------------------------------------------------------------------ validation
function validatePermissions(input: Partial<MemoryPermissions> | undefined): string[] {
  if (!input) return [];
  const issues: string[] = [];
  if (input.visibility !== undefined && !["tenant", "restricted", "private"].includes(input.visibility)) issues.push("visibility");
  if (input.minRole !== undefined && !ROLES.includes(input.minRole)) issues.push("minRole");
  if (input.roles !== undefined && (!Array.isArray(input.roles) || input.roles.length > 5 || input.roles.some((role) => !ROLES.includes(role)))) issues.push("roles");
  for (const key of ["workerIds", "userIds"] as const) {
    const list = input[key];
    if (list !== undefined && (!Array.isArray(list) || list.length > 20 || list.some((id) => typeof id !== "string" || !ID.test(id)))) issues.push(key);
  }
  return issues;
}
const mergePermissions = (base: MemoryPermissions, input: Partial<MemoryPermissions> | undefined): MemoryPermissions => ({
  visibility: input?.visibility ?? base.visibility, minRole: input?.minRole ?? base.minRole, roles: input?.roles ?? base.roles, workerIds: input?.workerIds ?? base.workerIds, userIds: input?.userIds ?? base.userIds,
});
const defaultPermissions = (type: MemoryType): MemoryPermissions =>
  type === "system" ? { visibility: "restricted", minRole: "admin", roles: ["admin", "owner"], workerIds: [], userIds: [] } : { visibility: "tenant", minRole: type === "customer" ? "member" : "viewer", roles: [], workerIds: [], userIds: [] };

type Draft = { type: MemoryType; input: RememberInput; learning?: LearnInput["kind"] };

/** The one way a memory is born: screen → validate → merge with what is already known, or create. */
function remember(state: MemoryState, event: Extract<MemoryEvent, { type: "remember" | "learn" }>, draft: Draft): MemoryOutcome {
  const { actor, at } = event;
  const { input, learning } = draft;
  if (!canCreate(actor, learning ? "learning" : draft.type)) return refuse(state, event, "forbidden");
  if (!MEMORY_TYPES.includes(draft.type) || draft.type === "system" && actor.kind !== "system") return refuse(state, event, "forbidden");
  if (input.restricted) return refuse(state, event, "restricted");

  // 1. screen EVERYTHING that would be kept, before anything else
  const raw = input.notes ?? input.summary ?? "";
  if (raw.trim() === "" && (input.summary ?? "").trim() === "") return refuse(state, event, "invalid", ["summary"]);
  const screened = screenText([input.summary ?? "", input.notes ?? "", input.category, (input.tags ?? []).join(" "), input.source?.ref ?? ""].join("\n"), { learning: learning !== undefined });
  if (!screened.ok && screened.primary) return refuse(state, event, screened.primary, screened.reasons);

  // 2. validate
  const issues: string[] = [];
  if ((input.notes?.length ?? 0) > RAW_MAX || (input.summary?.length ?? 0) > RAW_MAX) issues.push("tooLong");
  const category = slug(input.category, 40);
  if (category === "") issues.push("category");
  const tags = uniq((input.tags ?? []).map((tag) => slug(tag)).filter(Boolean));
  if (tags.length > 8) issues.push("tags");
  const importance = input.importance ?? RETENTION.defaultImportance[draft.type];
  const confidence = input.confidence ?? (learning ? 50 : 60);
  if (!Number.isInteger(importance) || importance < 0 || importance > 100) issues.push("importance");
  if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) issues.push("confidence");
  const ttlDays = input.ttlDays === undefined ? RETENTION.defaultTtlDays[draft.type] : input.ttlDays;
  if (ttlDays !== null && (!Number.isInteger(ttlDays) || ttlDays < 1 || ttlDays > 3_650)) issues.push("ttlDays");
  if (input.embeddingRef !== undefined && !EMBEDDING.test(input.embeddingRef)) issues.push("embeddingRef");
  if (input.source !== undefined && (!["worker", "person", "system", "import"].includes(input.source.kind) || (input.source.ref !== undefined && !REF.test(input.source.ref)))) issues.push("source");
  if (input.workerId !== undefined && !ID.test(input.workerId)) issues.push("workerId");
  issues.push(...validatePermissions(input.permissions).map((name) => `permissions:${name}`));
  if (issues.length > 0) return refuse(state, event, "invalid", issues);

  const summary = summarize(maskPersonal(input.summary ?? input.notes ?? ""), RETENTION.summaryMax);
  if (summary === "") return refuse(state, event, "invalid", ["summary"]);
  const workerId = actor.kind === "worker" ? actor.id : input.workerId;
  const proposed = actor.kind === "worker" && draft.type === "decision";
  const cappedImportance = learning ? Math.min(importance, LEARNED_IMPORTANCE_CAP) : importance;
  const cappedConfidence = proposed ? Math.min(confidence, 70) : confidence;
  const finalTags = uniq([...tags, ...(proposed ? ["proposed"] : [])]).slice(0, 8);

  // 3. what is already known is reinforced, not repeated
  const key = dedupKey(draft.type, summary);
  const known = state.memories.find((memory) => memory.tenantId === event.tenantId && memory.status !== "expired" && dedupKey(memory.type, memory.summary) === key && canRead(actor, memory));
  if (known) {
    const cap = known.confirmedBy ? CONFIRMED_CONFIDENCE_CAP : LEARNED_CONFIDENCE_CAP;
    const merged: Memory = {
      ...known, updatedAt: at, importance: Math.max(known.importance, cappedImportance),
      confidence: known.advisory ? Math.min(cap, Math.max(known.confidence, cappedConfidence) + (learning ? 10 : 0)) : Math.max(known.confidence, cappedConfidence),
      tags: uniq([...known.tags, ...finalTags]).slice(0, 8), observations: known.observations + 1,
      expiresAt: known.status === "active" && !known.pinned ? expiryFor(at, known.ttlDays) : known.expiresAt,
    };
    return finish(replaceOne(state, merged), event, { ok: true, memory: merged, merged: true }, [note(event, "memory.merged", merged.id, { observations: merged.observations }), ...(learning ? [note(event, "memory.learned", merged.id, { kind: learning, merged: true })] : [])]);
  }
  if (aliveCount(state, event.tenantId) >= MAX_MEMORIES_PER_TENANT) return refuse(state, event, "limit");

  // 4. a new memory
  const { id, seq } = nextId(state, event.tenantId);
  const createdKind = actor.kind;
  const memory: Memory = {
    id, tenantId: event.tenantId, ...(workerId ? { workerId } : {}), type: draft.type, createdAt: at, updatedAt: at, createdBy: { kind: createdKind, id: principalId(actor) },
    source: { kind: input.source?.kind ?? (actor.kind === "system" ? "system" : actor.kind), ...(input.source?.ref ? { ref: input.source.ref } : {}) },
    importance: cappedImportance, confidence: cappedConfidence, category, tags: finalTags, ttlDays, expiresAt: expiryFor(at, ttlDays),
    permissions: mergePermissions(defaultPermissions(draft.type), input.permissions), summary, ...(input.embeddingRef ? { embeddingRef: input.embeddingRef } : {}),
    status: "active", pinned: false, advisory: learning !== undefined, observations: 1, compressed: false, ...(summary.length < (input.notes ?? input.summary ?? "").length ? { originalLength: (input.notes ?? input.summary ?? "").length } : {}),
    uses: 0, votes: {},
  };
  const next = withMemories({ ...state, seq }, [...state.memories, memory]);
  return finish(next, event, { ok: true, memory }, [note(event, "memory.created", id, { type: draft.type, importance: memory.importance, summarized: memory.originalLength !== undefined }), ...(learning ? [note(event, "memory.learned", id, { kind: learning })] : [])]);
}

const LEARN_TYPE: Readonly<Record<LearnInput["kind"], MemoryType>> = { preference: "preference", decision: "decision", process: "learning", workstyle: "learning" };

function learn(state: MemoryState, event: Extract<MemoryEvent, { type: "learn" }>): MemoryOutcome {
  const { input, actor } = event;
  if (actor.kind === "system") return refuse(state, event, "forbidden"); // the system does not learn "ways of working": it writes System Memory
  if (!LEARN_KINDS.includes(input.kind)) return refuse(state, event, "invalid", ["kind"]);
  const type = LEARN_TYPE[input.kind];
  const draft: RememberInput = {
    type, category: `learned-${input.kind}`, tags: [...(input.tags ?? []), "learned", input.kind], ttlDays: RETENTION.defaultTtlDays[type] ?? 180,
    ...(input.summary !== undefined ? { summary: input.summary } : {}), ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.workerId !== undefined ? { workerId: input.workerId } : {}), ...(input.source ? { source: input.source } : {}),
  };
  return remember(state, event, { type, input: draft, learning: input.kind });
}

// ------------------------------------------------------------------------------------------ the reducer
export function reduceMemory(state: MemoryState, event: MemoryEvent, env: MemoryEnv): MemoryOutcome {
  const { actor } = event;
  if (actor.tenantId !== event.tenantId) return refuse(state, event, "tenant");
  if (Number.isNaN(Date.parse(event.at))) return refuse(state, event, "invalid", ["at"]);
  if (actor.kind === "worker" && !env.isWorkerActive(actor.tenantId, actor.id)) return refuse(state, event, "workerInactive");
  const find = (id: string): Memory | undefined => {
    const memory = getIn(state, event.tenantId, id);
    return memory && canRead(actor, memory) ? memory : undefined; // what the asker cannot read does not exist for them
  };

  switch (event.type) {
    case "remember": return remember(state, event, { type: event.input.type, input: event.input });
    case "learn": return learn(state, event);
    case "use": {
      const used: Memory[] = [];
      let next = state;
      for (const id of uniq(event.ids).slice(0, 50)) {
        const memory = find(id);
        if (!memory || memory.status === "expired") continue;
        const touched: Memory = { ...memory, uses: memory.uses + 1, lastUsedAt: event.at, expiresAt: memory.status === "active" && !memory.pinned ? expiryFor(event.at, memory.ttlDays) : memory.expiresAt };
        next = replaceOne(next, touched);
        used.push(touched);
      }
      return finish(next, event, { ok: true, used: used.map((memory) => memory.id) }, used.length > 0 ? [note(event, "memory.used", undefined, { count: used.length })] : []);
    }
    case "feedback": {
      if (!canVote(actor)) return refuse(state, event, "forbidden");
      const memory = find(event.id);
      if (!memory) return refuse(state, event, "notFound");
      if (event.value !== "up" && event.value !== "down") return refuse(state, event, "invalid", ["value"]);
      const value: Vote = event.value;
      const changed: Memory = { ...memory, votes: { ...memory.votes, [`${actor.kind}:${principalId(actor)}`]: value } };
      return finish(replaceOne(state, changed), event, { ok: true, memory: changed }, [note(event, "memory.feedback", memory.id, { value })]);
    }
    case "confirm": {
      if (!canConfirm(actor)) return refuse(state, event, "forbidden");
      const memory = find(event.id);
      if (!memory) return refuse(state, event, "notFound");
      const changed: Memory = { ...memory, confidence: Math.max(memory.confidence, 90), confirmedBy: principalId(actor), updatedAt: event.at };
      return finish(replaceOne(state, changed), event, { ok: true, memory: changed }, [note(event, "memory.confirmed", memory.id)]);
    }
    case "pin": {
      if (!canAdminister(actor)) return refuse(state, event, "forbidden");
      const memory = find(event.id);
      if (!memory) return refuse(state, event, "notFound");
      const changed: Memory = { ...memory, pinned: event.pinned, updatedAt: event.at, expiresAt: event.pinned || memory.status !== "active" ? null : expiryFor(event.at, memory.ttlDays) };
      return finish(replaceOne(state, changed), event, { ok: true, memory: changed }, [note(event, "memory.pinned", memory.id, { pinned: event.pinned })]);
    }
    case "archive": {
      const memory = find(event.id);
      if (!memory) return refuse(state, event, "notFound");
      if (!canManage(actor, memory)) return refuse(state, event, "forbidden");
      const changed: Memory = { ...memory, status: "archived", archivedAt: event.at, expiresAt: null, updatedAt: event.at };
      return finish(replaceOne(state, changed), event, { ok: true, memory: changed }, [note(event, "memory.archived", memory.id, { by: "person" })]);
    }
    case "restore": {
      const memory = find(event.id);
      if (!memory) return refuse(state, event, "notFound");
      if (!canManage(actor, memory)) return refuse(state, event, "forbidden");
      const { archivedAt: _archivedAt, expiredAt: _expiredAt, ...rest } = memory;
      const changed: Memory = { ...rest, status: "active", updatedAt: event.at, expiresAt: memory.pinned ? null : expiryFor(event.at, memory.ttlDays) };
      return finish(replaceOne(state, changed), event, { ok: true, memory: changed }, [note(event, "memory.restored", memory.id)]);
    }
    case "forget": {
      const memory = find(event.id);
      if (!memory) return refuse(state, event, "notFound");
      if (!canManage(actor, memory)) return refuse(state, event, "forbidden");
      // an important memory is never deleted: it can be archived
      if (isImportant(memory)) return refuse(state, event, "important", ["archive"]);
      return finish(removeMany(state, event.tenantId, new Set([memory.id])), event, { ok: true }, [note(event, "memory.deleted", memory.id, { by: "person" })]);
    }
    case "permissions.set": {
      if (!canAdminister(actor)) return refuse(state, event, "forbidden");
      const memory = find(event.id);
      if (!memory) return refuse(state, event, "notFound");
      const issues = validatePermissions(event.permissions);
      if (issues.length > 0) return refuse(state, event, "invalid", issues.map((name) => `permissions:${name}`));
      const permissions = mergePermissions(memory.permissions, event.permissions);
      // System Memory never opens below the administrators
      if (memory.type === "system" && (permissions.visibility === "tenant" ? permissions.minRole : "admin") !== "admin" && permissions.visibility === "tenant") return refuse(state, event, "forbidden");
      const changed: Memory = { ...memory, permissions, updatedAt: event.at };
      return finish(replaceOne(state, changed), event, { ok: true, memory: changed }, [note(event, "memory.permissions_changed", memory.id, { visibility: permissions.visibility })]);
    }
    case "sweep": {
      if (!canSweep(actor)) return refuse(state, event, "forbidden");
      const swept = sweepTenant(state, event.tenantId, Date.parse(event.at));
      const { report } = swept;
      const events = [
        ...report.expired.map((id) => note(event, "memory.expired", id)), ...report.archived.map((id) => note(event, "memory.archived", id, { by: "ttl" })),
        ...report.deleted.map((id) => note(event, "memory.deleted", id, { by: "ttl" })), ...report.compressed.map((id) => note(event, "memory.compressed", id)),
        note(event, "memory.swept", undefined, { kept: report.kept, expired: report.expired.length, archived: report.archived.length, deleted: report.deleted.length, compressed: report.compressed.length }),
      ];
      return finish(swept.state, event, { ok: true, sweep: report }, events);
    }
  }
}

// ------------------------------------------------------------------------------------------ the engine: state + log + observability around the reducer
export type EngineOptions = { env: MemoryEnv; /** milliseconds; injected so nothing here reads a clock */ now: () => number; state?: MemoryState };

export class MemoryEngine {
  state: MemoryState;
  readonly log = new MemoryEventLog();
  readonly observability = new MemoryObservability(this.log);
  constructor(private readonly options: EngineOptions) { this.state = options.state ?? newMemoryState(); }

  private at(): string { return new Date(this.options.now()).toISOString(); }
  dispatch(event: MemoryEvent): MemoryResult {
    const { state, result } = reduceMemory(this.state, event, this.options.env);
    this.state = state;
    for (const input of result.events) this.log.emit(input);
    return result;
  }
  private send(actor: Principal, rest: DistributiveOmit<MemoryEvent, "tenantId" | "actor" | "at">): MemoryResult { return this.dispatch({ ...rest, tenantId: actor.tenantId, actor, at: this.at() } as MemoryEvent); }

  remember(actor: Principal, input: RememberInput): MemoryResult { return this.send(actor, { type: "remember", input }); }
  learn(actor: Principal, input: LearnInput): MemoryResult { return this.send(actor, { type: "learn", input }); }
  use(actor: Principal, ids: readonly string[]): MemoryResult { return this.send(actor, { type: "use", ids }); }
  feedback(actor: Principal, id: string, value: Vote): MemoryResult { return this.send(actor, { type: "feedback", id, value }); }
  confirm(actor: Principal, id: string): MemoryResult { return this.send(actor, { type: "confirm", id }); }
  pin(actor: Principal, id: string, pinned: boolean): MemoryResult { return this.send(actor, { type: "pin", id, pinned }); }
  archive(actor: Principal, id: string): MemoryResult { return this.send(actor, { type: "archive", id }); }
  restore(actor: Principal, id: string): MemoryResult { return this.send(actor, { type: "restore", id }); }
  forget(actor: Principal, id: string): MemoryResult { return this.send(actor, { type: "forget", id }); }
  setPermissions(actor: Principal, id: string, permissions: Partial<MemoryPermissions>): MemoryResult { return this.send(actor, { type: "permissions.set", id, permissions }); }
  sweep(actor: Principal): MemoryResult { return this.send(actor, { type: "sweep" }); }

  /** Searches without changing anything but the log: hits, misses, latency and the best score are recorded. */
  search(actor: Principal, query: SearchQuery): SearchResult {
    const started = this.options.now();
    const result = searchMemories(this.state, actor, query, started);
    const latencyMs = Math.max(0, this.options.now() - started);
    this.log.emit({ at: this.at(), tenantId: actor.tenantId, actorKind: actor.kind, actorId: principalId(actor), type: "memory.searched", detail: { hits: result.hits.length, total: result.total, terms: result.terms, latencyMs, ...(result.hits[0] ? { topScore: result.hits[0].score } : {}) } });
    return result;
  }
  /** Search, and count the returned memories as USED (their usage and TTL are refreshed). */
  recall(actor: Principal, query: SearchQuery): SearchResult {
    const result = this.search(actor, query);
    if (result.hits.length > 0) this.use(actor, result.hits.map((hit) => hit.memory.id));
    return result;
  }
  snapshot(tenantId: string) { return this.observability.snapshot(tenantId, this.state, this.options.now()); }
}
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
