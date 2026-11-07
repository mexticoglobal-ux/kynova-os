// CRM store: the records of a company's sales work. Pure and deterministic, one global state with every record owned by a company
// (tenant). It holds leads, their stage history, the timeline, NEX's task proposals, Business Audit results, KOE's analyses and the
// Customer 360 links. All the intelligence (scores, probability, risk, next action, reasons) is worked out by koe-crm.ts; here a
// result is only RECORDED, together with the Worker and the model KOE used, and nothing is ever sent or executed.
//
// Constitution (ADR-0009), enforced by how the events are built and tested:
// - Level 1 (NEX prepares): create a prospect, refresh KOE's analysis, propose tasks (with drafts of the email, WhatsApp or proposal).
// - Level 2 (a standing authorization): moving a stage automatically, one step forward at a time up to negotiation, only when KOE's
//   rules recommend it and a person granted a vigente authorization with its limits. Never backwards.
// - Level 3 (always a person): winning or losing a deal, converting a prospect into a customer, accepting or completing a task.
// - Nothing is ever deleted or overwritten: there is no event for it. Stages, interactions, audits and analyses only get appended, and
//   a change to a prospect's data keeps the old values in the audit trail.

import { isPerson, isWorker } from "./actors";
import { DEFAULT_KOE_ENV, failed, planExecution, type KoeEnv } from "./automation-koe";
import { auditFit, auditModules, isAuditAnswers } from "./crm-audit";
import { message, type ErrorCode } from "./crm-messages";
import { OPEN_STAGES, advanceCheck, analyzeLead, contextOf, proposalsFor, type Insight, type RiskLevel } from "./koe-crm";
import type { Priority } from "./koe-registry";
import { decide, type Authorization } from "./workers";
import type { AssessmentAnswers } from "../assessment";

export { DEFAULT_KOE_ENV, type KoeEnv } from "./automation-koe";

