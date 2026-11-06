import { describe, expect, it } from "vitest";
import { AUDIT_DIMENSIONS } from "@/lib/contracts/audit";
import { NOVA_DRAFT_PACK as pack } from "@/lib/audit-packs/nova-draft";
import { advance, initialState, type ChatState } from "@/lib/guided-chat";
import { buildProspectPayload } from "./build";

type Payload = {
  route: string;
  audit?: { score: number; band: string; answers: Record<string, string>; result: { gaps: unknown[] } };
  services: string[];
  contact?: unknown;
  qualification?: unknown;
  noticeVersion: string;
  question?: string;
  transcript: unknown[];
  meetingDraft?: string;
};
const payloadOf = (state: ChatState, transcript: Parameters<typeof buildProspectPayload>[1] = []) => buildProspectPayload(state, transcript, pack) as unknown as Payload;

function run(inputs: string[]): ChatState {
  let state = initialState("usted");
  for (const input of inputs) state = advance(state, input, pack).state;
  return state;
}

const hot = ["audit", "Ana", "Café Sol", "moreClients", ...AUDIT_DIMENSIONS.map(() => "none"), "high", "now", "owner", "email", "ana@cafesol.example"];

describe("prospect payload", () => {
  it("recomputes the score, grade and services from the closed answers", () => {
    const payload = payloadOf(run(hot));
    expect(payload.route).toBe("hot");
    expect(payload.audit?.score).toBe(0);
    expect(payload.audit?.band).toBe("initial");
    expect(payload.audit?.answers.web).toBe("none");
    expect(payload.audit?.result.gaps.length).toBeGreaterThan(0);
    expect(payload.services.length).toBeGreaterThan(0);
    expect(payload.contact).toEqual({ method: "email", value: "ana@cafesol.example" });
    expect(payload.qualification).toMatchObject({ budget: "high", points: 9 });
    expect(payload.noticeVersion).toMatch(/guided-chat/);
  });

  it("prepares the meeting request only for hot or warm prospects with a contact", () => {
    expect(String((buildProspectPayload(run(hot), [], pack) as Record<string, unknown>).meetingDraft)).toContain("Hola Ana");
    const cold = ["audit", "Ana", "", "unsure", ...AUDIT_DIMENSIONS.map(() => "optimized"), "unknown", "exploring", "none", "none"];
    expect((buildProspectPayload(run(cold), [], pack) as Record<string, unknown>).meetingDraft).toBeUndefined();
    expect((buildProspectPayload(run(["human", "Pedro", "email", "pedro@example.test"]), [], pack) as Record<string, unknown>).meetingDraft).toBeUndefined();
  });

  it("builds a person-only handoff without an audit", () => {
    const payload = payloadOf(run(["question", "¿Cuánto cuesta?", "Luis", "none"]));
    expect(payload.route).toBe("human");
    expect(payload.audit).toBeUndefined();
    expect(payload.question).toBe("¿Cuánto cuesta?");
  });

  it("refuses a conversation that has not finished", () => {
    expect(buildProspectPayload(run(["audit", "Ana"]), [], pack)).toBeNull();
    expect(buildProspectPayload(initialState("usted"), [], pack)).toBeNull();
  });

  it("carries the transcript as stored messages", () => {
    const payload = payloadOf(run(hot), [{ direction: "out", senderKind: "nex", contentType: "text", body: "Hola" }]);
    expect(payload.transcript).toEqual([{ direction: "out", senderKind: "nex", contentType: "text", body: "Hola" }]);
  });
});
