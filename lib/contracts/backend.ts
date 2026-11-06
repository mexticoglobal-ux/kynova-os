// Backend Core contracts: roles and permissions, the shapes the API returns, and strict parsers for what it accepts.
// The database enforces the same rules (supabase/migrations); lib/contracts/backend.test.ts keeps the role list in sync.

import { parseAuditAnswers } from "@/lib/audit";
import type { AuditAnswers } from "@/lib/contracts/audit";
import { parseChatState } from "@/lib/guided-chat";
import type { ChatState } from "@/lib/guided-chat";
import { isUuid } from "@/lib/contracts/tenancy";

// ---------- Roles and permissions ----------

export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = { owner: "Propietario", admin: "Administrador", member: "Miembro", viewer: "Solo lectura" };

// read: see the company's data. write: work the commercial data. admin: manage the team and decide approvals.
// owner: transfer ownership, assign admins and delete the company.
export type Permission = "read" | "write" | "admin" | "owner";

const GRANTS: Record<Permission, readonly Role[]> = {
  read: ["owner", "admin", "member", "viewer"],
  write: ["owner", "admin", "member"],
  admin: ["owner", "admin"],
  owner: ["owner"],
};

export const can = (role: Role | null | undefined, permission: Permission): boolean => role != null && GRANTS[permission].includes(role);

export const isRole = (value: unknown): value is Role => typeof value === "string" && (ROLES as readonly string[]).includes(value);

// ---------- What the API returns ----------

export type MembershipDto = { tenantId: string; name: string; slug: string | null; role: Role };
export type SessionDto = { userId: string; email: string | null; displayName: string; memberships: MembershipDto[] };

export type TeamEntry =
  | { kind: "member"; userId: string; email: string | null; name: string; role: Role; since: string }
  | { kind: "invitation"; invitationId: string; email: string; name: string; role: Exclude<Role, "owner">; since: string };

export type ClientDto = {
  id: string;
  contactId: string | null;
  organizationId: string | null;
  status: "active" | "inactive";
  since: string;
  notes: string | null;
  createdAt: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  wonAmountMinor: number;
};

export type LeadDto = {
  id: string;
  contactId: string;
  conversationId: string | null;
  status: "new" | "working" | "qualified" | "disqualified" | "converted" | "spam";
  grade: "hot" | "warm" | "cold" | "human" | null;
  points: number | null;
  priority: "high" | "medium" | "low";
  challenge: string | null;
  question: string | null;
  qualification: { reasons?: string[]; services?: string[]; topGaps?: string[]; nextStep?: string; treatment?: string };
  nextActionText: string | null;
  nextActionAt: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  createdAt: string;
  convertedOpportunityId: string | null;
  contactName: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  assessment: { id: string; score: number; band: string; infrastructure: string; answers: unknown; createdAt: string } | null;
  meetingApproved: boolean;
  approval: { id: string; kind: string; draft: { text?: string }; createdAt: string } | null;
};

export type AssessmentDto = { id: string; createdAt: string; score: number; band: string; infrastructure: string; answers: unknown; name: string; leadId: string | null };

export type ConversationDto = { id: string; kind: "contact" | "assistant"; title: string | null; status: string; mode: string; contactId: string | null; contactName: string | null; leadId: string | null; lastMessageAt: string; startedAt: string };
export type MessageDto = { id: string; createdAt: string; direction: "in" | "out" | "system"; senderKind: "contact" | "user" | "nex" | "system"; contentType: string; body: string | null; payload: unknown; deliveryStatus: string };
export type ActivityDto = { id: string; at: string; kind: string; level: 1 | 2 | 3; summary: string; reason: string | null; actor: string; actorName: string | null; outcome: string };

export type ServerDigest = {
  since: string;
  sinceVisit: { analyzed: number; prospects: number; hot: number; conversations: number; won: number };
  leads: { open: number; hot: number; needFollowUp: number; total: number };
  approvals: { pending: number; items: { id: string; kind: string; leadId: string | null; contactName: string | null; createdAt: string }[] };
  opportunities: { open: number; won: number; openAmountMinor: number; wonAmountMinor: number };
  customers: { active: number };
  conversations: { open: number; messagesToday: number };
  activity: { id: string; at: string; kind: string; level: number; summary: string; actor: string }[];
};

// ---------- What the API accepts ----------

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() !== "" && value.trim().length <= max ? value.trim() : null);
const optionalText = (value: unknown, max: number): string | null | undefined =>
  value === undefined || value === null || value === "" ? undefined : text(value, max);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

export type CompanyInput = { name: string };
export function parseCompanyInput(body: unknown): CompanyInput | null {
  if (!isRecord(body)) return null;
  const name = text(body.name, 120);
  return name ? { name } : null;
}

export type InviteInput = { tenantId: string; email: string; role: Exclude<Role, "owner"> };
export function parseInviteInput(body: unknown): InviteInput | null {
  if (!isRecord(body) || !isUuid(body.tenantId)) return null;
  const email = text(body.email, 254)?.toLowerCase();
  if (!email || !EMAIL.test(email) || !isRole(body.role) || body.role === "owner") return null;
  return { tenantId: body.tenantId, email, role: body.role };
}

export type RoleInput = { tenantId: string; role: Role };
export function parseRoleInput(body: unknown): RoleInput | null {
  return isRecord(body) && isUuid(body.tenantId) && isRole(body.role) ? { tenantId: body.tenantId, role: body.role } : null;
}