export type Stage = "prospect" | "qualified" | "meeting" | "proposal" | "negotiation" | "won" | "lost";
export type TaskKind = "call" | "email" | "whatsapp" | "meeting" | "proposal" | "followup";
export const TASK_KINDS: readonly TaskKind[] = ["call", "email", "whatsapp", "meeting", "proposal", "followup"];
export type TimelineKind = "email" | "whatsapp" | "call" | "note" | "meeting" | "automation" | "worker" | "audit" | "nex";
export const PERSON_KINDS = ["email", "whatsapp", "call", "note", "meeting"] as const;
export const LINK_KINDS = ["product", "academy", "marketplace", "automation", "worker", "payment", "referral"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const STAGE_AUTH_ACTION = "crm.stage.auto";

export type StageChange = { from?: Stage; to: Stage; at: string; by: string; mode: "person" | "auto"; note?: string };
export type Lead = {
  id: string; tenantId: string; name: string; company: string; email?: string; phone?: string; source: string; estimatedValueMicros: number; fit: number;
  owner: string; stage: Stage; stageSince: string; stageHistory: readonly StageChange[]; createdBy: string; createdAt: string; updatedAt: string;
};
export type Subject = { kind: "lead" | "customer"; id: string };
export type TimelineEntry = { id: string; tenantId: string; subject: Subject; at: string; kind: TimelineKind; direction?: "in" | "out"; summary: string; actor: string; ref?: string };
export type Task = {
  id: string; tenantId: string; leadId: string; kind: TaskKind; title: string; reason: string; draft: string; dueAt: string;
  status: "proposed" | "accepted" | "done" | "dismissed"; proposedBy: string; proposedAt: string; decidedBy?: string; decidedAt?: string;
};
export type Meeting = { id: string; tenantId: string; leadId: string; at: string; title: string; scheduledBy: string };
export type AuditResult = { id: string; tenantId: string; leadId: string; at: string; answers: AssessmentAnswers; recommended: readonly string[]; fitScore: number };
// What KOE concluded at a moment, with the Worker and the model it used. Appended every time; an earlier one is never rewritten.
export type Analysis = {
  id: string; tenantId: string; leadId: string; at: string; trigger: "audit" | "refresh" | "stage" | "interaction";
  leadScore: number; opportunityScore: number; previousOpportunityScore?: number; probability: number; risk: RiskLevel; expectedValueMicros: number; expectedDays: number;
  nextBest: Insight["nextBest"]; priority: Priority; workerId: string; workerName: string; model: { id: string; label: string }; modelReason: string; estimatedCostMicros: number;
};
export type Contact = { id: string; name: string; role: string; email?: string; phone?: string };
export type Customer = { id: string; tenantId: string; leadId: string; company: string; contacts: readonly Contact[]; since: string; convertedBy: string };
// Customer 360 links come from the other modules through KOE (the platform): a product bought, a course, a payment total, a referral…
export type CustomerLink = { id: string; tenantId: string; customerId: string; kind: LinkKind; ref: string; label: string; at: string; amountMicros?: number };
export type Grant = { id: string; tenantId: string; action: typeof STAGE_AUTH_ACTION; status: "active" | "revoked"; maxPerDay?: number; expiresAt?: string; grantedBy: string; grantedAt: string };
export type CrmAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type CrmLog = { at: string; level: "info" | "warn"; event: string };

export type CrmState = {
  leads: readonly Lead[]; customers: readonly Customer[]; timeline: readonly TimelineEntry[]; tasks: readonly Task[]; meetings: readonly Meeting[];
  audits: readonly AuditResult[]; analyses: readonly Analysis[]; links: readonly CustomerLink[]; grants: readonly Grant[];
  audit: readonly CrmAudit[]; logs: readonly CrmLog[]; sequence: number;
};
export const newCrmState = (): CrmState => ({ leads: [], customers: [], timeline: [], tasks: [], meetings: [], audits: [], analyses: [], links: [], grants: [], audit: [], logs: [], sequence: 0 });

export type LeadInput = { name: string; company: string; email?: string; phone?: string; source: string; estimatedValueMicros: number; fit: number; owner?: string };
type Base = { at: string; tenantId: string; actor: string };
export type CrmEvent =
  | (Base & { type: "lead.create"; input: LeadInput })
  | (Base & { type: "lead.update"; leadId: string; patch: Partial<Omit<LeadInput, "owner">> & { owner?: string } })
  | (Base & { type: "interaction.record"; subject: Subject; kind: (typeof PERSON_KINDS)[number]; direction?: "in" | "out"; summary: string })
  | (Base & { type: "timeline.record"; subject: Subject; kind: "automation" | "worker"; summary: string; ref?: string })
  | (Base & { type: "audit.record"; leadId: string; answers: AssessmentAnswers })
  | (Base & { type: "analysis.refresh"; leadId: string })
  | (Base & { type: "task.generate"; leadId: string })
  | (Base & { type: "task.propose"; leadId: string; kind: TaskKind; title: string; draft?: string; reason?: string; dueInDays?: number })
  | (Base & { type: "task.accept"; taskId: string })
  | (Base & { type: "task.complete"; taskId: string; note?: string })
  | (Base & { type: "task.dismiss"; taskId: string })
  | (Base & { type: "stage.move"; leadId: string; to: Stage; note?: string })
  | (Base & { type: "meeting.schedule"; leadId: string; scheduledFor: string; title: string })
  | (Base & { type: "customer.convert"; leadId: string })
  | (Base & { type: "contact.add"; customerId: string; name: string; role: string; email?: string; phone?: string })
  | (Base & { type: "customer.link"; customerId: string; kind: LinkKind; ref: string; label: string; amountMicros?: number })
  | (Base & { type: "authorization.grant"; maxPerDay?: number; expiresAt?: string })
  | (Base & { type: "authorization.revoke"; grantId: string });
export type CrmResult = { state: CrmState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed or deleted: every list only grows. Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: CrmState, prefix: string): { id: string; state: CrmState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(5, "0")}`, state: { ...state, sequence } };
};
const note = (state: CrmState, event: { at: string; actor: string; tenantId: string }, action: string, detail?: string, level: CrmLog["level"] = "info"): CrmState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, detail }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?\d{7,15}$/;
const sameDay = (a: string, b: string) => a.slice(0, 10) === b.slice(0, 10);
const ORDER: readonly Stage[] = ["prospect", "qualified", "meeting", "proposal", "negotiation"];
const SALES_NEED = { tools: ["lead.score", "message.draft"], clearance: "personal" as const }; // a prospect's contact data is personal

export function validateLead(input: LeadInput): string[] {
  const issues: string[] = [];
  if (input.name.trim() === "" || input.name.length > 80) issues.push("nombre (1 a 80 caracteres)");
  if (input.company.length > 80) issues.push("empresa (hasta 80 caracteres)");
  if (input.email !== undefined && input.email !== "" && !EMAIL.test(input.email)) issues.push("correo");
  if (input.phone !== undefined && input.phone !== "" && !PHONE.test(input.phone.replace(/[\s-]/g, ""))) issues.push("teléfono");
  if (input.source.trim() === "" || input.source.length > 40) issues.push("origen (1 a 40 caracteres)");
  if (!Number.isFinite(input.estimatedValueMicros) || input.estimatedValueMicros < 0 || input.estimatedValueMicros > 1e12) issues.push("valor estimado");
  if (!Number.isInteger(input.fit) || input.fit < 0 || input.fit > 100) issues.push("ajuste de 0 a 100");
  return issues;
}

// ---------------------------------------------------------------- the reducer
export function reduceCrm(state: CrmState, event: CrmEvent, env: KoeEnv = DEFAULT_KOE_ENV): CrmResult {
  const person = isPerson(event.actor);
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): CrmResult => ({ state, error: message(code, params), errorCode: code });
  const needPerson = (): CrmResult | null => (person ? null : refuse("personRequired"));
  const needDrafter = (): CrmResult | null => (person || isWorker(event.actor) ? null : refuse("personRequired"));
  const needSystem = (): CrmResult | null => (event.actor === "system" ? null : refuse("systemOnly"));
  const findLead = (id: string): { lead?: Lead; failure?: CrmResult } => {
    const lead = state.leads.find((item) => item.id === id);
    if (!lead) return { failure: refuse("notFound") };
    if (lead.tenantId !== event.tenantId) return { failure: refuse("notYours") };
    return { lead };
  };
  const timelineEntry = (st: CrmState, subject: Subject, kind: TimelineKind, summary: string, actor: string, extra: Partial<TimelineEntry> = {}): CrmState => {
    const made = nextId(st, "tl");
    return { ...made.state, timeline: append(made.state.timeline, { id: made.id, tenantId: event.tenantId, subject, at: event.at, kind, summary: summary.slice(0, 300), actor, ...extra }) };
  };
  /** KOE analyses a lead: the numbers come from koe-crm.ts, and the Worker and the model KOE chose are recorded with them. */
  const analyse = (st: CrmState, lead: Lead, trigger: Analysis["trigger"]): { state: CrmState } | { problem: string } => {
    const plan = planExecution(env, event.tenantId, "sales", SALES_NEED);
    if (failed(plan)) return { problem: plan.problem };
    const insight = analyzeLead(contextOf(st, lead), event.at);
    const before = st.analyses.filter((item) => item.leadId === lead.id && item.tenantId === event.tenantId).at(-1);
    const made = nextId(st, "an");
    const analysis: Analysis = {
      id: made.id, tenantId: event.tenantId, leadId: lead.id, at: event.at, trigger, leadScore: insight.leadScore, opportunityScore: insight.opportunityScore, previousOpportunityScore: before?.opportunityScore,
      probability: insight.probability, risk: insight.risk, expectedValueMicros: insight.expectedValueMicros, expectedDays: insight.expectedDays, nextBest: insight.nextBest, priority: insight.priority,
      workerId: plan.worker.id, workerName: plan.worker.name, model: { id: plan.model.id, label: plan.model.label }, modelReason: plan.modelReason, estimatedCostMicros: plan.estimatedCostMicros,
    };
    const delta = before ? ` (${analysis.opportunityScore - before.opportunityScore >= 0 ? "+" : ""}${analysis.opportunityScore - before.opportunityScore})` : "";
    const withAnalysis = { ...made.state, analyses: append(made.state.analyses, analysis) };
    return { state: timelineEntry(withAnalysis, { kind: "lead", id: lead.id }, "nex", `KOE actualizó el análisis: puntaje de oportunidad ${analysis.opportunityScore}${delta}, riesgo ${analysis.risk}`, `worker:${plan.worker.id}`) };
  };
  const afterChange = (st: CrmState, leadId: string, trigger: Analysis["trigger"]): CrmState => {
    const lead = st.leads.find((item) => item.id === leadId);
    if (!lead) return st;
    const result = analyse(st, lead, trigger);
    return "state" in result ? result.state : note(st, event, "analysis.pending", `${leadId} · ${result.problem}`, "warn"); // best effort: the change is kept even if KOE has no Worker right now
  };
  const autoAllowed = (st: CrmState): boolean => {
    const grant = st.grants.find((item) => item.tenantId === event.tenantId && item.status === "active" && (!item.expiresAt || Date.parse(item.expiresAt) > Date.parse(event.at)));
    if (!grant) return false;
    const usedToday = st.audit.filter((entry) => entry.tenantId === event.tenantId && entry.action === "stage.auto" && sameDay(entry.at, event.at)).length;
    const authorization: Authorization = { action: STAGE_AUTH_ACTION, status: "active", maxPerDay: grant.maxPerDay, usedToday, expiresAt: grant.expiresAt };
    return decide(STAGE_AUTH_ACTION, authorization, new Date(event.at)).allowed;
  };

  switch (event.type) {
    case "lead.create": {
      const denied = needDrafter();
      if (denied) return denied;
      const issues = validateLead(event.input);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const made = nextId(state, "ld");
      const lead: Lead = {
        id: made.id, tenantId: event.tenantId, name: event.input.name.trim(), company: event.input.company.trim(), email: event.input.email || undefined, phone: event.input.phone ? event.input.phone.replace(/[\s-]/g, "") : undefined,
        source: event.input.source.trim(), estimatedValueMicros: event.input.estimatedValueMicros, fit: event.input.fit, owner: event.input.owner ?? (person ? event.actor : ""), stage: "prospect", stageSince: event.at,
        stageHistory: [{ to: "prospect", at: event.at, by: event.actor, mode: "person" }], createdBy: event.actor, createdAt: event.at, updatedAt: event.at,
      };
      return { state: note({ ...made.state, leads: append(made.state.leads, lead) }, event, "lead.create", `${lead.id} · ${lead.name}`) };
    }

    case "lead.update": {
      const denied = needPerson();
      if (denied) return denied;
      const { lead, failure } = findLead(event.leadId);
      if (!lead) return failure as CrmResult;
      const merged: LeadInput = { name: lead.name, company: lead.company, email: lead.email, phone: lead.phone, source: lead.source, estimatedValueMicros: lead.estimatedValueMicros, fit: lead.fit, owner: lead.owner, ...event.patch };
      const issues = validateLead(merged);
      if (issues.length) return refuse("invalid", { detail: issues[0] });
      const updated: Lead = { ...lead, name: merged.name.trim(), company: merged.company.trim(), email: merged.email || undefined, phone: merged.phone ? merged.phone.replace(/[\s-]/g, "") : undefined, source: merged.source.trim(), estimatedValueMicros: merged.estimatedValueMicros, fit: merged.fit, owner: merged.owner ?? lead.owner, updatedAt: event.at };
      const changed = (Object.keys(event.patch) as (keyof typeof event.patch)[]).filter((key) => event.patch[key] !== undefined && String((lead as Record<string, unknown>)[key]) !== String(event.patch[key]));
      // the earlier values are kept in the audit trail: a change never erases what was there
      const detail = `${lead.id} · ${changed.map((key) => `${key}: ${String((lead as Record<string, unknown>)[key])} → ${String(event.patch[key])}`).join("; ") || "sin cambios"}`;
      return { state: note({ ...state, leads: replace(state.leads, updated) }, event, "lead.update", detail) };
    }

    case "interaction.record": {
      const denied = needPerson(); // what happened with a person is recorded by a person
      if (denied) return denied;
      if (event.summary.trim() === "" || event.summary.length > 300) return refuse("invalid", { detail: "el resumen (1 a 300 caracteres)" });
      let leadId: string | undefined;
      if (event.subject.kind === "lead") { const found = findLead(event.subject.id); if (!found.lead) return found.failure as CrmResult; leadId = found.lead.id; }
      else { const customer = state.customers.find((item) => item.id === event.subject.id); if (!customer) return refuse("notFound"); if (customer.tenantId !== event.tenantId) return refuse("notYours"); }
      const withEntry = timelineEntry(state, event.subject, event.kind, event.summary.trim(), event.actor, event.direction ? { direction: event.direction } : {});
      const next = note(withEntry, event, "interaction.record", `${event.subject.id} · ${event.kind}`);
      return { state: leadId ? afterChange(next, leadId, "interaction") : next };
    }

    case "timeline.record": {
      const denied = needSystem(); // automations and Workers report what they did through the platform
      if (denied) return denied;
      if (event.summary.trim() === "" || event.summary.length > 300) return refuse("invalid", { detail: "el resumen" });
      const known = event.subject.kind === "lead" ? state.leads.find((item) => item.id === event.subject.id) : state.customers.find((item) => item.id === event.subject.id);
      if (!known) return refuse("notFound");
      if (known.tenantId !== event.tenantId) return refuse("notYours");
      return { state: timelineEntry(state, event.subject, event.kind, event.summary.trim(), "system", event.ref ? { ref: event.ref } : {}) };
    }

    case "audit.record": {
      const denied = needSystem(); // the Business Audit reports its result; nobody types it in
      if (denied) return denied;
      const { lead, failure } = findLead(event.leadId);
      if (!lead) return failure as CrmResult;
      if (!isAuditAnswers(event.answers)) return refuse("invalid", { detail: "las respuestas del Business Audit" });
      const made = nextId(state, "ba");
      const result: AuditResult = { id: made.id, tenantId: event.tenantId, leadId: lead.id, at: event.at, answers: event.answers, recommended: auditModules(event.answers), fitScore: auditFit(event.answers) };
      // a new audit is appended; the earlier ones stay, and the analysis, recommendations, priority and risk are refreshed from it
      let next: CrmState = timelineEntry({ ...made.state, audits: append(made.state.audits, result) }, { kind: "lead", id: lead.id }, "audit", `Business Audit: ajuste ${result.fitScore}/100; recomienda ${result.recommended.join(", ")}`, "system", { ref: made.id });
      const analysed = analyse(next, lead, "audit");
      if (!("state" in analysed)) return refuse("noWorker", { detail: analysed.problem });
      next = analysed.state;
      return { state: note(next, event, "audit.record", `${lead.id} · ajuste ${result.fitScore}`) };
    }

    case "analysis.refresh": {
      const denied = needDrafter();
      if (denied) return denied;
      const { lead, failure } = findLead(event.leadId);
      if (!lead) return failure as CrmResult;
      const analysed = analyse(state, lead, "refresh");
      if (!("state" in analysed)) return refuse("noWorker", { detail: analysed.problem });
      return { state: note(analysed.state, event, "analysis.refresh", lead.id) };
    }

    case "task.generate": {
      const denied = needDrafter();
      if (denied) return denied;
      const { lead, failure } = findLead(event.leadId);
      if (!lead) return failure as CrmResult;
      if (!(OPEN_STAGES as readonly string[]).includes(lead.stage)) return refuse("closedDeal");
      const context = contextOf(state, lead);
      const proposals = proposalsFor(context, analyzeLead(context, event.at));
      let next = state;
      for (const proposal of proposals) {
        const made = nextId(next, "tk");
        const task: Task = { id: made.id, tenantId: event.tenantId, leadId: lead.id, kind: proposal.kind, title: proposal.title, reason: proposal.reason, draft: proposal.draft, dueAt: new Date(Date.parse(event.at) + proposal.dueInDays * 86_400_000).toISOString(), status: "proposed", proposedBy: event.actor, proposedAt: event.at };
        next = { ...made.state, tasks: append(made.state.tasks, task) };
      }
      if (proposals.length) next = timelineEntry(next, { kind: "lead", id: lead.id }, "nex", `NEX propuso ${proposals.length} tarea(s): ${proposals.map((item) => item.kind).join(", ")}. Son propuestas: nada se ejecutó.`, event.actor);
      return { state: note(next, event, "task.generate", `${lead.id} · ${proposals.length} propuestas`) };
    }

    case "task.propose": {
      const denied = needDrafter();
      if (denied) return denied;
      const { lead, failure } = findLead(event.leadId);
      if (!lead) return failure as CrmResult;
      if (!TASK_KINDS.includes(event.kind)) return refuse("invalid", { detail: "tipo de tarea" });
      if (event.title.trim() === "" || event.title.length > 120) return refuse("invalid", { detail: "el título (1 a 120 caracteres)" });
      if ((event.draft ?? "").length > 2_000) return refuse("invalid", { detail: "el borrador (hasta 2000 caracteres)" });
      const made = nextId(state, "tk");
      const task: Task = { id: made.id, tenantId: event.tenantId, leadId: lead.id, kind: event.kind, title: event.title.trim(), reason: (event.reason ?? "").slice(0, 200), draft: event.draft ?? "", dueAt: new Date(Date.parse(event.at) + (event.dueInDays ?? 1) * 86_400_000).toISOString(), status: "proposed", proposedBy: event.actor, proposedAt: event.at };
      return { state: note({ ...made.state, tasks: append(made.state.tasks, task) }, event, "task.propose", `${made.id} · ${event.kind}`) };
    }

    case "task.accept":
    case "task.complete":
    case "task.dismiss": {
      const denied = needPerson(); // a person decides what is done; NEX never executes anything
      if (denied) return denied;
      const task = state.tasks.find((item) => item.id === event.taskId);
      if (!task) return refuse("notFound");
      if (task.tenantId !== event.tenantId) return refuse("notYours");
      const allowedFrom = event.type === "task.accept" ? ["proposed"] : event.type === "task.complete" ? ["accepted", "proposed"] : ["proposed", "accepted"];
      if (!allowedFrom.includes(task.status)) return refuse("taskClosed");
      const status: Task["status"] = event.type === "task.accept" ? "accepted" : event.type === "task.complete" ? "done" : "dismissed";
      let next = note({ ...state, tasks: replace(state.tasks, { ...task, status, decidedBy: event.actor, decidedAt: event.at }) }, event, event.type, `${task.id} · ${task.kind}`);
      if (event.type === "task.complete") next = timelineEntry(next, { kind: "lead", id: task.leadId }, "note", `${task.title} (hecha por ${event.actor})${event.note ? `: ${event.note.slice(0, 200)}` : ""}`, event.actor);
      return { state: next };
    }

    case "stage.move": {
      const denied = needDrafter();
      if (denied) return denied;
      const { lead, failure } = findLead(event.leadId);
      if (!lead) return failure as CrmResult;
      const closing = event.to === "won" || event.to === "lost";
      if (lead.stage === "won") return refuse("closedDeal");
      if (event.to === lead.stage) return refuse("invalidMove", { from: lead.stage, to: event.to });
      const reopen = lead.stage === "lost" && !closing;
      if (!person) {
        // Level 2: one step forward, up to negotiation, only inside a standing authorization and only when KOE's rules agree
        const from = ORDER.indexOf(lead.stage);
        const to = ORDER.indexOf(event.to);
        if (closing || from < 0 || to !== from + 1) return refuse("personRequired");
        if (!autoAllowed(state)) return refuse("needsAuthorization");
        const check = advanceCheck(analyzeLead(contextOf(state, lead), event.at), lead.stage);
        if (!check.ok) return refuse("notEligible", { detail: check.reason });
      } else {
        if (lead.stage === "lost" && closing) return refuse("invalidMove", { from: lead.stage, to: event.to });
        if (event.to === "lost" && (event.note ?? "").trim() === "") return refuse("invalid", { detail: "el motivo de la pérdida" });
        if (!closing && !reopen && ORDER.indexOf(event.to) < 0) return refuse("invalidMove", { from: lead.stage, to: event.to });
      }
      const mode: StageChange["mode"] = person ? "person" : "auto";
      const moved: Lead = { ...lead, stage: event.to, stageSince: event.at, updatedAt: event.at, stageHistory: append(lead.stageHistory, { from: lead.stage, to: event.to, at: event.at, by: event.actor, mode, note: event.note?.slice(0, 200) }) };
      let next = note({ ...state, leads: replace(state.leads, moved) }, event, mode === "auto" ? "stage.auto" : closing ? "stage.close" : "stage.move", `${lead.id} · ${lead.stage} → ${event.to}`, closing ? "warn" : "info");
      next = timelineEntry(next, { kind: "lead", id: lead.id }, "nex", mode === "auto" ? `NEX movió la etapa de «${lead.stage}» a «${event.to}» con autorización vigente.` : `${event.actor} movió la etapa de «${lead.stage}» a «${event.to}»${event.note ? `: ${event.note.slice(0, 200)}` : ""}.`, mode === "auto" ? event.actor : event.actor);
      return { state: afterChange(next, lead.id, "stage") };
    }

    case "meeting.schedule": {
      const denied = needPerson();
      if (denied) return denied;
      const { lead, failure } = findLead(event.leadId);
      if (!lead) return failure as CrmResult;
      if (Number.isNaN(Date.parse(event.scheduledFor)) || event.title.trim() === "" || event.title.length > 120) return refuse("invalid", { detail: "la reunión (fecha y título)" });
      const made = nextId(state, "mt");
      const next = timelineEntry({ ...made.state, meetings: append(made.state.meetings, { id: made.id, tenantId: event.tenantId, leadId: lead.id, at: event.scheduledFor, title: event.title.trim(), scheduledBy: event.actor }) }, { kind: "lead", id: lead.id }, "meeting", `Reunión agendada: ${event.title.trim()} (${event.scheduledFor.slice(0, 16).replace("T", " ")})`, event.actor);
      return { state: note(next, event, "meeting.schedule", `${made.id} · ${lead.id}`) };
    }

    case "customer.convert": {
      const denied = needPerson(); // converting a prospect into a customer is Level 3
      if (denied) return denied;
      const { lead, failure } = findLead(event.leadId);
      if (!lead) return failure as CrmResult;
      if (lead.stage !== "won") return refuse("notWon");
      if (state.customers.some((item) => item.leadId === lead.id)) return refuse("alreadyConverted");
      const made = nextId(state, "cu");
      const contact: Contact = { id: "c1", name: lead.name, role: "Contacto principal", email: lead.email, phone: lead.phone };
      const customer: Customer = { id: made.id, tenantId: event.tenantId, leadId: lead.id, company: lead.company || lead.name, contacts: [contact], since: event.at, convertedBy: event.actor };
      const next = timelineEntry({ ...made.state, customers: append(made.state.customers, customer) }, { kind: "lead", id: lead.id }, "note", `${event.actor} convirtió el prospecto en cliente (${customer.id}).`, event.actor);
      return { state: note(next, event, "customer.convert", `${lead.id} → ${customer.id}`, "warn") };
    }

    case "contact.add": {
      const denied = needPerson();
      if (denied) return denied;
      const customer = state.customers.find((item) => item.id === event.customerId);
      if (!customer) return refuse("notFound");
      if (customer.tenantId !== event.tenantId) return refuse("notYours");
      const issues = validateLead({ name: event.name, company: "", email: event.email, phone: event.phone, source: "contacto", estimatedValueMicros: 0, fit: 0 });
      if (issues.length || event.role.trim() === "" || event.role.length > 60) return refuse("invalid", { detail: issues[0] ?? "el cargo" });
      const contact: Contact = { id: `c${customer.contacts.length + 1}`, name: event.name.trim(), role: event.role.trim(), email: event.email || undefined, phone: event.phone ? event.phone.replace(/[\s-]/g, "") : undefined };
      return { state: note({ ...state, customers: replace(state.customers, { ...customer, contacts: append(customer.contacts, contact) }) }, event, "contact.add", `${customer.id} · ${contact.name}`) };
    }

    case "customer.link": {
      const denied = needSystem(); // the other modules report their part of a customer through KOE
      if (denied) return denied;
      const customer = state.customers.find((item) => item.id === event.customerId);
      if (!customer) return refuse("notFound");
      if (customer.tenantId !== event.tenantId) return refuse("notYours");
      if (!LINK_KINDS.includes(event.kind) || event.ref.trim() === "" || event.label.trim() === "" || event.label.length > 100) return refuse("invalid", { detail: "el vínculo" });
      if (event.amountMicros !== undefined && (!Number.isFinite(event.amountMicros) || event.amountMicros < 0 || event.kind !== "payment")) return refuse("invalid", { detail: "el monto (solo un total de pago, nunca datos bancarios)" });
      const made = nextId(state, "ln");
      const link: CustomerLink = { id: made.id, tenantId: event.tenantId, customerId: customer.id, kind: event.kind, ref: event.ref.trim(), label: event.label.trim(), at: event.at, ...(event.amountMicros !== undefined ? { amountMicros: event.amountMicros } : {}) };
      return { state: { ...made.state, links: append(made.state.links, link) } };
    }

    case "authorization.grant": {
      const denied = needPerson();
      if (denied) return denied;
      if (event.maxPerDay !== undefined && (!Number.isInteger(event.maxPerDay) || event.maxPerDay < 1 || event.maxPerDay > 100)) return refuse("invalid", { detail: "usos por día de 1 a 100" });
      if (event.expiresAt !== undefined && !(Date.parse(event.expiresAt) > Date.parse(event.at))) return refuse("invalid", { detail: "la fecha de vencimiento debe ser futura" });
      const made = nextId(state, "gr");
      const grant: Grant = { id: made.id, tenantId: event.tenantId, action: STAGE_AUTH_ACTION, status: "active", maxPerDay: event.maxPerDay, expiresAt: event.expiresAt, grantedBy: event.actor, grantedAt: event.at };
      return { state: note({ ...made.state, grants: append(made.state.grants, grant) }, event, "authorization.grant", `${made.id} · ${STAGE_AUTH_ACTION}`) };
    }

    case "authorization.revoke": {
      const denied = needPerson();
      if (denied) return denied;
      const grant = state.grants.find((item) => item.id === event.grantId);
      if (!grant) return refuse("notFound");
      if (grant.tenantId !== event.tenantId) return refuse("notYours");
      return { state: note({ ...state, grants: replace(state.grants, { ...grant, status: "revoked" }) }, event, "authorization.revoke", grant.id, "warn") };
    }
  }
}

export function applyAllCrm(state: CrmState, events: readonly CrmEvent[], env: KoeEnv = DEFAULT_KOE_ENV): { state: CrmState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceCrm(current, event, env);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

export const leadsOf = (state: CrmState, tenantId: string) => state.leads.filter((item) => item.tenantId === tenantId);
export const customersOf = (state: CrmState, tenantId: string) => state.customers.filter((item) => item.tenantId === tenantId);
export const tasksOf = (state: CrmState, tenantId: string) => state.tasks.filter((item) => item.tenantId === tenantId);
export const analysesOf = (state: CrmState, tenantId: string, leadId?: string) => state.analyses.filter((item) => item.tenantId === tenantId && (!leadId || item.leadId === leadId));
export const grantsOf = (state: CrmState, tenantId: string) => state.grants.filter((item) => item.tenantId === tenantId);
export const latestAnalysis = (state: CrmState, tenantId: string, leadId: string): Analysis | undefined => analysesOf(state, tenantId, leadId).at(-1);
