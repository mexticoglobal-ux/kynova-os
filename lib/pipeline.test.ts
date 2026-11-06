import { describe, expect, it } from "vitest";
import { AUDIT_DIMENSIONS } from "@/lib/contracts/audit";
import { CHANNEL_STATUS, CONVERSATION_CHANNELS, PAYMENT_RAILS } from "@/lib/contracts/pipeline";
import { NOVA_DRAFT_PACK as pack } from "@/lib/audit-packs/nova-draft";
import { advance, initialState, type ChatState, type Handoff, type Say } from "@/lib/guided-chat";
import { approveMeeting, digest, discardMeeting, executiveSummary, leadFromHandoff, seedLeads, sortLeads } from "./pipeline";

function handoffFor(inputs: string[]): Handoff {
  let state: ChatState = initialState("usted");
  const said: Say[] = [];
  for (const input of inputs) {
    const result = advance(state, input, pack);
    state = result.state;
    said.push(...result.say);
  }
  const found = said.find((say) => say.kind === "handoff");
  if (found?.kind !== "handoff") throw new Error("conversation did not end in a handoff");
  return found.handoff;
}

const hotChat = ["audit", "Ana", "Café Sol", "moreClients", ...AUDIT_DIMENSIONS.map(() => "none"), "high", "now", "owner", "email", "ana@cafesol.example"];

describe("architecture: channels", () => {
  it("only the web chat exists today; every other channel and payment rail is declared as planned", () => {
    expect(CHANNEL_STATUS.webChat).toBe("demo");
    const others = [...CONVERSATION_CHANNELS.filter((channel) => channel !== "webChat"), ...PAYMENT_RAILS];
    expect(others.length).toBe(10);
    expect(others.every((channel) => CHANNEL_STATUS[channel] === "planned")).toBe(true);
  });
});

describe("seed leads", () => {
  const leads = seedLeads(pack);

  it("are fictional, arrive overnight and are graded by the real engine", () => {
    expect(leads).toHaveLength(6);
    expect(leads.every((lead) => lead.arrival === "overnight" && lead.id.startsWith("demo-"))).toBe(true);
    expect(leads.map((lead) => lead.grade)).toEqual(["hot", "hot", "warm", "warm", "cold", "cold"]);
    expect(leads.every((lead) => lead.score !== null && lead.services.length > 0)).toBe(true);
  });

  it("only offer a meeting request when there is a contact and the prospect is worth it", () => {
    const withApproval = leads.filter((lead) => lead.approval);
    expect(withApproval.map((lead) => lead.company)).toEqual(["Panadería La Espiga", "Clínica Dental Sonrisa"]);
    expect(leads.find((lead) => lead.contact === null)?.approval).toBeNull();
  });
});

describe("lead from a conversation handoff", () => {
  it("turns a hot handoff into a prioritized lead with a drafted meeting request", () => {
    const lead = leadFromHandoff(handoffFor(hotChat), pack, "chat-1");
    expect(lead).toMatchObject({ id: "chat-1", channel: "webChat", arrival: "session", company: "Café Sol", contactName: "Ana", grade: "hot", priority: "high", stage: "new", score: 0 });
    expect(lead.status).toMatch(/^Café Sol está empezando/);
    expect(lead.services.length).toBeGreaterThan(0);
    expect(lead.approval?.kind).toBe("meeting");
    expect(lead.approval?.draft).toContain("Hola Ana");
    expect(lead.approval?.draft).not.toMatch(/\$|garantiz|precio/i);
  });

  it("prepares no meeting request without a contact, or for a person-only request", () => {
    expect(leadFromHandoff(handoffFor(["human", "Pedro", "none"]), pack, "chat-2")).toMatchObject({ grade: "human", approval: null, score: null, company: "Pedro" });
    const coldChat = ["audit", "Ana", "", "unsure", ...AUDIT_DIMENSIONS.map(() => "optimized"), "unknown", "exploring", "none", "none"];
    const cold = leadFromHandoff(handoffFor(coldChat), pack, "chat-3");
    expect(cold).toMatchObject({ grade: "cold", priority: "low", approval: null, contact: null });
    expect(cold.nextAction).toContain("Sin medio de contacto");
  });
});

describe("meeting request", () => {
  it("moves the lead forward only when approved, and never twice", () => {
    const [first] = seedLeads(pack);
    const approved = approveMeeting([first], first.id);
    expect(approved[0]).toMatchObject({ approval: null, stage: "meetingRequested" });
    expect(approveMeeting(approved, first.id)).toEqual(approved);
  });

  it("keeps the lead where it was when the owner says not yet", () => {
    const [first] = seedLeads(pack);
    const declined = discardMeeting([first], first.id);
    expect(declined[0]).toMatchObject({ approval: null, stage: first.stage });
  });
});

describe("dashboard digest", () => {
  it("counts what happened overnight from the leads, never from fixed numbers", () => {
    const leads = seedLeads(pack);
    expect(digest(leads).overnight).toEqual({ analyzed: 6, hot: 2, awaitingApproval: 2, needFollowUp: 2, withMeeting: 1 });
    const approved = approveMeeting(leads, "demo-1");
    expect(digest(approved).overnight).toMatchObject({ awaitingApproval: 1, withMeeting: 2 });
    expect(digest([])).toMatchObject({ overnight: { analyzed: 0 }, total: 0 });
  });

  it("separates what arrived during the session and lists every pending approval", () => {
    const fresh = leadFromHandoff(handoffFor(hotChat), pack, "chat-1");
    const all = [...seedLeads(pack), fresh];
    const result = digest(all);
    expect(result.session.map((lead) => lead.id)).toEqual(["chat-1"]);
    expect(result.approvals.map((lead) => lead.id)).toContain("chat-1");
    expect(result.overnight.analyzed).toBe(6);
  });
});

describe("ordering and executive summary", () => {
  it("shows high priority first and a new arrival ahead of older leads of the same priority", () => {
    const fresh = leadFromHandoff(handoffFor(hotChat), pack, "chat-1");
    const sorted = sortLeads([...seedLeads(pack), fresh]);
    expect(sorted[0].id).toBe("chat-1");
    expect(sorted.at(-1)?.priority).toBe("low");
  });

  it("explains who the lead is, why it was graded so and what to do, in one page", () => {
    const [lead] = seedLeads(pack);
    const brief = executiveSummary(lead, pack);
    expect(brief.headline).toBe("Panadería La Espiga: oportunidad caliente");
    expect(brief.rows.map(([label]) => label)).toEqual(["Cómo está el negocio", "Su prioridad", "Clasificación", "Servicios recomendados", "Qué recomienda NEX", "Contacto"]);
  });
});