export type ClientInput = { tenantId: string; name: string; email?: string; phone?: string; company?: string; notes?: string };
export function parseClientInput(body: unknown): ClientInput | null {
  if (!isRecord(body) || !isUuid(body.tenantId)) return null;
  const name = text(body.name, 120);
  const email = optionalText(body.email, 254);
  const phone = optionalText(body.phone, 40);
  const company = optionalText(body.company, 200);
  const notes = optionalText(body.notes, 2000);
  if (!name || email === null || phone === null || company === null || notes === null) return null;
  if (email && !EMAIL.test(email)) return null;
  return { tenantId: body.tenantId, name, ...(email && { email: email.toLowerCase() }), ...(phone && { phone }), ...(company && { company }), ...(notes && { notes }) };
}

// A partial edit: only the keys present are changed. An empty string clears organization and notes.
export type ClientPatch = { tenantId: string; fields: Record<string, string> };
export function parseClientPatch(body: unknown): ClientPatch | null {
  if (!isRecord(body) || !isUuid(body.tenantId)) return null;
  const fields: Record<string, string> = {};
  for (const [key, max] of [["name", 120], ["email", 254], ["phone", 40], ["organization", 200], ["notes", 2000]] as const) {
    if (!(key in body)) continue;
    const value = body[key];
    if (typeof value !== "string" || value.trim().length > max) return null;
    if (key === "name" && value.trim() === "") return null;
    if (key === "email" && value.trim() !== "" && !EMAIL.test(value.trim())) return null;
    fields[key] = value.trim();
  }
  if ("status" in body) {
    if (body.status !== "active" && body.status !== "inactive") return null;
    fields.status = body.status;
  }
  return Object.keys(fields).length > 0 ? { tenantId: body.tenantId, fields } : null;
}

export type TranscriptEntry = { direction: "in" | "out"; senderKind: "contact" | "nex"; contentType: "text" | "choice" | "event"; body: string; payload?: Record<string, unknown> };

export type ProspectInput = { tenantId: string; state: ChatState; transcript: TranscriptEntry[] };
export function parseProspectInput(body: unknown): ProspectInput | null {
  if (!isRecord(body) || !isUuid(body.tenantId) || !Array.isArray(body.transcript) || body.transcript.length > 200) return null;
  const state = parseChatState(body.state);
  if (!state) return null;
  const transcript: TranscriptEntry[] = [];
  for (const entry of body.transcript) {
    if (!isRecord(entry)) return null;
    const direction = entry.direction;
    const senderKind = entry.senderKind;
    const contentType = entry.contentType ?? "text";
    const bodyText = typeof entry.body === "string" ? entry.body.slice(0, 4000) : null;
    if ((direction !== "in" && direction !== "out") || (senderKind !== "contact" && senderKind !== "nex")) return null;
    if (contentType !== "text" && contentType !== "choice" && contentType !== "event") return null;
    if (bodyText === null) return null;
    transcript.push({ direction, senderKind, contentType, body: bodyText });
  }
  return { tenantId: body.tenantId, state, transcript };
}

export type DecisionInput = { approve: boolean; note?: string };
export function parseDecisionInput(body: unknown): DecisionInput | null {
  if (!isRecord(body) || typeof body.approve !== "boolean") return null;
  const note = optionalText(body.note, 500);
  return note === null ? null : { approve: body.approve, ...(note && { note }) };
}

export type LeadStatusInput = { status: "working" | "qualified" | "disqualified" | "spam"; reason?: string };
export function parseLeadStatusInput(body: unknown): LeadStatusInput | null {
  if (!isRecord(body)) return null;
  const status = body.status;
  if (status !== "working" && status !== "qualified" && status !== "disqualified" && status !== "spam") return null;
  const reason = optionalText(body.reason, 300);
  if (reason === null || ((status === "disqualified" || status === "spam") && !reason)) return null;
  return { status, ...(reason && { reason }) };
}

export type WinInput = { title?: string; amountMinor?: number; currency: string };
export function parseWinInput(body: unknown): WinInput | null {
  if (body === undefined || body === null) return { currency: "USD" };
  if (!isRecord(body)) return null;
  const title = optionalText(body.title, 200);
  const currency = typeof body.currency === "string" ? body.currency.toUpperCase() : "USD";
  const amount = body.amountMinor;
  if (title === null || !/^[A-Z]{3}$/.test(currency)) return null;
  if (amount !== undefined && amount !== null && (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 0)) return null;
  return { currency, ...(title && { title }), ...(typeof amount === "number" && { amountMinor: amount }) };
}

export type MessageInput = { direction: "in" | "out"; senderKind: "user" | "nex"; body: string };
export function parseMessageInput(body: unknown): MessageInput | null {
  if (!isRecord(body)) return null;
  const direction = body.direction;
  const senderKind = body.senderKind;
  const bodyText = text(body.body, 8000);
  if ((direction !== "in" && direction !== "out") || (senderKind !== "user" && senderKind !== "nex") || !bodyText) return null;
  return { direction, senderKind, body: bodyText };
}

export type AssessmentInput = { tenantId: string; businessName?: string; answers: AuditAnswers };
export function parseAssessmentInput(body: unknown): AssessmentInput | null {
  if (!isRecord(body) || !isUuid(body.tenantId)) return null;
  const answers = parseAuditAnswers(body.answers);
  const businessName = optionalText(body.businessName, 120);
  if (!answers || businessName === null) return null;
  return { tenantId: body.tenantId, answers, ...(businessName && { businessName }) };
}

export type TenantRef = { tenantId: string };
export const parseTenantId = (value: unknown): string | null => (isUuid(value) ? value : null);
