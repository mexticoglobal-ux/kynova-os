import { describe, expect, it } from "vitest";
import { AUDIT_DIMENSIONS } from "@/lib/contracts/audit";
import { NOVA_DRAFT_PACK as pack } from "@/lib/audit-packs/nova-draft";
import type { LeadDto } from "@/lib/contracts/backend";
import { advance, greeting, initialState, NO_CONTACT_ACTION, type ChatState, type Say } from "./guided-chat";
import { leadFromDto } from "./modules/leads/map";
import { executiveSummary } from "./pipeline";

function run(inputs: string[], persisted = false) {
  let state: ChatState = initialState("usted");
  const said: Say[] = [];
  for (const input of inputs) {
    const result = advance(state, input, pack, persisted);
    state = result.state;
    said.push(...result.say);
  }
  return said;
}
const level = AUDIT_DIMENSIONS.map(() => "none");
const texts = (said: Say[]) => said.map((s) => (s.kind === "text" ? s.text : "")).join(" ");
const handoffOf = (said: Say[]) => said.flatMap((s) => (s.kind === "handoff" ? [s.handoff] : []))[0];

const WITHOUT_CONTACT = ["audit", "Ana", "Café Sol", "moreClients", ...level, "high", "now", "owner", "none"];
const WITH_CONTACT = ["audit", "Ana", "Café Sol", "moreClients", ...level, "high", "now", "owner", "email", "ana@cafesol.example"];

describe("a prospect who left no way to reach them", () => {
  it("is not promised a call or a message: the next step and the closing say so", () => {
    const said = run(WITHOUT_CONTACT);
    const handoff = handoffOf(said);
    expect(handoff?.contact).toBeNull();
    expect(handoff?.route).not.toBe("human");
    expect(handoff?.nextStep).toBe(NO_CONTACT_ACTION);
    expect(texts(said)).not.toMatch(/contactarle|contactarte|atenderle con prioridad|atenderte con prioridad|una llamada/);
  });

  it("keeps the usual next step when there is a contact", () => {
    const handoff = handoffOf(run(WITH_CONTACT));
    expect(handoff?.contact).not.toBeNull();
    expect(handoff?.nextStep).not.toBe(NO_CONTACT_ACTION);
  });

  it("a person who asked for a human is still answered personally", () => {
    expect(handoffOf(run(["human", "Pedro", "none"]))?.nextStep).toBe("Responder personalmente a lo que pidió.");
  });
});

describe("the chat says what really happens", () => {
  it("demonstration: nothing is saved (unchanged)", () => {
    expect(texts(greeting(pack, "usted"))).toContain("no se guarda ni se envía nada");
  });

  it("signed in: it says the conversation is saved in the company, and does not claim nothing is saved", () => {
    const greet = texts(greeting(pack, "usted", true));
    expect(greet).toContain("se guardan en su empresa");
    expect(greet).not.toContain("no se guarda ni se envía nada");
    const closing = texts(run(WITH_CONTACT, true));
    expect(closing).toContain("guardados en su empresa");
    expect(closing).not.toContain("no se envió nada");
  });
});

const dto = (over: Partial<LeadDto> = {}): LeadDto => ({
  id: "l1", contactId: "c1", conversationId: null, status: "qualified", grade: "hot", points: 9, priority: "high", challenge: null, question: null,
  qualification: { reasons: [], services: [], topGaps: [], treatment: "usted" }, nextActionText: "Contactar cuanto antes y proponer una llamada.", nextActionAt: "2030-01-01T00:00:00Z",
  ownerUserId: null, ownerName: null, createdAt: "2026-11-06T10:00:00Z", convertedOpportunityId: null, contactName: "Ana", company: "Café Sol", email: null, phone: null,
  assessment: null, meetingApproved: false, approval: null, ...over,
});

describe("a stored lead without contact", () => {
  const started = new Date("2026-11-06T00:00:00Z");

  it("shows the no-contact action in the pipeline and in the summary, even if it was stored with a call to make", () => {
    const lead = leadFromDto(dto(), pack, started);
    expect(lead.nextAction).toBe(NO_CONTACT_ACTION);
    expect(executiveSummary(lead, pack).rows).toContainEqual(["Qué recomienda NEX", NO_CONTACT_ACTION]);
  });

  it("keeps the stored action when there is a contact, and for a request for a person", () => {
    expect(leadFromDto(dto({ email: "ana@cafesol.example" }), pack, started).nextAction).toBe("Contactar cuanto antes y proponer una llamada.");
    expect(leadFromDto(dto({ grade: "human" }), pack, started).nextAction).toBe("Contactar cuanto antes y proponer una llamada.");
  });
});
