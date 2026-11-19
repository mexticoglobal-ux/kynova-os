import { describe, expect, it } from "vitest";
import type { Lead } from "@/lib/contracts/pipeline";
import { NO_CONTACT_ACTION } from "@/lib/guided-chat";
import { DRAFT_MARK, EXECUTION_NOTE, buildDeliverable, effectiveNeed, planText, priorityFor, recommend, type FirstWorkContext } from "./first-work";

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: "l1", channel: "webChat", arrival: "session", company: "Café Sol", contactName: "Ana", contact: { method: "email", value: "ana@cafesol.example" },
  score: null, band: null, infrastructure: null, status: null, grade: "warm", points: 5, reasons: [], priority: "medium", services: [], topGaps: [],
  stage: "new", nextAction: "Enviar información y proponer una llamada", owner: "NEX", approval: null, ...over,
});
const ctx = (over: Partial<FirstWorkContext> = {}): FirstWorkContext => ({ demo: false, companyName: "Nova Marketing Studio", roleLabel: "Propietario", canWrite: true, leads: [], ...over });
const allText = (c: FirstWorkContext, need: "clients" | "followUp") => planText(buildDeliverable(need, c), priorityFor(need, c));

describe("the chosen goal and the Pipeline's state are kept apart", () => {
  it("capture chosen with prospects in the Pipeline never says there are none", () => {
    const c = ctx({ leads: [lead()] });
    const advice = priorityFor("clients", c);
    expect(advice.why).toContain("Ya tiene 1 prospecto abierto");
    expect(`${advice.priority} ${advice.why}`).not.toMatch(/Todavía no hay prospectos/);
    expect(allText(c, "clients")).not.toMatch(/Todavía no hay prospectos/);
  });

  it("capture chosen with an empty Pipeline says so, truthfully", () => {
    expect(priorityFor("clients", ctx()).why).toContain("Todavía no hay prospectos abiertos");
  });

  it("suggests follow-up when there are prospects and capture when there are none, but the person can choose either", () => {
    expect(recommend(ctx({ leads: [lead()] })).need).toBe("followUp");
    expect(recommend(ctx()).need).toBe("clients");
    expect(buildDeliverable("clients", ctx({ leads: [lead()] })).title).toBe("Propuesta de mensaje y presentación");
  });

  it("follow-up chosen with nothing to follow up gets the capture draft and says why", () => {
    expect(effectiveNeed("followUp", ctx())).toBe("clients");
    expect(priorityFor("followUp", ctx()).priority).toBe("Todavía no hay prospectos abiertos que atender");
    expect(buildDeliverable("followUp", ctx()).title).toBe("Propuesta de mensaje y presentación");
  });
});

describe("the draft is ready now and invents nothing", () => {
  it("capture: a message and a presentation piece, with [completar] where the person has not said", () => {
    const draft = buildDeliverable("clients", ctx());
    expect(draft.pieces.map((piece) => piece.label)).toEqual(["Mensaje propuesto", "Pieza de presentación (borrador)"]);
    expect(draft.items).toEqual([]);
    expect(draft.needsContext).toEqual(["qué ofrece su empresa", "a quién se dirige"]);
    const text = draft.pieces.map((piece) => piece.text).join("\n");
    expect(text).toContain("[completar: qué ofrece su empresa");
    expect(text).toContain("[completar: a quién se dirige]");
    expect(text).toContain("Nova Marketing Studio");
  });

  it("capture: what the person types goes in, and then nothing is missing", () => {
    const draft = buildDeliverable("clients", ctx({ offer: "campañas de marketing para pequeños negocios.", audience: " restaurantes y cafés " }));
    expect(draft.needsContext).toEqual([]);
    const text = draft.pieces.map((piece) => piece.text).join("\n");
    expect(text).toContain("Nos dedicamos a campañas de marketing para pequeños negocios, pensado para restaurantes y cafés.");
    expect(text).not.toContain("[completar");
  });

  it("no seven-day split and no diagnostic required", () => {
    const text = allText(ctx(), "clients") + allText(ctx({ leads: [lead()] }), "followUp");
    expect(text).not.toMatch(/Día \d|7 días|siete días/i);
    expect(text).not.toMatch(/hacer el diagnóstico|diagnóstico de su negocio/i);
  });

  it("follow-up: ordered list without invented days, pending requests first, no promise to an unreachable prospect", () => {
    const leads = [lead(), lead({ id: "l2", company: "Pide Reunión", approval: { kind: "meeting", draft: "Hola" } }), lead({ id: "l3", company: "Sin Contacto", contact: null })];
    const draft = buildDeliverable("followUp", ctx({ leads }));
    expect(draft.items[0]).toMatchObject({ label: "Decidir", task: "La solicitud de reunión de Pide Reunión" });
    expect(draft.items.find((item) => item.task.startsWith("Sin Contacto"))?.task).toContain(NO_CONTACT_ACTION);
    expect(draft.pieces[0]?.label).toBe("Mensaje propuesto para Café Sol");
  });

  it("respects the person's role", () => {
    const leads = [lead({ approval: { kind: "meeting", draft: "Hola" } })];
    const viewer = ctx({ leads, canWrite: false, roleLabel: "Solo lectura" });
    expect(buildDeliverable("followUp", viewer).items[0]?.note).toContain("permiso de edición");
    expect(priorityFor("followUp", viewer).why).toContain("Solo lectura");
  });

  it("marks demonstration data as an example", () => {
    const demo = ctx({ demo: true, leads: [lead()] });
    expect(priorityFor("followUp", demo).priority).toContain("datos de ejemplo");
    expect(buildDeliverable("followUp", demo).basis).toBe("example");
  });
});

describe("what is said about execution and about the source", () => {
  it("asks for no budget, decision maker or contact, and never claims to have sent or booked anything", () => {
    const text = allText(ctx(), "clients") + allText(ctx({ leads: [lead()] }), "followUp");
    expect(text).not.toMatch(/presupuesto|quién decide|deje su contacto/i);
    expect(text).toContain("Acciones ejecutadas: ninguna.");
    expect(text).not.toMatch(/se envió el|enviamos|publicamos|agendamos/i);
  });

  it("does not fix human approval for every future send: execution depends on connected channels and configured permissions", () => {
    expect(EXECUTION_NOTE).toContain("dependerá de los canales que se conecten y de los permisos que se configuren");
    expect(EXECUTION_NOTE).toContain("Hoy no se ejecutan envíos");
    expect(allText(ctx(), "clients")).not.toMatch(/deberá aprobar|siempre.*aprobaci|toda ejecución/i);
  });

  it("the saved text says it is a draft and what it is based on; it promises no channel", () => {
    const text = allText(ctx(), "clients");
    expect(text.startsWith(DRAFT_MARK)).toBe(true);
    expect(text).toContain("Se basa en datos de su empresa y en lo que usted escribió.");
    expect(text).not.toMatch(/YouTube|Instagram|WhatsApp/i);
  });
});
