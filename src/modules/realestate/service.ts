import type { IntegrationState } from "@/platform/integrations/status";
import { z } from "zod";
import type { Role } from "@/config/roles";
import type { ActivitySink, SinkEvent } from "@/platform/activity";
import { createWorkflowService, createMemoryWorkflowStore, runDefs, rank, type WorkflowItem, type WorkflowStore } from "@/platform/workflows";
import { allows } from "./access";
import {
  activityInput, activityPatch, buyerInput, buyerPatch, decisionInput, digestQuery, ownerInput, ownerPatch, prepareInput, propertyInput, propertyPatch,
  CHANNELS, type ActivityRecord, type BuyerRecord, type Capability, type OwnerRecord, type PropertyRecord, type PublicationRecord,
} from "./domain";
import { computeKpis, matchesForBuyer, matchesForProperty, rulesMatcher, type Matcher } from "./engine";
import { buyerOpportunity, healthScore, ownerOpportunity, propertyOpportunity } from "./scores";
import type { KnowledgeState } from "@/platform/business-profile/knowledge";
import { buildExecutive } from "./executive";
import { REAL_ESTATE_WORKFLOWS, SYSTEM, WORKFLOW_IDS, ix, isReady, type Facts } from "./workflows";
import { RealEstateError } from "./errors";
import type { RealEstateStore } from "./store";
import { BOOTSTRAP_FOCUS, INTEGRATIONS, REAL_ESTATE_TEAM } from "./team";

export interface Actor { tenantId: string; userId: string; role: Role; requestId?: string }
export interface MemberInfo { key: string; name: string; entitled: boolean; active: boolean; activityKey: string }
export interface RealEstatePorts {
  member(a: Actor, key: string): Promise<MemberInfo | null>;
  /** Creates a DRAFT post in Marketing. Nothing is published or sent. */
  createDraft(a: Actor, d: { title: string; body: string }): Promise<{ id: string }>;
  /** True when the company installed its Blueprint in Bootstrap mode (no paid advertising is ever recommended). Optional: absent = not Bootstrap. */
  isBootstrap?(a: Actor): Promise<boolean>;
  /** What the company has registered about itself (Business Profile). Optional: absent = the CEO has no profile context. */
  businessProfile?(a: Actor): Promise<KnowledgeState | null>;
  /** The Company Integrations Framework state. Absent = unknown, and nothing is claimed about any platform. */
  integrations?(a: Actor): Promise<IntegrationState | null>;
  /** Several AI Employees at once (one lookup instead of one per employee). Optional: falls back to `member`. */
  members?(a: Actor, keys: readonly string[]): Promise<MemberInfo[]>;
  /** Evidence of the team's work from the Activity Engine, newest first. Optional: absent = empty timeline. */
  timeline?(a: Actor, q: { since: number; limit: number }): Promise<{ at: number; employeeKey: string; action: string; summary: string; subjectKind: string | null; subjectId: string | null }[]>;
}
export interface RealEstateDeps { store: RealEstateStore; ports: RealEstatePorts; newId: () => string; now?: () => number; activity?: ActivitySink; matcher?: Matcher; workflows?: WorkflowStore }
export type RealEstateService = ReturnType<typeof createRealEstateService>;

