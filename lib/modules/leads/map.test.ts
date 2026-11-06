import { describe, expect, it } from "vitest";
import { NOVA_DRAFT_PACK as pack } from "@/lib/audit-packs/nova-draft";
import type { LeadDto, ServerDigest } from "@/lib/contracts/backend";
import { digestFromServer, leadFromDto } from "./map";

const answers = { web: "none", social: "none", capture: "none", followUp: "none", automation: "none", analytics: "none", advertising: "none", ai: "none" };

const dto = (over: Partial<LeadDto> = {}): LeadDto => ({
  id: "l1",
  contactId: "c1",
  conversationId: null,
  status: "qualified",
  grade: "hot",
  points: 9,
  priority: "high",
  challenge: "Conseguir más clientes",
  question: null,
  qualification: { reasons: ["Prospecto caliente (9 puntos)."], services: ["web", "not-in-pack"], topGaps: ["capture"], treatment: "usted" },
  nextActionText: "Aprobar la solicitud",
  nextActionAt: "2030-01-01T00:00:00Z",
  ownerUserId: null,
  ownerName: null,
  createdAt: "2026-11-06T10:00:00Z",
  convertedOpportunityId: null,
  contactName: "Ana",
  company: "Café Sol",
  email: "ana@cafesol.example",
  phone: null,
  assessment: { id: "a1", score: 0, band: "initial", infrastructure: "none", answers, createdAt: "2026-11-06T10:00:00Z" },
  meetingApproved: false,
  approval: { id: "ap1", kind: "meeting_request", draft: { text: "Hola Ana" }, createdAt: "2026-11-06T10:00:00Z" },
  ...over,
});

const before = new Date("2026-11-06T09:00:00Z");
const after = new Date("2026-11-06T11:00:00Z");

describe("leadFromDto", () => {
  it("maps a stored lead to the pipeline shape, keeping only services the pack knows", () => {
    const lead = leadFromDto(dto(), pack, before);
    expect(lead).toMatchObject({ company: "Café Sol", contactName: "Ana", grade: "hot", score: 0, band: "initial", stage: "new", priority: "high", approvalId: "ap1" });
    expect(lead.services).toEqual(["web"]);
    expect(lead.contact).toEqual({ method: "email", value: "ana@cafesol.example" });
    expect(lead.status).toMatch(/^Café Sol está empezando/);
    expect(lead.approval?.draft).toBe("Hola Ana");
    expect(lead.owner).toBe("Equipo de Nova");
  });

  it("marks what arrived after the page opened as new in this session", () => {
    expect(leadFromDto(dto(), pack, before).arrival).toBe("session");
    expect(leadFromDto(dto(), pack, after).arrival).toBe("overnight");
  });

  it("derives the stage from the status, the approved meeting and the due date", () => {
    expect(leadFromDto(dto({ status: "converted" }), pack, after).stage).toBe("won");
    expect(leadFromDto(dto({ status: "working", meetingApproved: true, approval: null }), pack, after).stage).toBe("meetingRequested");
    expect(leadFromDto(dto({ status: "working", nextActionAt: "2020-01-01T00:00:00Z", approval: null }), pack, after, new Date("2026-11-06T12:00:00Z")).stage).toBe("needsFollowUp");
    expect(leadFromDto(dto({ status: "new", nextActionAt: "2020-01-01T00:00:00Z" }), pack, after, new Date("2026-11-06T12:00:00Z")).stage).toBe("new");
  });

  it("copes with a person-only lead that has no audit", () => {
    const lead = leadFromDto(dto({ assessment: null, grade: "human", approval: null, email: null, phone: "+50688887777" }), pack, after);
    expect(lead).toMatchObject({ score: null, band: null, status: null, grade: "human" });
    expect(lead.contact).toEqual({ method: "phone", value: "+50688887777" });
  });
});

describe("digestFromServer", () => {
  const server: ServerDigest = {
    since: "2026-11-05T00:00:00Z",
    sinceVisit: { analyzed: 3, prospects: 3, hot: 1, conversations: 3, won: 0 },
    leads: { open: 2, hot: 1, needFollowUp: 1, total: 5 },
    approvals: { pending: 9, items: [] },
    opportunities: { open: 0, won: 0, openAmountMinor: 0, wonAmountMinor: 0 },
    customers: { active: 0 },
    conversations: { open: 0, messagesToday: 0 },
    activity: [],
  };

  it("takes what happened since the last visit from the server and live counts from the leads", () => {
    const leads = [leadFromDto(dto(), pack, before), leadFromDto(dto({ id: "l2", approval: null, status: "converted" }), pack, after)];
    const result = digestFromServer(server, leads);
    expect(result.overnight.analyzed).toBe(3);
    expect(result.overnight.hot).toBe(1);
    expect(result.overnight.awaitingApproval).toBe(1); // live, not the stale server number
    expect(result.session.map((lead) => lead.id)).toEqual(["l1"]);
    expect(result.approvals).toHaveLength(1);
    expect(result.total).toBe(5);
  });
});
