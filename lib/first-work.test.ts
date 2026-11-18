import { describe, expect, it } from "vitest";
import type { Lead } from "@/lib/contracts/pipeline";
import { NO_CONTACT_ACTION } from "@/lib/guided-chat";
import { DRAFT_MARK, buildDeliverable, planText, recommend, type FirstWorkContext } from "./first-work";

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "l1", channel: "webChat", arrival: "session", company: "Café Sol", contactName: "Ana", contact: { method: "email", value: "ana@cafesol.example" },
  score: null, band: null, infrastructure: null, status: null, grade: "warm", points: 5, reasons: [], priority: "medium", services: [], topGaps: [],
  stage: "new", nextAction: "Enviar información y proponer una llamada", owner: "NEX", approval: null, ...over,
});
const ctx = (over: Partial<FirstWorkContext> = {}): FirstWorkContext => ({ demo: false, companyName: "Nova Marketing Studio", roleLabel: "Propietario", canWrite: true, leads: [], ...over });

describe("first useful work", () => {
  it("with no prospects it recommends preparing the capture and delivers an example plan", () => {
    const rec = recommend(ctx());
    expect(rec.need).toBe("clients");
    const plan = buildDeliverable("clients", ctx());
    expect(plan.basis).toBe("example");
    expect(plan.items.length).toBeGreaterThan(2);
    expect(plan.missing.join(" ")).toMatch(/no hay canales conectados/);
  });

  it("with prospects it recommends following up and builds the plan from the company's own prospects", () => {
    const leads = [lead(), lead({ id: "l2", company: "Sin Contacto", contact: null, nextAction: "x" })];
    expect(recommend(ctx({ leads })).need).toBe("followUp");
    const plan = buildDeliverable("followUp", ctx({ leads }));
    expect(plan.basis).toBe("company");
    expect(plan.items.map((item) => item.task).join("\n")).toContain("Café Sol");
    expect(plan.draft?.for).toBe("Café Sol");
    // a prospect without contact is not promised a message or a call
    expect(plan.items.find((item) => item.task.startsWith("Sin Contacto"))?.task).toContain(NO_CONTACT_ACTION);
  });

  it("puts pending meeting requests first and respects the person's role", () => {
    const leads = [lead(), lead({ id: "l2", company: "Pide Reunión", approval: { kind: "meeting", draft: "Hola" } })];
    const writer = buildDeliverable("followUp", ctx({ leads }));
    expect(writer.items[0]?.task).toBe("Decidir la solicitud de reunión de Pide Reunión");
    expect(writer.items[0]?.note).toContain("aprobar o rechazar");
    const viewer = ctx({ leads, canWrite: false, roleLabel: "Solo lectura" });
    expect(buildDeliverable("followUp", viewer).items[0]?.note).toContain("permiso de edición");
    expect(recommend(viewer).why).toContain("Solo lectura");
  });

  it("marks demonstration data as an example", () => {
    const leads = [lead()];
    expect(recommend(ctx({ demo: true, leads })).priority).toContain("datos de ejemplo");
    expect(buildDeliverable("followUp", ctx({ demo: true, leads })).basis).toBe("example");
  });

  it("asks for no budget, decision maker or contact, and never claims to have sent or booked anything", () => {
    const leads = [lead()];
    const rec = recommend(ctx({ leads }));
    const text = planText(buildDeliverable("followUp", ctx({ leads })), rec) + planText(buildDeliverable("clients", ctx()), recommend(ctx()));
    expect(text).not.toMatch(/presupuesto|quién decide|deje su contacto/i);
    expect(text).toContain("Acciones ejecutadas: ninguna");
    expect(text).not.toMatch(/se envió el|enviamos|publicamos|agendamos/i);
  });

  it("the saved text says it is a draft and what it is based on", () => {
    const text = planText(buildDeliverable("clients", ctx()), recommend(ctx()));
    expect(text.startsWith(DRAFT_MARK)).toBe(true);
    expect(text).toContain("Es un ejemplo");
  });

  it("does not promise channels or publishing that do not work today", () => {
    const text = planText(buildDeliverable("clients", ctx()), recommend(ctx()));
    expect(text).not.toMatch(/YouTube|Instagram|WhatsApp|publicar su canal/i);
    expect(text).toMatch(/no hay canales conectados/);
  });
});