function parse<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new RealEstateError("validation_failed", "The request is not valid.", { fields: r.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
  return r.data;
}
const DAY = 86_400_000, CAP = 2000, MANY_VISITS = 3;
const SOCIAL = new Set(["facebook", "instagram", "linkedin"]);

export function createRealEstateService(deps: RealEstateDeps) {
  const { store, ports } = deps, now = deps.now ?? Date.now, matcher = deps.matcher ?? rulesMatcher;
  const need = (a: Actor, c: Capability): void => { if (!allows(a.role, c)) throw new RealEstateError("forbidden", "Your role cannot do this."); };
  const rec = async (a: Actor, e: SinkEvent): Promise<void> => {
    if (!deps.activity) return;
    await deps.activity.record({ tenantId: a.tenantId, ...(a.requestId ? { requestId: a.requestId } : {}) }, { module: "realestate", source: "realestate", actorKind: "user", actorId: a.userId, mode: "production", ...e });
  };
  const member = async (a: Actor, key: string): Promise<MemberInfo | null> => { try { return await ports.member(a, key); } catch { return null; } };
  const must = async <T>(p: Promise<T | null>, what: string): Promise<T> => { const r = await p; if (!r) throw new RealEstateError("not_found", `${what} not found.`); return r; };
  const all = async <K extends "property" | "owner" | "buyer" | "activity" | "publication">(kind: K, a: Actor, where: readonly { col: string; op: "eq"; value: string }[] = []) => store.query(kind, a.tenantId, { where: where as never, limit: CAP, orderBy: { col: "createdAt" as never, dir: "desc" } });
  const ref = async (kind: "property" | "owner" | "buyer", a: Actor, id: string | null) => { if (id) await must(store.get(kind, a.tenantId, id), kind); };

  /* ───────────── Properties ───────────── */
  async function listProperties(a: Actor, q: { status?: string } = {}): Promise<PropertyRecord[]> { need(a, "view"); return all("property", a, q.status ? [{ col: "status", op: "eq", value: q.status }] : []); }
  async function getProperty(a: Actor, id: string): Promise<PropertyRecord> { need(a, "view"); return must(store.get("property", a.tenantId, id), "Property"); }
  async function createProperty(a: Actor, input: unknown): Promise<PropertyRecord> {
    need(a, "manage"); const i = parse(propertyInput, input); await ref("owner", a, i.ownerId);
    const t = now(), row: PropertyRecord = { id: deps.newId(), tenantId: a.tenantId, ...i, status: "active", listedAt: t, closedAt: null, closedPriceMinor: null, commissionMinor: null, createdBy: a.userId, createdAt: t, updatedAt: t };
    await store.insert("property", row);
    await rec(a, { action: "realestate.property.created", summary: `Property registered: ${row.title}`, subjectKind: "property", subjectId: row.id, idempotencyKey: `re-prop:${row.id}`, reversible: true, revertHint: { archive: row.id } });
    await react(a, { property: row });
    return row;
  }
  async function updateProperty(a: Actor, id: string, input: unknown): Promise<PropertyRecord> {
    need(a, "manage"); const p = parse(propertyPatch, input), cur = await getProperty(a, id);
    if (p.ownerId !== undefined) await ref("owner", a, p.ownerId);
    const t = now(), patch: Partial<PropertyRecord> = { ...p, updatedAt: t } as Partial<PropertyRecord>;
    delete (patch as Record<string, unknown>).closedPriceMinor; delete (patch as Record<string, unknown>).commissionMinor;
    const to = p.status;
    if (to && to !== cur.status) {
      if (["sold", "rented"].includes(cur.status)) { if (to !== "archived") throw new RealEstateError("invalid_state", "A closed property can only be archived."); }
      if (to === "sold" && cur.operation !== "sale") throw new RealEstateError("invalid_state", "Only a property for sale can be marked sold.");
      if (to === "rented" && cur.operation !== "rent") throw new RealEstateError("invalid_state", "Only a property for rent can be marked rented.");
      if (to === "sold" || to === "rented") {
        if (p.closedPriceMinor === undefined) throw new RealEstateError("validation_failed", "Enter the real closing price.", { fields: [{ field: "closedPriceMinor", message: "Required to close a property." }] });
        patch.closedAt = t; patch.closedPriceMinor = p.closedPriceMinor; patch.commissionMinor = p.commissionMinor ?? Math.round((p.closedPriceMinor * (p.commissionBp ?? cur.commissionBp)) / 10_000);
      }
    }
    const row = (await store.update("property", a.tenantId, id, patch)) as PropertyRecord;
    const closed = to === "sold" || to === "rented";
    await rec(a, { action: closed ? "realestate.property.closed" : to === "archived" ? "realestate.property.archived" : "realestate.property.updated", summary: `${closed ? `Property ${to}` : to === "archived" ? "Property archived" : "Property updated"}: ${row.title}`, subjectKind: "property", subjectId: id, idempotencyKey: `re-prop:${id}:${row.updatedAt}`, reversible: !closed, ...(closed ? {} : { revertHint: { previousStatus: cur.status } }) });
    await react(a, { property: row });
    return row;
  }

  /* ───────────── Owners (captación) ───────────── */
  async function listOwners(a: Actor): Promise<OwnerRecord[]> { need(a, "view"); return all("owner", a); }
  async function createOwner(a: Actor, input: unknown): Promise<OwnerRecord> {
    need(a, "manage"); const i = parse(ownerInput, input), t = now(), row: OwnerRecord = { id: deps.newId(), tenantId: a.tenantId, ...i, stage: "new", createdBy: a.userId, createdAt: t, updatedAt: t };
    await store.insert("owner", row);
    await rec(a, { action: "realestate.owner.created", summary: `Owner registered: ${row.name}`, subjectKind: "owner", subjectId: row.id, idempotencyKey: `re-own:${row.id}` });
    await react(a, { owner: row });
    return row;
  }
  async function updateOwner(a: Actor, id: string, input: unknown): Promise<OwnerRecord> {
    need(a, "manage"); const p = parse(ownerPatch, input); await must(store.get("owner", a.tenantId, id), "Owner");
    const row = (await store.update("owner", a.tenantId, id, { ...p, updatedAt: now() })) as OwnerRecord;
    await rec(a, { action: "realestate.owner.updated", summary: `Owner updated: ${row.name}${p.stage ? ` → ${p.stage}` : ""}`, subjectKind: "owner", subjectId: id, idempotencyKey: `re-own:${id}:${row.updatedAt}` });
    await react(a, { owner: row });
    return row;
  }

  /* ───────────── Buyers ───────────── */
  async function listBuyers(a: Actor): Promise<BuyerRecord[]> { need(a, "view"); return all("buyer", a); }
  async function createBuyer(a: Actor, input: unknown): Promise<BuyerRecord> {
    need(a, "manage"); const i = parse(buyerInput, input), t = now(), row: BuyerRecord = { id: deps.newId(), tenantId: a.tenantId, ...i, stage: "new", createdBy: a.userId, createdAt: t, updatedAt: t };
    await store.insert("buyer", row);
    await rec(a, { action: "realestate.buyer.created", summary: `Buyer registered: ${row.name}`, subjectKind: "buyer", subjectId: row.id, idempotencyKey: `re-buy:${row.id}` });
    await react(a, { buyer: row });
    return row;
  }
  async function updateBuyer(a: Actor, id: string, input: unknown): Promise<BuyerRecord> {
    need(a, "manage"); const p = parse(buyerPatch, input), cur = await must(store.get("buyer", a.tenantId, id), "Buyer");
    if (p.budgetMaxMinor !== undefined && p.budgetMaxMinor > 0 && p.budgetMaxMinor < (p.budgetMinMinor ?? cur.budgetMinMinor)) throw new RealEstateError("validation_failed", "Maximum budget must be at least the minimum.", { fields: [{ field: "budgetMaxMinor", message: "Too low." }] });
    const row = (await store.update("buyer", a.tenantId, id, { ...p, updatedAt: now() })) as BuyerRecord;
    await rec(a, { action: "realestate.buyer.updated", summary: `Buyer updated: ${row.name}${p.stage ? ` → ${p.stage}` : ""}`, subjectKind: "buyer", subjectId: id, idempotencyKey: `re-buy:${id}:${row.updatedAt}` });
    await react(a, { buyer: row });
    return row;
  }
  /** Rules-based suggestions (no AI). Read-only: nothing is sent to anyone. */
  async function matchesOfBuyer(a: Actor, id: string) { need(a, "view"); const b = await must(store.get("buyer", a.tenantId, id), "Buyer"); return matchesForBuyer(b, await all("property", a, [{ col: "status", op: "eq", value: "active" }]), matcher); }
  async function matchesOfProperty(a: Actor, id: string) { need(a, "view"); const p = await getProperty(a, id); return matchesForProperty(p, await all("buyer", a), matcher); }

  /* ───────────── Agenda ───────────── */
  async function listActivities(a: Actor, q: { status?: string; from?: number; to?: number } = {}): Promise<ActivityRecord[]> {
    need(a, "view");
    const where: { col: string; op: string; value: string | number }[] = [];
    if (q.status) where.push({ col: "status", op: "eq", value: q.status }); if (q.from) where.push({ col: "whenAt", op: "gte", value: q.from }); if (q.to) where.push({ col: "whenAt", op: "lte", value: q.to });
    return store.query("activity", a.tenantId, { where: where as never, limit: CAP, orderBy: { col: "whenAt", dir: "asc" } });
  }
  async function createActivity(a: Actor, input: unknown): Promise<ActivityRecord> {
    need(a, "manage"); const i = parse(activityInput, input); await ref("property", a, i.propertyId); await ref("buyer", a, i.buyerId); await ref("owner", a, i.ownerId);
    const t = now(), row: ActivityRecord = { id: deps.newId(), tenantId: a.tenantId, ...i, status: "planned", createdBy: a.userId, createdAt: t, updatedAt: t };
    await store.insert("activity", row);
    await rec(a, { action: "realestate.activity.created", summary: `${row.kind.replace("_", " ")} scheduled: ${row.title}`, subjectKind: "activity", subjectId: row.id, idempotencyKey: `re-act:${row.id}`, reversible: true });
    await react(a, { activity: row });
    return row;
  }
  async function updateActivity(a: Actor, id: string, input: unknown): Promise<ActivityRecord> {
    need(a, "manage"); const p = parse(activityPatch, input); await must(store.get("activity", a.tenantId, id), "Activity");
    const row = (await store.update("activity", a.tenantId, id, { ...p, updatedAt: now() })) as ActivityRecord;
    await rec(a, { action: "realestate.activity.updated", summary: `Activity ${p.status ?? "updated"}: ${row.title}`, subjectKind: "activity", subjectId: id, idempotencyKey: `re-act:${id}:${row.updatedAt}` });
    await react(a, { activity: row });
    return row;
  }

  /* ───────────── Marketing (always through human approval) ───────────── */
  const money = (minor: number, cur: string) => new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(minor / 100);
  /** A brief built only from the property's recorded facts. The final wording is written by a person (or, later, an AI provider): nothing is invented. */
  function brief(p: PropertyRecord, channel: string, locale: "es" | "en") {
    const facts = [p.kind, p.zone, p.bedrooms ? `${p.bedrooms} ${locale === "es" ? "hab." : "bd"}` : "", p.areaM2 ? `${p.areaM2} m²` : "", money(p.priceMinor, p.currency), p.operation === "rent" ? (locale === "es" ? "alquiler" : "for rent") : (locale === "es" ? "venta" : "for sale")].filter(Boolean).join(" · ");
    const head = locale === "es" ? `Brief para ${channel}` : `Brief for ${channel}`, how = locale === "es" ? "Redacta el texto final destacando lo real de la propiedad. No se publica nada hasta que lo apruebes." : "Write the final copy around what is real about the property. Nothing is published until you approve it.";
    return { title: `${p.title} · ${channel}`, body: `${head}\n${facts}\n${p.description ? `${p.description}\n` : ""}${how}` };
  }
  async function listPublications(a: Actor, q: { status?: string } = {}): Promise<PublicationRecord[]> { need(a, "view"); return all("publication", a, q.status ? [{ col: "status", op: "eq", value: q.status }] : []); }
  async function prepare(a: Actor, input: unknown): Promise<PublicationRecord[]> {
    need(a, "manage"); const i = parse(prepareInput, input), p = await getProperty(a, i.propertyId);
    if (p.status !== "active" && p.status !== "reserved") throw new RealEstateError("invalid_state", "Only active or reserved properties can be promoted.");
    const who = await member(a, "marketing_manager"), out: PublicationRecord[] = [], t = now();
    for (const channel of new Set(i.channels)) {
      const b = brief(p, channel, i.locale), found = (await store.query("publication", a.tenantId, { where: [{ col: "propertyId", op: "eq", value: p.id }, { col: "channel", op: "eq", value: channel }], limit: 1 }))[0];
      if (found) { out.push(found.status === "proposed" ? (await store.update("publication", a.tenantId, found.id, { ...b, updatedAt: t })) as PublicationRecord : found); continue; }
      const row: PublicationRecord = { id: deps.newId(), tenantId: a.tenantId, propertyId: p.id, channel, ...b, status: "proposed", outcome: "", refId: null, preparedBy: who?.key ?? "marketing_manager", decidedBy: null, decidedAt: null, createdAt: t, updatedAt: t };
      await store.insert("publication", row); out.push(row);
      await rec(a, { action: "realestate.publication.prepared", summary: `Marketing Manager prepared a ${channel} brief for ${p.title}`, subjectKind: "publication", subjectId: row.id, employeeKey: who?.activityKey ?? "marketing_manager", actorKind: "employee", actorId: who?.activityKey ?? "marketing_manager", mode: "simulation", idempotencyKey: `re-pub:${row.id}` });
    }
    return out;
  }
  async function decide(a: Actor, id: string, input: unknown): Promise<PublicationRecord> {
    need(a, "approve"); const { approve } = parse(decisionInput, input), cur = await must(store.get("publication", a.tenantId, id), "Publication");
    if (cur.status !== "proposed") throw new RealEstateError("invalid_state", "This publication was already decided.");
    const t = now(); let outcome: PublicationRecord["outcome"] = "", refId: string | null = null;
    if (approve) { if (SOCIAL.has(cur.channel)) { refId = (await ports.createDraft(a, { title: cur.title, body: cur.body })).id; outcome = "draft_created"; } else outcome = "prepared"; }
    const row = (await store.update("publication", a.tenantId, id, { status: approve ? "approved" : "rejected", outcome, refId, decidedBy: a.userId, decidedAt: t, updatedAt: t })) as PublicationRecord;
    await rec(a, { action: approve ? "realestate.publication.approved" : "realestate.publication.rejected", summary: `${approve ? "Approved" : "Rejected"} the ${cur.channel} publication`, subjectKind: "publication", subjectId: id, outcome: "success", idempotencyKey: `re-pub:${id}:decided` });
    return row;
  }

  /* ───────────── KPIs, digest, overview ───────────── */
  async function kpis(a: Actor, q: { from?: number; to?: number } = {}) {
    need(a, "view"); const t = now(), to = q.to ?? t, from = q.from ?? t - 30 * DAY;
    const [props, owners, buyers] = await Promise.all([all("property", a), all("owner", a), all("buyer", a)]);
    return { from, to, ...computeKpis(props, owners, buyers, from, to), truncated: props.length >= CAP || buyers.length >= CAP };
  }
  /** "Mientras estabas fuera…": only counts what the data shows. An item with nothing behind it is simply absent. */
  async function digest(a: Actor, input: unknown = {}) {
    need(a, "view"); const t = now(), since = parse(digestQuery, input).since ?? t - DAY;
    const [props, buyers, owners, acts, pubs] = await Promise.all([all("property", a), all("buyer", a), all("owner", a), all("activity", a), all("publication", a)]);
    const items: { employee: string; key: string; count: number; subjects: { kind: string; id: string; label: string }[] }[] = [];
    const add = (employee: string, key: string, subjects: { kind: string; id: string; label: string }[]) => { if (subjects.length) items.push({ employee, key, count: subjects.length, subjects: subjects.slice(0, 5) }); };
    add("buyer_specialist", "buyers_registered", buyers.filter((b) => b.createdAt >= since).map((b) => ({ kind: "buyer", id: b.id, label: b.name })));
    add("seller_specialist", "owners_registered", owners.filter((o) => o.createdAt >= since).map((o) => ({ kind: "owner", id: o.id, label: o.name })));
    const active = props.filter((p) => p.status === "active"), live = buyers.filter((b) => b.stage !== "won" && b.stage !== "lost");
    add("listing_manager", "properties_with_potential", active.filter((p) => matchesForProperty(p, live, matcher).length > 0).map((p) => ({ kind: "property", id: p.id, label: p.title })));
    add("follow_up_manager", "clients_need_follow_up", [
      ...owners.filter((o) => !["mandate", "lost"].includes(o.stage) && o.nextActionAt !== null && o.nextActionAt <= t).map((o) => ({ kind: "owner", id: o.id, label: o.name })),
      ...buyers.filter((b) => !["won", "lost"].includes(b.stage) && b.nextActionAt !== null && b.nextActionAt <= t).map((b) => ({ kind: "buyer", id: b.id, label: b.name }))]);
    const visits = new Map<string, number>(); for (const x of acts) if (x.kind === "visit" && x.status === "done" && x.propertyId) visits.set(x.propertyId, (visits.get(x.propertyId) ?? 0) + 1);
    add("property_manager", "property_many_visits", active.filter((p) => (visits.get(p.id) ?? 0) >= MANY_VISITS).map((p) => ({ kind: "property", id: p.id, label: p.title })));
    add("marketing_manager", "publication_ready", pubs.filter((p) => p.status === "proposed").map((p) => ({ kind: "publication", id: p.id, label: p.title })));
    add("appointment_manager", "appointments_soon", acts.filter((x) => x.status === "planned" && x.whenAt >= t && x.whenAt <= t + DAY).map((x) => ({ kind: "activity", id: x.id, label: x.title })));
    const w = await wf.list(a.tenantId, { system: SYSTEM, statuses: ["open"], since, limit: 1000 }), by = (id: string) => w.filter((i) => i.workflow === id);
    const subj = (xs: WorkflowItem[], kind: string, f: (i: WorkflowItem) => string) => xs.map((i) => ({ kind, id: i.subjectId, label: f(i) }));
    add("buyer_specialist", "w_matches", subj(by("buyer_matching"), "buyer", (i) => String(i.params.buyer ?? "")));
    add("listing_manager", "w_reviews", subj(by("listing_review"), "property", (i) => String(i.params.title ?? "")));
    add("follow_up_manager", "w_followups", subj(by("followup"), "client", (i) => String(i.params.name ?? "")));
    add("marketing_manager", "w_drafts", pubs.filter((p) => p.createdAt >= since).map((p) => ({ kind: "publication", id: p.id, label: p.title })));
    add("real_estate_director", "w_opportunities", subj(by("opportunity"), "client", (i) => String(i.params.name ?? "")));
    add("analytics_manager", "w_performance", subj(by("performance_watch"), "system", () => ""));
    add("marketing_manager", "w_growth", subj(by("bootstrap_growth"), "system", () => ""));
    return { since, items };
  }
  /* ───────────── Workflows (Entrega 12): generic engine in src/platform/workflows, Real Estate rules in ./workflows ───────────── */
  const wf = createWorkflowService({ store: deps.workflows ?? createMemoryWorkflowStore(), newId: deps.newId, now, ...(deps.activity ? { activity: deps.activity } : {}) });
  const TEAM_KEYS = REAL_ESTATE_TEAM.filter((m) => !m.soon).map((m) => m.key);
  const members = async (a: Actor): Promise<MemberInfo[]> => { try { return ports.members ? await ports.members(a, TEAM_KEYS) : (await Promise.all(TEAM_KEYS.map((k) => member(a, k)))).filter((m): m is MemberInfo => m !== null); } catch { return []; } };
  const ctxOf = async (a: Actor) => ({ tenantId: a.tenantId, userId: a.userId, ...(a.requestId ? { requestId: a.requestId } : {}), employees: Object.fromEntries((await members(a)).map((m) => [m.key, m.activityKey])) });
  type Focus = NonNullable<Facts["focus"]>;
  async function load(a: Actor): Promise<Facts> {
    const [props, owners, buyers, acts, pubs, bootstrap] = await Promise.all([all("property", a), all("owner", a), all("buyer", a), all("activity", a), all("publication", a), ports.isBootstrap ? ports.isBootstrap(a).catch(() => false) : false]);
    return { now: now(), props, owners, buyers, acts, pubs, bootstrap, matcher };
  }
  async function run(a: Actor, f: Facts, ids: readonly string[], focus?: Focus, ctx?: Awaited<ReturnType<typeof ctxOf>>) {
    const subjects = focus ? [...(focus.buyers ?? [])].map((id) => ({ kind: "buyer", id })).concat([...(focus.owners ?? [])].map((id) => ({ kind: "owner", id })), [...(focus.properties ?? [])].map((id) => ({ kind: "property", id }))) : undefined;
    return wf.apply(ctx ?? (await ctxOf(a)), SYSTEM, { workflows: ids, ...(subjects ? { subjects } : {}) }, runDefs(REAL_ESTATE_WORKFLOWS, focus ? { ...f, focus } : f, ids));
  }
  /** Workflow 4: briefs for every channel for properties that are ready and have none. Always `proposed`: nothing is published or sent. At most 5 per run. */
  async function draftReady(a: Actor, f: Facts, only?: string): Promise<number> {
    let n = 0;
    for (const p of f.props) {
      if (n >= 5) break;
      if ((only && p.id !== only) || !isReady(p, f.pubs)) continue;
      try { await prepare(a, { propertyId: p.id, channels: [...CHANNELS], locale: "es" }); n++; } catch { /* the property stays ready for the next run */ }
    }
    return n;
  }
  /** Event-driven work. It NEVER fails the business operation that triggered it. */
  async function react(a: Actor, e: { property?: PropertyRecord; buyer?: BuyerRecord; owner?: OwnerRecord; activity?: ActivityRecord }): Promise<void> {
    try {
      const f = await load(a), c = await ctxOf(a);
      if (e.property) {
        const p = e.property, aff = new Set(f.buyers.filter((b) => b.stage !== "won" && b.stage !== "lost" && matcher(b, p)).map((b) => b.id));
        for (const i of await wf.list(a.tenantId, { system: SYSTEM, workflows: ["buyer_matching"], statuses: ["open"], limit: 1000 })) if (i.evidence.some((x) => x.kind === "property" && x.id === p.id)) aff.add(i.subjectId);
        if (aff.size) await run(a, f, ["buyer_matching"], { buyers: aff }, c);
        await run(a, f, ["listing_review", "opportunity"], { properties: new Set([p.id]) }, c);
        await draftReady(a, f, p.id);
      }
      if (e.buyer) await run(a, f, ["buyer_matching", "followup", "opportunity"], { buyers: new Set([e.buyer.id]) }, c);
      if (e.owner) await run(a, f, ["followup", "opportunity"], { owners: new Set([e.owner.id]) }, c);
      if (e.activity) {
        const x = e.activity, set = (id: string | null) => new Set(id ? [id] : []);
        await run(a, f, ["followup", "opportunity"], { buyers: set(x.buyerId), owners: set(x.ownerId), properties: set(x.propertyId) }, c);
      }
    } catch { /* best effort: the next sweep catches up */ }
  }
  /** The periodic pass (everything, all subjects). Safe to call as often as wanted: it is idempotent. */
  async function sweep(a: Actor) {
    need(a, "manage"); const f = await load(a), c = await ctxOf(a), r = await run(a, f, WORKFLOW_IDS, undefined, c), drafted = await draftReady(a, f);
    await wf.markSweep(c, SYSTEM); return { ...r, drafted };
  }
  async function sweepIfStale(a: Actor, maxAgeMs = 3_600_000) {
    need(a, "manage"); const last = await wf.lastSweep(a.tenantId, SYSTEM);
    return last !== null && now() - last < maxAgeMs ? { ran: false as const } : { ran: true as const, ...(await sweep(a)) };
  }
  async function listWorkflowItems(a: Actor, q: { status?: string; kind?: string; workflow?: string; limit?: number } = {}): Promise<WorkflowItem[]> {
    need(a, "view");
    const rows = await wf.list(a.tenantId, { system: SYSTEM, ...(q.status ? { statuses: [q.status as WorkflowItem["status"]] } : { statuses: ["open"] }), ...(q.kind ? { kinds: [q.kind as WorkflowItem["kind"]] } : {}), ...(q.workflow ? { workflows: [q.workflow] } : {}), limit: q.limit ?? 200 });
    return rows.sort((x, y) => rank(x.priority) - rank(y.priority) || y.createdAt - x.createdAt);
  }
  async function decideWorkflowItem(a: Actor, id: string, input: unknown): Promise<WorkflowItem> {
    need(a, "approve"); const { approve } = parse(decisionInput, input), r = await wf.decide({ tenantId: a.tenantId, userId: a.userId, ...(a.requestId ? { requestId: a.requestId } : {}) }, SYSTEM, id, approve);
    if (r === "not_found") throw new RealEstateError("not_found", "Work item not found.");
    if (r === "invalid_state") throw new RealEstateError("invalid_state", "This item was already decided.");
    return r;
  }
  /** Property health (0–100), and a High/Medium/Low opportunity level for every buyer, owner and property. Rules only, each with its explanation. */
  async function scores(a: Actor) {
    need(a, "view"); const f = await load(a), x = ix(f), pc = new Map<string, number>();
    for (const p of f.props) if (p.ownerId) pc.set(p.ownerId, (pc.get(p.ownerId) ?? 0) + 1);
    return {
      engine: "rules" as const, ai: false,
      properties: f.props.filter((p) => p.status !== "archived").map((p) => { const s = x.signals(p), h = healthScore(p, s); return { id: p.id, title: p.title, status: p.status, health: h, opportunity: propertyOpportunity(p, s.matchingBuyers, s.doneVisits, h.score) }; }),
      buyers: f.buyers.map((b) => ({ id: b.id, name: b.name, stage: b.stage, opportunity: buyerOpportunity(b, x.matchesOfBuyer(b), x.idle("buyer", b.id, b.updatedAt)) })),
      owners: f.owners.map((o) => ({ id: o.id, name: o.name, stage: o.stage, opportunity: ownerOpportunity(o, pc.get(o.id) ?? 0, x.idle("owner", o.id, o.updatedAt), f.now) })),
      truncated: f.props.length >= CAP || f.buyers.length >= CAP,
    };
  }
  /** The team's real day, straight from the Activity Engine (nothing is composed here). */
  async function timeline(a: Actor, q: { since?: number; limit?: number } = {}) {
    need(a, "view"); const since = q.since ?? now() - DAY, rows = ports.timeline ? await ports.timeline(a, { since, limit: Math.min(100, q.limit ?? 50) }).catch(() => []) : [], by = new Map((await members(a)).map((m) => [m.activityKey, m.key]));
    return { since, events: rows.map((r) => ({ occurredAt: r.at, employee: by.get(r.employeeKey) ?? r.employeeKey, action: r.action, summary: r.summary, subjectKind: r.subjectKind, subjectId: r.subjectId })) };
  }

  /** Executive view for Mission Control (Entrega 13): CEO brief, insights, ranking, trends, forecast, weekly report, time saved. Rules over recorded data only. */
  async function executive(a: Actor) {
    need(a, "view"); const [f, items] = await Promise.all([load(a), wf.list(a.tenantId, { system: SYSTEM, statuses: ["open", "approved", "dismissed", "resolved"], limit: 1000 })]);
    const t = now(), kp = computeKpis(f.props, f.owners, f.buyers, t - 30 * DAY, t);
    const bp = ports.businessProfile ? await ports.businessProfile(a).catch(() => null) : null;
    const ig = ports.integrations ? await ports.integrations(a).catch(() => null) : null;
    return { ...buildExecutive(f, items, kp, bp, ig), summary: (await digest(a)).items };
  }
  async function overview(a: Actor) {
    need(a, "view");
    const [props, owners, buyers] = await Promise.all([store.count("property", a.tenantId), store.count("owner", a.tenantId), store.count("buyer", a.tenantId)]);
    const team = await Promise.all(REAL_ESTATE_TEAM.map(async (m) => { const info = m.soon ? null : await member(a, m.key); return { key: m.key, role: m.role, soon: Boolean(m.soon), name: info?.name ?? m.key, entitled: info?.entitled ?? false, active: info?.active ?? false }; }));
    return {
      state: props + owners + buyers === 0 ? "empty" as const : "working" as const, counts: { properties: props, owners, buyers }, team, focus: [...BOOTSTRAP_FOCUS], paidAds: false,
      integrations: INTEGRATIONS.map((id) => ({ id, status: "coming_soon" as const })), matching: { engine: "rules" as const, ai: false },
    };
  }
  return {
    listProperties, getProperty, createProperty, updateProperty, listOwners, createOwner, updateOwner, listBuyers, createBuyer, updateBuyer, matchesOfBuyer, matchesOfProperty,
    listActivities, createActivity, updateActivity, listPublications, prepare, decide, kpis, digest, overview, sweep, sweepIfStale, executive, listWorkflowItems, decideWorkflowItem, scores, timeline,
    permissions: (a: Actor) => ({ role: a.role, capabilities: (["view", "manage", "approve"] as const).filter((c) => allows(a.role, c)) }),
  };
}
