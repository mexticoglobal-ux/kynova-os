// The one audit contract. Every module's own audit trail maps into this record, so who did what, in which company, when, and with what result,
// is answered the same way everywhere. The log is append-only: there is no way to edit or remove a record, and each record is chained to the previous
// one of its company by a SHA-256 hash, so any change to history is detectable. Details are cleaned of anything that looks like a secret.
import { isPerson, isWorker } from "@/lib/contracts/platform/actors";
import { sha256Hex } from "./crypto";
import type { ModuleId } from "./events";
import { redactSecrets } from "./secrets";

export type ActorKind = "person" | "worker" | "system";
export type Outcome = "success" | "refused" | "error";

export type AuditInput = {
  tenantId: string;
  organizationId?: string;
  actorId: string;
  actorKind: ActorKind;
  module: ModuleId;
  action: string;
  category: string;
  target?: string;
  detail?: string;
  outcome: Outcome;
  requestId?: string;
  at: string;
};
export type AuditRecord = Readonly<AuditInput & { id: string; seq: number; prevHash: string; hash: string }>;

export const GENESIS_HASH = "0".repeat(64);
export const actorKindOf = (actor: string): ActorKind => (isWorker(actor) ? "worker" : isPerson(actor) ? "person" : "system");

/** What every module's audit entry looks like. The platform modules share this shape (their `kind` or `category` names the area). */
export type ModuleAuditEntry = { at: string; actor: string; action: string; category?: string; kind?: string; detail?: string };

/** Maps an entry of a module's own audit trail into the central contract. */
export function auditFromModuleEntry(module: ModuleId, tenantId: string, entry: ModuleAuditEntry, extra: { outcome?: Outcome; requestId?: string; target?: string } = {}): AuditInput {
  return {
    tenantId, actorId: entry.actor, actorKind: actorKindOf(entry.actor), module, action: entry.action, category: entry.category ?? entry.kind ?? "other",
    ...(entry.detail ? { detail: entry.detail } : {}), outcome: extra.outcome ?? "success", ...(extra.requestId ? { requestId: extra.requestId } : {}), ...(extra.target ? { target: extra.target } : {}), at: entry.at,
  };
}

const canonical = (record: Omit<AuditRecord, "hash">): string =>
  JSON.stringify([record.id, record.seq, record.tenantId, record.organizationId ?? null, record.actorId, record.actorKind, record.module, record.action, record.category, record.target ?? null, record.detail ?? null, record.outcome, record.requestId ?? null, record.at, record.prevHash]);

export type AuditVerification = { ok: boolean; records: number; brokenAt?: number };

export class AuditLog {
  private readonly records: AuditRecord[] = [];
  private readonly lastHash = new Map<string, string>();
  private readonly counters = new Map<string, number>();

  /** Adds a record. The detail is cleaned of secrets first; the record is frozen and chained to the previous one of its company. */
  async record(input: AuditInput): Promise<AuditRecord> {
    const seq = (this.counters.get(input.tenantId) ?? 0) + 1;
    const prevHash = this.lastHash.get(input.tenantId) ?? GENESIS_HASH;
    const clean: Omit<AuditRecord, "hash"> = { ...input, ...(input.detail ? { detail: redactSecrets(input.detail) } : {}), id: `aud_${input.tenantId}_${seq}`, seq, prevHash };
    const record: AuditRecord = Object.freeze({ ...clean, hash: await sha256Hex(canonical(clean)) });
    this.records.push(record);
    this.counters.set(input.tenantId, seq);
    this.lastHash.set(input.tenantId, record.hash);
    return record;
  }

  /** The records of ONE company, oldest first. Reading always names a company. */
  list(tenantId: string, filter: { module?: ModuleId; actorId?: string; outcome?: Outcome; category?: string } = {}): AuditRecord[] {
    return this.records.filter((item) => item.tenantId === tenantId && (!filter.module || item.module === filter.module) && (!filter.actorId || item.actorId === filter.actorId) && (!filter.outcome || item.outcome === filter.outcome) && (!filter.category || item.category === filter.category));
  }

  /** Recomputes the chain of a company: any record that was changed, removed or reordered breaks it. */
  async verify(tenantId: string): Promise<AuditVerification> {
    const records = this.list(tenantId);
    let previous = GENESIS_HASH;
    for (const [index, record] of records.entries()) {
      const { hash, ...rest } = record;
      if (record.prevHash !== previous || record.seq !== index + 1 || (await sha256Hex(canonical(rest))) !== hash) return { ok: false, records: records.length, brokenAt: record.seq };
      previous = hash;
    }
    return { ok: true, records: records.length };
  }

  get size(): number {
    return this.records.length;
  }
}
