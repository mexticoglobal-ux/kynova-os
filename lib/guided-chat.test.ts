import { describe, expect, it } from "vitest";
import { AUDIT_DIMENSIONS } from "@/lib/contracts/audit";
import { NOVA_DRAFT_PACK as pack } from "@/lib/audit-packs/nova-draft";
import { advance, greeting, initialState, promptFor, validate, type ChatState, type Say } from "./guided-chat";

function run(inputs: string[], treatment: "usted" | "tu" = "usted") {
  let state: ChatState = initialState(treatment);
  const said: Say[] = [];
  for (const input of inputs) {
    const result = advance(state, input, pack);
    state = result.state;
    said.push(...result.say);
  }
  return { state, said };
}

const auditInputs = (level: string) => AUDIT_DIMENSIONS.map(() => level);
const handoffOf = (said: Say[]) => said.flatMap((s) => (s.kind === "handoff" ? [s.handoff] : []))[0];

describe("guided chat", () => {
  it("introduces itself as an automated assistant of the client and says nothing is stored", () => {
    const text = greeting(pack, "usted")
      .map((s) => (s.kind === "text" ? s.text : ""))
      .join(" ");
    expect(text).toContain("asistente automatizado de Nova Marketing Studio");
    expect(text).toContain("no se guarda ni se envía nada");
  });

  it("runs the whole path: discover, audit, result, qualify, contact, handoff", () => {
    const { state, said } = run(["audit", "Ana", "Café Sol", "moreClients", ...auditInputs("none"), "high", "now", "owner", "email", "ana@cafesol.com"]);
    expect(state.step).toBe("end");
    expect(promptFor(state).kind).toBe("end");
    const result = said.find((s) => s.kind === "result");
    expect(result).toMatchObject({ kind: "result", score: 0, band: "initial", infrastructure: "none" });
    const handoff = handoffOf(said);
    expect(handoff.route).toBe("hot");
    expect(handoff.contact).toEqual({ name: "Ana", method: "email", value: "ana@cafesol.com" });
    expect(handoff.audit?.topGaps).toEqual(["capture", "web", "followUp"]);
    expect(handoff.services.length).toBeGreaterThan(0);
    expect(handoff.business).toEqual({ name: "Café Sol", challenge: "Conseguir más clientes" });
  });

  it("shows the working lines before the result, and a reaction after every audit answer", () => {
    const { said } = run(["audit", "Ana", "", "unsure", ...auditInputs("adHoc")]);
    const kinds = said.map((s) => s.kind);
    expect(kinds.filter((k) => k === "reaction")).toHaveLength(AUDIT_DIMENSIONS.length + 1); // + the priority acknowledgement
    expect(kinds.indexOf("working")).toBeLessThan(kinds.indexOf("result"));
    expect(kinds.filter((k) => k === "working")).toHaveLength(4);
  });

  it("grades by the client's rules and never calls a demo handoff 'sent'", () => {
    const cold = run(["audit", "Ana", "", "unsure", ...auditInputs("optimized"), "unknown", "exploring", "none", "none"]);
    expect(handoffOf(cold.said).route).toBe("cold");
    const warm = run(["audit", "Ana", "", "unsure", ...auditInputs("defined"), "medium", "soon", "influencer", "phone", "+506 8888 7777"]);
    expect(handoffOf(warm.said).route).toBe("warm");
    const texts = [...cold.said, ...warm.said].map((s) => (s.kind === "text" ? s.text : "")).join(" ");
    expect(texts).toContain("no se envió nada");
    expect(texts).not.toMatch(/ya compart[íi]|enviado al equipo/i);
  });

  it("hands a question to a person without inventing an answer", () => {
    const { said } = run(["question", "¿Cuánto cuesta una campaña?", "Luis", "whatsapp", "+506 8888 7777"]);
    const handoff = handoffOf(said);
    expect(handoff.route).toBe("human");
    expect(handoff.question).toBe("¿Cuánto cuesta una campaña?");
    expect(handoff.audit).toBeUndefined();
    expect(said.some((s) => s.kind === "text" && s.text.includes("no voy a inventar una respuesta"))).toBe(true);
  });

  it("routes current clients and requests for a person to a human, with or without contact", () => {
    expect(handoffOf(run(["client", "Marta", "none"]).said)).toMatchObject({ route: "human", contact: null });
    const person = handoffOf(run(["human", "Pedro", "none"]).said);
    expect(person.reasons.join(" ")).toContain("pidió hablar con una persona");
    expect(person.reasons.join(" ")).toContain("No dejó un medio de contacto");
  });

  it("validates free text and contact details before accepting them", () => {
    const state = run(["audit", "Ana", "", "unsure", ...auditInputs("none"), "high", "now", "owner", "email"]).state;
    expect(state.step).toBe("contactValue");
    expect(validate(state, "no es un correo")).not.toBeNull();
    expect(validate(state, "ana@cafesol.com")).toBeNull();
    const phone = run(["human", "Pedro", "phone"]).state;
    expect(validate(phone, "123")).not.toBeNull();
    expect(validate(phone, "+506 8888 7777")).toBeNull();
    expect(validate(initialState("usted"), "x")).toBeNull(); // choice steps have no text rules
    const name = run(["human"]).state;
    expect(validate(name, "   ")).not.toBeNull();
    expect(validate(name, "x".repeat(81))).not.toBeNull();
  });

  it("ignores inputs that are not one of the offered choices", () => {
    const start = initialState("usted");
    expect(advance(start, "cualquier cosa", pack)).toEqual({ state: start, say: [] });
    const audit = run(["audit", "Ana", "", "unsure"]).state;
    expect(advance(audit, "expert", pack).state).toBe(audit);
  });

  it("speaks in tú when asked and offers the same choices", () => {
    const { said } = run(["audit"], "tu");
    expect(said.map((s) => (s.kind === "text" ? s.text : "")).join(" ")).toContain("¿Cómo te llamas?");
    expect(promptFor(initialState("tu"))).toEqual(promptFor(initialState("usted")));
  });
});
