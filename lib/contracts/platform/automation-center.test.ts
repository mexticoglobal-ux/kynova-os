import { describe, expect, it } from "vitest";
import { ERROR_CODES, fieldLabel, label, message } from "./automation-messages";
import {
  ACTIONS, ACTION_PARAMS, ACTION_TOOL, CONTACT_FIELDS, MAX_ACTIONS, MAX_CONDITIONS, MAX_RUNS_PER_HOUR, TRIGGERS, TRIGGER_FIELDS, actionLevel, automationStats, automationsOf, matches, newAutomationState,
  outputsOf, placeholdersOf, reduceAutomations, renderTemplate, runsOf, validateAutomation, type AutomationEvent, type AutomationInput, type AutomationState, type Condition,
} from "./automation-center";
import { SAMPLE_PAYLOADS, action, blankInput, demoAutomationsOk } from "./automation-demo";
import { ACTION_LEVELS, levelForAction } from "./workers";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const NOVA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const VIDA = { tenantId: "tenant-vida", actor: "lucia" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const SYSTEM = { tenantId: "tenant-nova", actor: "system" };

const step = (state: AutomationState, event: AutomationEvent) => reduceAutomations(state, event);
const must = (state: AutomationState, event: AutomationEvent): AutomationState => {
  const result = reduceAutomations(state, event);
  expect(result.error, event.type).toBeUndefined();
  return result.state;
};
const created = (input: AutomationInput = blankInput(), who = NOVA, state = newAutomationState()) => {
  const next = must(state, { ...who, at: day(1), type: "automation.create", input });
  return { state: next, id: next.automations.at(-1)?.id ?? "" };
};
const live = (input: AutomationInput, who = NOVA, state = newAutomationState()) => {
  const made = created(input, who, state);
  const activated = must(made.state, { ...who, at: day(1), type: "automation.activate", automationId: made.id });
  return { state: must(activated, { ...who, at: day(1), type: "automation.setTestMode", automationId: made.id, testMode: false }), id: made.id };
};
const fireEvent = (state: AutomationState, kind: AutomationInput["trigger"], payload: Record<string, string>, over: Partial<Extract<AutomationEvent, { type: "trigger.fire" }>> = {}, at = day(5)) =>
  step(state, { ...SYSTEM, at, type: "trigger.fire", kind, payload, ...over });

const prospect = (over: Partial<AutomationInput> = {}) => blankInput({
  name: "Prospecto caliente", trigger: "newProspect", conditions: [{ field: "puntaje", op: "greaterThan", value: "70" }],
  actions: [action("createTask", { titulo: "Llamar a {{nombre}}", enDias: "1" }), action("prepareEmail", { para: "{{correo}}", asunto: "Hola {{nombre}}", cuerpo: "Gracias, {{nombre}}." })], ...over,
});

describe("the sample loads without a refusal and shows every case", () => {
  it("has live, test-mode, paused and draft automations, and runs in every outcome", () => {
    const state = demoAutomationsOk();
    expect(automationStats(state, "tenant-nova")).toMatchObject({ automations: { draft: 1, active: 4, paused: 1 }, live: 3, runs: { completed: 3, testLogged: 2, skipped: 0, failed: 1 }, openOutputs: { task: 1, reminder: 1, notification: 3, emailDraft: 2, whatsappDraft: 1, pendingEvent: 0 } });
    expect(state.automations.find((item) => item.name === "Preparar la reunión")?.createdBy).toBe("worker:nex");
    expect(state.runs.find((run) => run.status === "failed")?.results.find((result) => result.error)?.error).toContain("falta «correo»");
    expect(state.runs.filter((run) => run.status === "failed")[0].results.filter((result) => result.outputId)).toHaveLength(2); // the other two actions were still prepared
  });

  it("matched some events, skipped others, and processed a repeated event once", () => {
    const state = demoAutomationsOk();
    expect(state.runs.filter((run) => run.automationName === "Prospecto caliente")).toHaveLength(2); // Marta and Camila; Pedro (40) did not match
    expect(state.runs.some((run) => run.automationName === "Cobro recibido")).toBe(false); // paused
    expect(state.audit.some((entry) => entry.action === "trigger.duplicate")).toBe(true);
    expect(state.runs.filter((run) => run.eventId === "evt-1")).toHaveLength(1);
  });
});

describe("Constitution: automations only prepare", () => {
  it("has exactly the six triggers and six actions asked for", () => {
    expect([...TRIGGERS]).toEqual(["newProspect", "newClient", "paymentReceived", "meetingCreated", "formSubmitted", "manual"]);
    expect([...ACTIONS]).toEqual(["createTask", "createReminder", "notifyInternal", "prepareEmail", "prepareWhatsapp", "createPendingEvent"]);
    for (const trigger of TRIGGERS) expect(label("trigger", trigger)).not.toBe("");
    for (const kind of ACTIONS) expect(label("action", kind)).not.toBe("");
  });

  it("makes every action Level 1 in the single autonomy catalog, so none can send, write outside or move money", () => {
    for (const kind of ACTIONS) {
      expect(actionLevel(kind), kind).toBe(1);
      expect(ACTION_TOOL[kind] in ACTION_LEVELS, `${kind} must be in the catalog, not unknown`).toBe(true);
    }
    expect(ACTION_TOOL.prepareEmail).toBe("message.draft"); // it prepares; it does not send
    expect(ACTION_TOOL.prepareWhatsapp).toBe("message.draft");
    const reachable = new Set(Object.values(ACTION_TOOL));
    for (const sensitive of ["followup.send", "message.sendFirst", "message.sendSensitive", "calendar.write", "payment.createLink", "payment.refund", "customer.create"]) {
      expect(reachable.has(sensitive), sensitive).toBe(false);
      expect(levelForAction(sensitive), sensitive).toBe(3);
    }
    expect(ACTIONS.some((kind) => /send|write|pay|refund/i.test(kind))).toBe(false);
  });

  it("only ever produces something a person still has to handle: a draft stays a draft", () => {
    const state = demoAutomationsOk();
    const drafts = outputsOf(state, "tenant-nova").filter((item) => item.kind === "emailDraft" || item.kind === "whatsappDraft");
    expect(drafts.length).toBeGreaterThan(0);
    expect(drafts.every((item) => item.status === "open")).toBe(true);
    expect(new Set(state.outputs.map((item) => item.status))).toEqual(new Set(["open", "done"]));
    const resolved = must(state, { ...PABLO, at: day(9), type: "output.resolve", outputId: drafts[0].id, resolution: "done" });
    expect(resolved.outputs.find((item) => item.id === drafts[0].id)).toMatchObject({ status: "done", resolvedBy: "pablo" }); // "done" = a person handled it outside the platform
  });

  it("lets NEX leave a draft or a copy, and nothing else", () => {
    const made = created(blankInput({ name: "Idea de NEX" }), NEX);
    expect(made.state.automations[0]).toMatchObject({ status: "draft", createdBy: "worker:nex", testMode: true });
    expect(must(made.state, { ...NEX, at: day(2), type: "automation.duplicate", automationId: made.id }).automations).toHaveLength(2);
    expect(step(made.state, { ...NEX, at: day(2), type: "automation.edit", automationId: made.id, input: blankInput({ name: "Mejor idea" }) }).error).toBeUndefined(); // its own draft
    const events: AutomationEvent[] = [
      { ...NEX, at: day(2), type: "automation.activate", automationId: made.id },
      { ...NEX, at: day(2), type: "automation.pause", automationId: made.id },
      { ...NEX, at: day(2), type: "automation.delete", automationId: made.id },
      { ...NEX, at: day(2), type: "automation.setTestMode", automationId: made.id, testMode: false },
      { ...NEX, at: day(2), type: "automation.test", automationId: made.id, payload: {} },
      { ...NEX, at: day(2), type: "automation.runManual", automationId: made.id, payload: {} },
      { ...NEX, at: day(2), type: "automation.killSwitch", paused: true },
      { ...NEX, at: day(2), type: "trigger.fire", kind: "manual", payload: {} },
      { ...NEX, at: day(2), type: "output.resolve", outputId: "ou_0001", resolution: "done" },
    ];
    for (const event of events) expect(step(made.state, event).errorCode, event.type).toBe("personRequired");
    const live1 = live(blankInput({ name: "En vivo" }), NOVA, made.state);
    expect(step(live1.state, { ...NEX, at: day(3), type: "automation.edit", automationId: live1.id, input: blankInput({ name: "Cambio de NEX" }) }).errorCode).toBe("notEditableByAi"); // not a live one
    expect(step(made.state, { tenantId: "tenant-nova", actor: "system", at: day(2), type: "automation.create", input: blankInput() }).errorCode).toBe("personRequired");
  });

  it("starts every automation in test mode: activating it does not make it create anything", () => {
    const made = created(blankInput({ trigger: "newClient", actions: [action("createTask", { titulo: "Revisar a {{nombre}}" })] }));
    const active = must(made.state, { ...NOVA, at: day(2), type: "automation.activate", automationId: made.id });
    expect(active.automations[0]).toMatchObject({ status: "active", testMode: true });
    const result = must(active, { ...SYSTEM, at: day(3), type: "trigger.fire", kind: "newClient", payload: SAMPLE_PAYLOADS.newClient });
    expect(result.runs[0]).toMatchObject({ status: "testLogged", mode: "test" });
    expect(result.runs[0].results[0].rendered.titulo).toBe("Revisar a Café Aurora"); // it shows what it would do
    expect(result.outputs).toHaveLength(0); // and does nothing
    expect(result.automations[0].runCount).toBe(0);
  });
});

describe("validation", () => {
  const issues = (over: Partial<AutomationInput>) => validateAutomation({ ...blankInput(), ...over });

  it("accepts a clean automation and names what is missing otherwise", () => {
    expect(issues({})).toEqual([]);
    expect(issues({ name: " " })[0]).toContain("nombre");
    expect(issues({ name: "x".repeat(81) })[0]).toContain("nombre");
    expect(issues({ description: "x".repeat(301) })[0]).toContain("descripción");
    expect(issues({ trigger: "nope" as never })).toEqual(["disparador"]);
    expect(issues({ actions: [] })[0]).toContain("al menos una acción");
    expect(issues({ actions: Array.from({ length: MAX_ACTIONS + 1 }, () => action("createTask", { titulo: "x" })) })[0]).toContain(`${MAX_ACTIONS}`);
    expect(issues({ actions: [{ kind: "sendEmail" as never, params: {} }] })[0]).toContain("tipo desconocido");
  });

  it("checks the conditions against the trigger's own fields", () => {
    const base = { trigger: "newProspect" as const, actions: [action("createTask", { titulo: "Llamar a {{nombre}}" })] };
    expect(issues({ ...base, conditions: [{ field: "puntaje", op: "greaterThan", value: "70" }] })).toEqual([]);
    expect(issues({ ...base, conditions: [{ field: "monto", op: "greaterThan", value: "70" }] })[0]).toContain("no existe en este disparador");
    expect(issues({ ...base, conditions: [{ field: "puntaje", op: "between" as never, value: "70" }] })[0]).toContain("operador");
    expect(issues({ ...base, conditions: [{ field: "puntaje", op: "equals", value: " " }] })[0]).toContain("valor");
    expect(issues({ ...base, conditions: Array.from({ length: MAX_CONDITIONS + 1 }, () => ({ field: "puntaje", op: "equals" as const, value: "1" })) })[0]).toContain(`${MAX_CONDITIONS}`);
    expect(issues({ trigger: "manual", conditions: [{ field: "loQueSea", op: "equals", value: "x" }] })).toEqual([]); // a manual run carries whatever the person types
  });

  it("checks each action's data: required, lengths, numbers, roles, recipients", () => {
    const one = (kind: Parameters<typeof action>[0], params: Record<string, string>, trigger: AutomationInput["trigger"] = "newProspect") => issues({ trigger, actions: [action(kind, params)] });
    expect(one("createTask", {})[0]).toContain("falta «titulo»");
    expect(one("createTask", { titulo: "x", enDias: "400" })[0]).toContain("0 a 365");
    expect(one("createTask", { titulo: "x", enDias: "abc" })[0]).toContain("0 a 365");
    expect(one("createTask", { titulo: "x", asignado: "jefe" })[0]).toContain("owner, admin, member, team");
    expect(one("createTask", { titulo: "x", extra: "y" })[0]).toContain("parámetro desconocido");
    expect(one("createReminder", { texto: "x", enHoras: "0" })[0]).toContain("1 a 8760");
    expect(one("notifyInternal", { texto: "x", para: "todos" })[0]).toContain("debe ser");
    expect(one("prepareEmail", { para: "no-es-correo", asunto: "a", cuerpo: "b" })[0]).toContain("correo del destinatario");
    expect(one("prepareEmail", { para: "ana@x.test", asunto: "a", cuerpo: "b" })).toEqual([]);
    expect(one("prepareWhatsapp", { para: "123", mensaje: "hola" })[0]).toContain("teléfono del destinatario");
    expect(one("prepareWhatsapp", { para: "+50688881234", mensaje: "hola" })).toEqual([]);
    expect(one("createPendingEvent", { titulo: "x" })[0]).toContain("falta «enDias»");
    expect(one("prepareEmail", { para: "{{correo}}", asunto: "a", cuerpo: "x".repeat(2_001) })[0]).toContain("supera 2000");
    expect(one("prepareEmail", { para: "mailto:{{correo}}", asunto: "a", cuerpo: "b" })[0]).toContain("un solo campo");
    for (const kind of ACTIONS) expect(ACTION_PARAMS[kind].length, kind).toBeGreaterThan(0);
  });

  it("only allows fields the trigger carries inside templates", () => {
    expect(issues({ trigger: "newClient", actions: [action("createTask", { titulo: "Cobrar {{monto}}" })] })[0]).toContain("«{{monto}}» no existe");
    expect(issues({ trigger: "manual", actions: [action("createTask", { titulo: "Revisar {{loQueSea}}" })] })).toEqual([]);
  });

  it("keeps contact data inside drafts: never in a task, a reminder, an internal notice or an event", () => {
    for (const field of CONTACT_FIELDS) {
      expect(issues({ trigger: "newProspect", actions: [action("createTask", { titulo: `Llamar a {{${field}}}` })] })[0], `task ${field}`).toContain("solo van en borradores");
      expect(issues({ trigger: "newProspect", actions: [action("notifyInternal", { texto: `Nuevo: {{${field}}}`, para: "admin" })] })[0], `notice ${field}`).toContain("solo van en borradores");
      expect(issues({ trigger: "newProspect", actions: [action("createReminder", { texto: `{{${field}}}`, enHoras: "5" })] })[0], `reminder ${field}`).toContain("solo van en borradores");
      expect(issues({ trigger: "newProspect", actions: [action("createPendingEvent", { titulo: `{{${field}}}`, enDias: "1" })] })[0], `event ${field}`).toContain("solo van en borradores");
    }
    expect(issues({ trigger: "newProspect", actions: [action("prepareEmail", { para: "{{correo}}", asunto: "Hola", cuerpo: "Su teléfono: {{telefono}}" })] })).toEqual([]); // drafts may carry it
    for (const trigger of Object.keys(TRIGGER_FIELDS) as (keyof typeof TRIGGER_FIELDS)[]) for (const field of TRIGGER_FIELDS[trigger]) expect(fieldLabel(field)).not.toBe("");
  });
});

describe("conditions and templates", () => {
  const rule = (field: string, op: Condition["op"], value: string): Condition[] => [{ field, op, value }];

  it("compares numbers as numbers and text without caring about case, and a missing field never matches", () => {
    const payload = { puntaje: "85", origen: "Formulario Web", monto: "1,200.50" };
    expect(matches(rule("puntaje", "greaterThan", "70"), payload)).toBe(true);
    expect(matches(rule("puntaje", "greaterThan", "100"), payload)).toBe(false);
    expect(matches(rule("puntaje", "lessThan", "100"), payload)).toBe(true);
    expect(matches(rule("monto", "greaterThan", "1000"), payload)).toBe(true);
    expect(matches(rule("origen", "equals", "formulario web"), payload)).toBe(true);
    expect(matches(rule("origen", "notEquals", "referido"), payload)).toBe(true);
    expect(matches(rule("origen", "contains", "WEB"), payload)).toBe(true);
    expect(matches(rule("nada", "equals", "x"), payload)).toBe(false);
    expect(matches(rule("nada", "notEquals", "x"), payload)).toBe(false); // a field the event lacks is not "different": it is unknown
    expect(matches(rule("origen", "greaterThan", "1"), payload)).toBe(false); // not a number: never guessed
    expect(matches([], payload)).toBe(true);
    expect(matches([...rule("puntaje", "greaterThan", "70"), ...rule("origen", "equals", "otro")], payload)).toBe(false); // all must hold
  });

  it("fills placeholders from the event, reports what is missing, and treats values as data", () => {
    expect(placeholdersOf("Hola {{nombre}} y {{ empresa }}")).toEqual(["nombre", "empresa"]);
    expect(renderTemplate("Hola {{nombre}}", { nombre: "Ana" })).toEqual({ text: "Hola Ana", missing: [] });
    expect(renderTemplate("Hola {{nombre}} de {{empresa}}", { nombre: "Ana" })).toEqual({ text: "Hola Ana de", missing: ["empresa"] });
    expect(renderTemplate("{{a}} {{a}}", {})).toEqual({ text: "", missing: ["a"] });
    const injected = renderTemplate("Hola {{nombre}}", { nombre: "{{correo}}", correo: "x@y.test" });
    expect(injected.text).toBe("Hola {{correo}}"); // a value is never expanded again
    expect(renderTemplate("{{nombre}}", { nombre: "a\u0000b\u0007c\nd" }).text).toBe("a b c\nd"); // control characters out
    expect(renderTemplate("{{nombre}}", { nombre: "x".repeat(900) }).text).toHaveLength(500);
  });
});

describe("authoring and lifecycle", () => {
  it("creates, edits (a live one pauses while it is edited), duplicates, pauses and deletes", () => {
    const made = live(prospect());
    expect(made.state.automations[0]).toMatchObject({ status: "active", testMode: false, version: 1 });
    const edited = must(made.state, { ...PABLO, at: day(2), type: "automation.edit", automationId: made.id, input: prospect({ name: "Prospecto muy caliente" }) });
    expect(edited.automations[0]).toMatchObject({ name: "Prospecto muy caliente", status: "paused", version: 2, testMode: false });
    expect(edited.audit.at(-1)?.detail).toContain("pausada para editar");
    const back = must(edited, { ...PABLO, at: day(2), type: "automation.activate", automationId: made.id });
    expect(back.automations[0].status).toBe("active");

    const copy = must(back, { ...PABLO, at: day(3), type: "automation.duplicate", automationId: made.id });
    expect(copy.automations[1]).toMatchObject({ name: "Prospecto muy caliente (copia)", status: "draft", testMode: true, version: 1, runCount: 0, createdBy: "pablo" });
    expect(copy.automations[1].actions).toEqual(copy.automations[0].actions);

    expect(step(copy, { ...NOVA, at: day(3), type: "automation.delete", automationId: made.id }).errorCode).toBe("activeCannotDelete");
    const paused = must(copy, { ...NOVA, at: day(3), type: "automation.pause", automationId: made.id });
    expect(step(paused, { ...NOVA, at: day(3), type: "automation.pause", automationId: made.id }).errorCode).toBe("invalidTransition");
    const gone = must(paused, { ...NOVA, at: day(3), type: "automation.delete", automationId: made.id });
    expect(gone.automations.map((item) => item.id)).toEqual([copy.automations[1].id]);
    expect(gone.audit.at(-1)).toMatchObject({ action: "automation.delete" });
  });

  it("will not activate or switch to live an automation that does not validate", () => {
    const made = created(blankInput({ actions: [] }));
    expect(step(made.state, { ...NOVA, at: day(2), type: "automation.activate", automationId: made.id }).errorCode).toBe("invalid");
    expect(step(made.state, { ...NOVA, at: day(2), type: "automation.setTestMode", automationId: made.id, testMode: false }).errorCode).toBe("invalid");
    expect(must(made.state, { ...NOVA, at: day(2), type: "automation.setTestMode", automationId: made.id, testMode: true }).automations[0].testMode).toBe(true);
    const ok = created();
    const active = must(ok.state, { ...NOVA, at: day(2), type: "automation.activate", automationId: ok.id });
    expect(step(active, { ...NOVA, at: day(2), type: "automation.activate", automationId: ok.id }).errorCode).toBe("invalidTransition");
    expect(step(ok.state, { ...NOVA, at: day(2), type: "automation.pause", automationId: ok.id }).errorCode).toBe("invalidTransition"); // a draft is not running
  });

  it("keeps what an automation did even after it is deleted", () => {
    const made = live(blankInput({ name: "Temporal", trigger: "newClient", actions: [action("createTask", { titulo: "Revisar a {{nombre}}" })] }));
    const ran = must(made.state, { ...SYSTEM, at: day(3), type: "trigger.fire", kind: "newClient", payload: SAMPLE_PAYLOADS.newClient });
    const paused = must(ran, { ...NOVA, at: day(4), type: "automation.pause", automationId: made.id });
    const gone = must(paused, { ...NOVA, at: day(4), type: "automation.delete", automationId: made.id });
    expect(gone.automations).toHaveLength(0);
    expect(gone.runs[0].automationName).toBe("Temporal");
    expect(gone.outputs).toHaveLength(1);
  });

  it("tests any automation with sample data, whatever its status, and never creates anything", () => {
    const made = created(prospect());
    const test = must(made.state, { ...NOVA, at: day(2), type: "automation.test", automationId: made.id, payload: SAMPLE_PAYLOADS.newProspect });
    expect(test.runs[0]).toMatchObject({ status: "testLogged", mode: "test" });
    expect(test.runs[0].results.map((result) => result.rendered.titulo ?? result.rendered.asunto)).toEqual(["Llamar a Marta Solís", "Hola Marta Solís"]);
    expect(test.outputs).toHaveLength(0);
    expect(test.automations[0].runCount).toBe(0);
    const bad = created(blankInput({ actions: [] }));
    expect(step(bad.state, { ...NOVA, at: day(2), type: "automation.test", automationId: bad.id, payload: {} }).errorCode).toBe("invalid");
  });
});

describe("running automations (simulated)", () => {
  it("creates what each action prepares, with the due dates computed from the event", () => {
    const made = live(blankInput({
      name: "Todo", trigger: "newProspect",
      actions: [
        action("createTask", { titulo: "Llamar a {{nombre}}", enDias: "1", asignado: "member" }),
        action("createReminder", { texto: "Seguir a {{nombre}}", enHoras: "48" }),
        action("notifyInternal", { texto: "Nuevo: {{nombre}}", para: "admin" }),
        action("prepareEmail", { para: "{{correo}}", asunto: "Hola {{nombre}}", cuerpo: "Gracias por escribir." }),
        action("prepareWhatsapp", { para: "{{telefono}}", mensaje: "Hola {{nombre}}" }),
        action("createPendingEvent", { titulo: "Reunión con {{nombre}}", enDias: "3" }),
      ],
    }));
    const ran = must(made.state, { ...SYSTEM, at: "2026-10-05T10:00:00.000Z", type: "trigger.fire", kind: "newProspect", payload: { ...SAMPLE_PAYLOADS.newProspect, telefono: "8888-1234" } });
    const byKind = Object.fromEntries(ran.outputs.map((item) => [item.kind, item]));
    expect(Object.keys(byKind).sort()).toEqual(["emailDraft", "notification", "pendingEvent", "reminder", "task", "whatsappDraft"]);
    expect(byKind.task).toMatchObject({ title: "Llamar a Marta Solís", to: "member", dueAt: "2026-10-06T10:00:00.000Z" });
    expect(byKind.reminder.dueAt).toBe("2026-10-07T10:00:00.000Z");
    expect(byKind.notification).toMatchObject({ title: "Nuevo: Marta Solís", to: "admin" });
    expect(byKind.emailDraft).toMatchObject({ to: "marta@clinica.test", title: "Hola Marta Solís", body: "Gracias por escribir.", status: "open" });
    expect(byKind.whatsappDraft.to).toBe("88881234"); // spaces and dashes out
    expect(byKind.pendingEvent.dueAt).toBe("2026-10-08T10:00:00.000Z");
    expect(ran.runs[0]).toMatchObject({ status: "completed", mode: "live" });
    expect(ran.runs[0].results.every((result) => result.level === 1)).toBe(true);
    expect(ran.automations[0]).toMatchObject({ runCount: 1, lastRunAt: "2026-10-05T10:00:00.000Z" });
  });

  it("marks a run with errors when an action cannot be prepared, but still prepares the others", () => {
    const made = live(prospect());
    const ran = must(made.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", payload: { nombre: "Camila", puntaje: "90" } });
    expect(ran.runs[0].status).toBe("failed");
    expect(ran.runs[0].results[0].outputId).toBeDefined();
    expect(ran.runs[0].results[1].error).toContain("falta «correo»");
    expect(ran.outputs).toHaveLength(1);
    const badAddress = must(made.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", payload: { nombre: "Camila", puntaje: "90", correo: "no-es-correo" } });
    expect(badAddress.runs[0].results[1].error).toContain("correo del destinatario no válido");
  });

  it("runs only active automations of the right trigger whose conditions hold", () => {
    const made = live(prospect());
    expect(must(made.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", payload: { ...SAMPLE_PAYLOADS.newProspect, puntaje: "50" } }).runs).toHaveLength(0);
    expect(must(made.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newClient", payload: SAMPLE_PAYLOADS.newClient }).runs).toHaveLength(0);
    expect(must(made.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", payload: { nombre: "Sin puntaje" } }).runs).toHaveLength(0);
    const paused = must(made.state, { ...NOVA, at: day(4), type: "automation.pause", automationId: made.id });
    expect(must(paused, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect }).runs).toHaveLength(0);
    const drafted = created(prospect());
    expect(must(drafted.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect }).runs).toHaveLength(0);
  });

  it("processes an event once, however many times it is delivered", () => {
    const made = live(prospect());
    const once = must(made.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", eventId: "evt-9", payload: SAMPLE_PAYLOADS.newProspect });
    const twice = must(once, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", eventId: "evt-9", payload: SAMPLE_PAYLOADS.newProspect });
    expect(twice.runs).toHaveLength(1);
    expect(twice.outputs).toHaveLength(once.outputs.length);
    expect(twice.audit.at(-1)?.action).toBe("trigger.duplicate");
    const noId = must(must(made.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect }), { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect });
    expect(noId.runs).toHaveLength(2); // without an id there is nothing to recognize it by
    const other = must(once, { tenantId: "tenant-vida", actor: "system", at: day(5), type: "trigger.fire", kind: "newProspect", eventId: "evt-9", payload: SAMPLE_PAYLOADS.newProspect });
    expect(other.audit.at(-1)?.action).toBe("trigger.fire"); // the same id in another company is another event
  });

  it("stops a flood: at most 60 runs per automation per hour, recording what it skipped", () => {
    const made = live(blankInput({ name: "Flood", trigger: "newClient", actions: [action("createTask", { titulo: "Revisar a {{nombre}}" })] }));
    let state = made.state;
    for (let index = 0; index < MAX_RUNS_PER_HOUR + 5; index += 1) state = must(state, { ...SYSTEM, at: `2026-10-05T10:${String(Math.floor(index / 2)).padStart(2, "0")}:00.000Z`, type: "trigger.fire", kind: "newClient", payload: SAMPLE_PAYLOADS.newClient });
    expect(state.runs.filter((run) => run.status === "completed")).toHaveLength(MAX_RUNS_PER_HOUR);
    expect(state.runs.filter((run) => run.status === "skipped")).toHaveLength(5);
    expect(state.runs.find((run) => run.status === "skipped")?.reason).toContain("límite");
    expect(state.outputs).toHaveLength(MAX_RUNS_PER_HOUR);
    const later = must(state, { ...SYSTEM, at: "2026-10-05T12:00:00.000Z", type: "trigger.fire", kind: "newClient", payload: SAMPLE_PAYLOADS.newClient });
    expect(later.runs.at(-1)?.status).toBe("completed"); // an hour later it runs again
  });

  it("cannot loop: what an automation creates never fires another one", () => {
    const first = live(blankInput({ name: "A", trigger: "newClient", actions: [action("createTask", { titulo: "Revisar a {{nombre}}" }), action("createPendingEvent", { titulo: "Reunión con {{nombre}}", enDias: "1" })] }));
    const second = live(blankInput({ name: "B", trigger: "meetingCreated", actions: [action("createTask", { titulo: "Preparar {{titulo}}" })] }), NOVA, first.state);
    const ran = must(second.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newClient", payload: SAMPLE_PAYLOADS.newClient });
    expect(ran.runs.map((run) => run.automationName)).toEqual(["A"]); // the pending event did not trigger "meeting created"
    expect(ran.outputs).toHaveLength(2);
    expect(ran.automations).toHaveLength(2);
  });

  it("accepts events from the platform or from a person simulating one, never from a Worker, and validates what they carry", () => {
    const made = live(prospect());
    expect(fireEvent(made.state, "newProspect", SAMPLE_PAYLOADS.newProspect, {}, day(5)).error).toBeUndefined();
    expect(step(made.state, { ...NOVA, at: day(5), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect }).error).toBeUndefined();
    expect(step(made.state, { ...NEX, at: day(5), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect }).errorCode).toBe("personRequired");
    expect(fireEvent(made.state, "newProspect", { inventado: "x" }).errorCode).toBe("triggerInvalid");
    expect(fireEvent(made.state, "newProspect", { "mal nombre": "x" }).errorCode).toBe("triggerInvalid");
    expect(fireEvent(made.state, "newProspect", { nombre: "x".repeat(2_001) }).errorCode).toBe("triggerInvalid");
    expect(fireEvent(made.state, "manual", Object.fromEntries(Array.from({ length: 21 }, (_, index) => [`campo${String.fromCharCode(97 + index)}`, "x"]))).errorCode).toBe("triggerInvalid");
    expect(fireEvent(made.state, "manual", { loQueSea: "x" }).error).toBeUndefined();
  });

  it("runs a manual automation by hand, only if it is manual and active; in test mode it only logs", () => {
    const manual = live(blankInput({ name: "Manual", trigger: "manual", actions: [action("createTask", { titulo: "Revisar {{tema}}" })] }));
    const ran = must(manual.state, { ...NOVA, at: day(5), type: "automation.runManual", automationId: manual.id, payload: { tema: "inventario" } });
    expect(ran.outputs[0].title).toBe("Revisar inventario");
    const prospectLive = live(prospect(), NOVA, manual.state);
    expect(step(prospectLive.state, { ...NOVA, at: day(5), type: "automation.runManual", automationId: prospectLive.id, payload: {} }).errorCode).toBe("notManual");
    const draft = created(blankInput({ trigger: "manual" }));
    expect(step(draft.state, { ...NOVA, at: day(5), type: "automation.runManual", automationId: draft.id, payload: {} }).errorCode).toBe("notActive");
    const testing = must(manual.state, { ...NOVA, at: day(5), type: "automation.setTestMode", automationId: manual.id, testMode: true });
    expect(must(testing, { ...NOVA, at: day(5), type: "automation.runManual", automationId: manual.id, payload: { tema: "x" } }).outputs).toHaveLength(0);
  });

  it("can be stopped for the whole company at once by a person, without affecting another company", () => {
    const made = live(prospect());
    const other = live(prospect({ name: "Otra" }), VIDA, made.state);
    const stopped = must(other.state, { ...PABLO, at: day(5), type: "automation.killSwitch", paused: true });
    expect(step(stopped, { ...SYSTEM, at: day(6), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect }).errorCode).toBe("tenantPaused");
    expect(step(stopped, { ...NOVA, at: day(6), type: "automation.runManual", automationId: made.id, payload: {} }).errorCode).toBe("tenantPaused");
    expect(must(stopped, { tenantId: "tenant-vida", actor: "system", at: day(6), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect }).runs).toHaveLength(1); // Vida still runs
    const resumed = must(stopped, { ...PABLO, at: day(7), type: "automation.killSwitch", paused: false });
    expect(must(resumed, { ...SYSTEM, at: day(7), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect }).runs.length).toBeGreaterThan(0);
  });
});

describe("results", () => {
  it("are resolved only by a person of the same company, once", () => {
    const state = demoAutomationsOk();
    const open = state.outputs.find((item) => item.status === "open");
    const id = open?.id ?? "";
    expect(step(state, { ...NEX, at: day(9), type: "output.resolve", outputId: id, resolution: "done" }).errorCode).toBe("personRequired");
    expect(step(state, { ...VIDA, at: day(9), type: "output.resolve", outputId: id, resolution: "done" }).errorCode).toBe("notYours");
    expect(step(state, { ...NOVA, at: day(9), type: "output.resolve", outputId: "nope", resolution: "done" }).errorCode).toBe("outputNotFound");
    const dismissed = must(state, { ...NOVA, at: day(9), type: "output.resolve", outputId: id, resolution: "dismissed" });
    expect(dismissed.outputs.find((item) => item.id === id)).toMatchObject({ status: "dismissed", resolvedBy: "ana" });
    expect(step(dismissed, { ...NOVA, at: day(9), type: "output.resolve", outputId: id, resolution: "done" }).errorCode).toBe("outputResolved");
  });
});

describe("one company never sees or changes another's automations", () => {
  it("refuses every change on another company's automation, and scopes the views", () => {
    const state = demoAutomationsOk();
    const novaId = automationsOf(state, "tenant-nova")[0].id;
    const events: AutomationEvent[] = [
      { ...VIDA, at: day(9), type: "automation.edit", automationId: novaId, input: blankInput() },
      { ...VIDA, at: day(9), type: "automation.duplicate", automationId: novaId },
      { ...VIDA, at: day(9), type: "automation.activate", automationId: novaId },
      { ...VIDA, at: day(9), type: "automation.pause", automationId: novaId },
      { ...VIDA, at: day(9), type: "automation.delete", automationId: novaId },
      { ...VIDA, at: day(9), type: "automation.setTestMode", automationId: novaId, testMode: true },
      { ...VIDA, at: day(9), type: "automation.test", automationId: novaId, payload: {} },
      { ...VIDA, at: day(9), type: "automation.runManual", automationId: novaId, payload: {} },
    ];
    for (const event of events) expect(step(state, event).errorCode, event.type).toBe("notYours");
    expect(automationsOf(state, "tenant-vida").map((item) => item.name)).toEqual(["Aviso de formulario"]);
    expect(runsOf(state, "tenant-vida")).toHaveLength(1);
    expect(outputsOf(state, "tenant-vida")).toHaveLength(1);
    expect(automationStats(state, "tenant-vida").openOutputs.notification).toBe(1);
    expect(automationStats(state, "tenant-unknown").automations).toEqual({ draft: 0, active: 0, paused: 0 });
  });

  it("runs an event only for the company it belongs to", () => {
    const made = live(prospect());
    const both = live(prospect({ name: "De Vida" }), VIDA, made.state);
    const ran = must(both.state, { ...SYSTEM, at: day(5), type: "trigger.fire", kind: "newProspect", payload: SAMPLE_PAYLOADS.newProspect });
    expect(ran.runs.map((run) => run.tenantId)).toEqual(["tenant-nova"]);
    expect(ran.outputs.every((output) => output.tenantId === "tenant-nova")).toBe(true);
  });
});

describe("nothing is ever trimmed", () => {
  it("keeps every run, output, audit entry and log line, however many there are", () => {
    const made = live(blankInput({ name: "Muchas", trigger: "newClient", actions: [action("createTask", { titulo: "Revisar a {{nombre}}" })] }));
    let state = made.state;
    for (let index = 0; index < 300; index += 1) state = must(state, { ...SYSTEM, at: new Date(Date.parse("2026-10-05T00:00:00.000Z") + index * 2 * 3_600_000).toISOString(), type: "trigger.fire", kind: "newClient", payload: SAMPLE_PAYLOADS.newClient });
    expect(state.runs).toHaveLength(300);
    expect(state.outputs).toHaveLength(300);
    expect(state.audit.length).toBeGreaterThan(600);
    expect(state.logs.length).toBeGreaterThan(600);
    expect(state.audit[0].action).toBe("automation.create"); // the first thing that ever happened is still there
  });
});

describe("language", () => {
  it("has a message for every error code, no placeholder left, and a label for every group", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x", from: "a", to: "b" }), code).not.toMatch(/\{\w+\}/);
    expect(label("status", "paused")).toBe("Pausada");
    expect(label("runStatus", "testLogged")).toContain("no creó nada");
    expect(label("outputKind", "emailDraft")).toBe("Borrador de correo");
    expect(fieldLabel("puntaje")).toBe("Puntaje");
    expect(fieldLabel("campoLibre")).toBe("campoLibre");
    expect(message("invalid", { detail: "nombre" })).toBe("La automatización no es válida: nombre.");
  });
});
