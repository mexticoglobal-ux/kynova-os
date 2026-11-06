import { describe, expect, it } from "vitest";
import { initialState } from "@/lib/guided-chat";
import {
  ROLES,
  can,
  parseAssessmentInput,
  parseClientInput,
  parseClientPatch,
  parseCompanyInput,
  parseDecisionInput,
  parseInviteInput,
  parseLeadStatusInput,
  parseMessageInput,
  parseProspectInput,
  parseRoleInput,
  parseWinInput,
} from "./backend";

const T = "00000000-0000-4000-8000-0000000000b1";

describe("roles and permissions", () => {
  it("grants each permission to exactly the roles the database allows", () => {
    expect(ROLES.filter((role) => can(role, "read"))).toEqual(["owner", "admin", "member", "viewer"]);
    expect(ROLES.filter((role) => can(role, "write"))).toEqual(["owner", "admin", "member"]);
    expect(ROLES.filter((role) => can(role, "admin"))).toEqual(["owner", "admin"]);
    expect(ROLES.filter((role) => can(role, "owner"))).toEqual(["owner"]);
  });

  it("denies everything without a role", () => {
    expect(can(null, "read")).toBe(false);
    expect(can(undefined, "write")).toBe(false);
  });
});

describe("input parsers", () => {
  it("accepts a company name and rejects empty or oversized ones", () => {
    expect(parseCompanyInput({ name: "  Nova  " })).toEqual({ name: "Nova" });
    expect(parseCompanyInput({ name: " " })).toBeNull();
    expect(parseCompanyInput({ name: "x".repeat(121) })).toBeNull();
    expect(parseCompanyInput(null)).toBeNull();
  });

  it("invites with a valid email and a role that is not owner", () => {
    expect(parseInviteInput({ tenantId: T, email: "Ana@Example.com", role: "member" })).toEqual({ tenantId: T, email: "ana@example.com", role: "member" });
    expect(parseInviteInput({ tenantId: T, email: "ana@example.com", role: "owner" })).toBeNull();
    expect(parseInviteInput({ tenantId: T, email: "not-an-email", role: "member" })).toBeNull();
    expect(parseInviteInput({ tenantId: "x", email: "ana@example.com", role: "member" })).toBeNull();
  });

  it("changes a role only to a known one", () => {
    expect(parseRoleInput({ tenantId: T, role: "viewer" })).toEqual({ tenantId: T, role: "viewer" });
    expect(parseRoleInput({ tenantId: T, role: "root" })).toBeNull();
  });

  it("parses clients and drops empty optional fields", () => {
    expect(parseClientInput({ tenantId: T, name: "Marta", email: "M@x.co", phone: "", company: "Clínica" })).toEqual({ tenantId: T, name: "Marta", email: "m@x.co", company: "Clínica" });
    expect(parseClientInput({ tenantId: T, name: "" })).toBeNull();
    expect(parseClientInput({ tenantId: T, name: "Marta", email: "bad" })).toBeNull();
  });

  it("parses a client patch: only the keys present, strict values", () => {
    expect(parseClientPatch({ tenantId: T, status: "inactive" })).toEqual({ tenantId: T, fields: { status: "inactive" } });
    expect(parseClientPatch({ tenantId: T, notes: "" })).toEqual({ tenantId: T, fields: { notes: "" } });
    expect(parseClientPatch({ tenantId: T })).toBeNull();
    expect(parseClientPatch({ tenantId: T, name: "" })).toBeNull();
    expect(parseClientPatch({ tenantId: T, status: "weird" })).toBeNull();
    expect(parseClientPatch({ tenantId: T, email: "nope" })).toBeNull();
  });

  it("parses decisions, lead statuses and wins", () => {
    expect(parseDecisionInput({ approve: true, note: "ok" })).toEqual({ approve: true, note: "ok" });
    expect(parseDecisionInput({ approve: "yes" })).toBeNull();
    expect(parseLeadStatusInput({ status: "working" })).toEqual({ status: "working" });
    expect(parseLeadStatusInput({ status: "spam" })).toBeNull(); // a reason is required
    expect(parseLeadStatusInput({ status: "spam", reason: "enlaces" })).toEqual({ status: "spam", reason: "enlaces" });
    expect(parseWinInput(undefined)).toEqual({ currency: "USD" });
    expect(parseWinInput({ title: "Plan", amountMinor: 1000, currency: "crc" })).toEqual({ title: "Plan", amountMinor: 1000, currency: "CRC" });
    expect(parseWinInput({ amountMinor: -1 })).toBeNull();
    expect(parseWinInput({ amountMinor: 1.5 })).toBeNull();
    expect(parseWinInput({ currency: "dollars" })).toBeNull();
  });

  it("parses messages for the assistant thread", () => {
    expect(parseMessageInput({ direction: "in", senderKind: "user", body: "hola" })).toEqual({ direction: "in", senderKind: "user", body: "hola" });
    expect(parseMessageInput({ direction: "in", senderKind: "contact", body: "hola" })).toBeNull();
    expect(parseMessageInput({ direction: "in", senderKind: "user", body: "" })).toBeNull();
  });

  it("parses an assessment only with a complete set of closed answers", () => {
    const answers = { web: "none", social: "none", capture: "none", followUp: "none", automation: "none", analytics: "none", advertising: "none", ai: "none" };
    expect(parseAssessmentInput({ tenantId: T, businessName: "Café", answers })?.answers.web).toBe("none");
    expect(parseAssessmentInput({ tenantId: T, answers: { web: "none" } })).toBeNull();
    expect(parseAssessmentInput({ tenantId: T, answers: { ...answers, ai: "expert" } })).toBeNull();
  });

  it("parses a prospect conversation: a valid state and a bounded transcript", () => {
    const body = { tenantId: T, state: initialState("usted"), transcript: [{ direction: "out", senderKind: "nex", body: "Hola" }] };
    expect(parseProspectInput(body)?.transcript).toHaveLength(1);
    expect(parseProspectInput({ ...body, state: { ...initialState("usted"), step: "hack" } })).toBeNull();
    expect(parseProspectInput({ ...body, state: { ...initialState("usted"), answers: { web: "expert" } } })).toBeNull();
    expect(parseProspectInput({ ...body, transcript: [{ direction: "sideways", senderKind: "nex", body: "x" }] })).toBeNull();
    expect(parseProspectInput({ ...body, transcript: new Array(201).fill(body.transcript[0]) })).toBeNull();
  });
});
