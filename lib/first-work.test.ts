import { describe, expect, it } from "vitest";
import type { Lead } from "@/lib/contracts/pipeline";
import { NO_CONTACT_ACTION } from "@/lib/guided-chat";
import { DRAFT_MARK, EXECUTION_NOTE, HISTORY_TITLE, buildDeliverable, effectiveNeed, historyTitleOf, planText, priorityFor, recommend, type FirstWorkContext } from "./first-work";

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
    expect(text).toContain("Lo que ofrecemos: campañas de marketing para pequeños negocios. Trabajamos con: restaurantes y cafés.");
    expect(text).not.toContain("[completar");
  });

  it("capture: the person's phrases are used as typed, never bent into a sentence, and no benefit or result is added", () => {
    const draft = buildDeliverable("clients", ctx({ offer: "Producción de contenido.", audience: "Pequeñas empresas" }));
    const text = draft.pieces.map((piece) => piece.text).join("\n");
    expect(text).toContain("Lo que ofrecemos: Producción de contenido. Trabajamos con: Pequeñas empresas.");
    expect(text).not.toMatch(/nos dedicamos|pensado para|resultados|mejores|garantiz|aumentar|más ventas/i);
  });

  it("capture: with one phrase missing, only that one is marked [completar]", () => {
    const text = buildDeliverable("clients", ctx({ offer: "Producción de contenido" })).pieces[0]?.text ?? "";
    expect(text).toContain("Lo que ofrecemos: Producción de contenido.");
    expect(text).toContain("[completar: a quién se dirige]");
    expect(text).not.toContain("[completar: qué ofrece su empresa]");
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

describe("history titles", () => {
  it("each kind of draft is saved under its own title", () => {
    expect(buildDeliverable("clients", ctx()).kind).toBe("clients");
    expect(buildDeliverable("followUp", ctx({ leads: [lead()] })).kind).toBe("followUp");
    expect(buildDeliverable("followUp", ctx()).kind).toBe("clients");
    expect(HISTORY_TITLE).toEqual({ clients: "Captación: mensaje y presentación", followUp: "Seguimiento: prospectos" });
  });

  it("the kind of a saved draft is read from its text, also for drafts saved with earlier titles", () => {
    const first = (title: string) => `${DRAFT_MARK}${title}\nresto`;
    expect(historyTitleOf(first("Propuesta de mensaje y presentación"))).toBe("Captación: mensaje y presentación");
    expect(historyTitleOf(first("Plan de captación de 7 días"))).toBe("Captación: mensaje y presentación");
    expect(historyTitleOf(first("Seguimiento preparado"))).toBe("Seguimiento: prospectos");
    expect(historyTitleOf(first("Plan de seguimiento de 7 días"))).toBe("Seguimiento: prospectos");
    expect(historyTitleOf(allText(ctx(), "clients"))).toBe(HISTORY_TITLE.clients);
    expect(historyTitleOf(allText(ctx({ leads: [lead()] }), "followUp"))).toBe(HISTORY_TITLE.followUp);
  });

  it("returns null when it is not one of ours or the type cannot be told", () => {
    expect(historyTitleOf("Una respuesta cualquiera")).toBeNull();
    expect(historyTitleOf(`${DRAFT_MARK}Algo distinto\nresto`)).toBeNull();
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
