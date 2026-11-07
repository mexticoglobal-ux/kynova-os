// Sample data for the local simulation of the Automations Center. Fictional companies, people and events. It is built by
// applying events through the same reducer a real adapter will use, so loading it also proves the rules hold together.

import { newAutomationState, reduceAutomations, type AutomationEvent, type AutomationInput, type AutomationState, type ActionSpec, type ActionKind, type TriggerKind } from "./automation-center";

export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
] as const;

// Who the simulation can act as. "worker:nex" is NEX: it may leave a draft and nothing else.
export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana", tenantId: "tenant-nova", actor: "ana" },
  { id: "nova-pablo", label: "Nova · Pablo", tenantId: "tenant-nova", actor: "pablo" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía", tenantId: "tenant-vida", actor: "lucia" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex" },
] as const;

/** Example data for each event, so the simulator and the "test" button have something realistic to start from. */
export const SAMPLE_PAYLOADS: Record<TriggerKind, Record<string, string>> = {
  newProspect: { nombre: "Marta Solís", empresa: "Clínica Vida", correo: "marta@clinica.test", telefono: "88881234", puntaje: "85", origen: "Formulario web" },
  newClient: { nombre: "Café Aurora", empresa: "Café Aurora S.A.", correo: "hola@aurora.test", telefono: "88885678" },
  paymentReceived: { cliente: "Hotel Mar", monto: "900.00", moneda: "USD", metodo: "Transferencia", referencia: "NOVA-0004" },
  meetingCreated: { titulo: "Revisión de la propuesta", fecha: "2026-11-12", contacto: "Luis Prado", correo: "luis@nova.test" },
  formSubmitted: { formulario: "Contacto", nombre: "Carla Mena", correo: "carla@nova.test", mensaje: "Quisiera saber el precio del plan anual" },
  manual: { tema: "inventario" },
};

export const action = (kind: ActionKind, params: Record<string, string>): ActionSpec => ({ kind, params });
export const blankInput = (over: Partial<AutomationInput> = {}): AutomationInput => ({
  name: "Automatización de ejemplo", description: "", trigger: "manual", conditions: [], actions: [action("createTask", { titulo: "Revisar {{tema}}" })], workerId: "automator", ...over,
});

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;

export function demoAutomationState(): { state: AutomationState; errors: string[] } {
  const errors: string[] = [];
  let state = newAutomationState();
  const send = (event: AutomationEvent) => {
    const result = reduceAutomations(state, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const nova = { tenantId: "tenant-nova", actor: "ana" };
  const pablo = { tenantId: "tenant-nova", actor: "pablo" };
  const vida = { tenantId: "tenant-vida", actor: "lucia" };
  const system = (tenantId: string) => ({ tenantId, actor: "system" });
  const id = (name: string) => state.automations.find((item) => item.name === name)?.id ?? "";
  const live = (who: { tenantId: string; actor: string }, name: string, at: number) => {
    send({ ...who, at: day(at), type: "automation.activate", automationId: id(name) });
    send({ ...who, at: day(at), type: "automation.setTestMode", automationId: id(name), testMode: false });
  };

  send({ ...nova, at: day(1), type: "automation.create", input: blankInput({
    name: "Prospecto caliente", description: "Cuando entra un prospecto con puntaje alto, avisar y preparar el primer correo.", trigger: "newProspect",
    conditions: [{ field: "puntaje", op: "greaterThan", value: "70" }],
    actions: [
      action("createTask", { titulo: "Llamar a {{nombre}} ({{empresa}})", enDias: "1" }),
      action("notifyInternal", { texto: "Nuevo prospecto caliente: {{nombre}} ({{empresa}}), puntaje {{puntaje}}", para: "admin" }),
      action("prepareEmail", { para: "{{correo}}", asunto: "Gracias por su interés, {{nombre}}", cuerpo: "Hola {{nombre}}, recibimos su solicitud y le escribiremos pronto." }),
    ],
  }) });
  send({ ...nova, at: day(1), type: "automation.create", input: blankInput({
    name: "Bienvenida al cliente nuevo", trigger: "newClient",
    actions: [action("prepareWhatsapp", { para: "{{telefono}}", mensaje: "Hola {{nombre}}, ¡bienvenido a bordo! Estamos para lo que necesite." }), action("createReminder", { texto: "Revisar el primer mes de {{nombre}}", enHoras: "720" })],
  }) });
  send({ ...nova, at: day(1), type: "automation.create", input: blankInput({
    name: "Cobro recibido", trigger: "paymentReceived",
    actions: [action("createTask", { titulo: "Conciliar el pago de {{cliente}}" }), action("notifyInternal", { texto: "Pago recibido de {{cliente}}: {{monto}} {{moneda}}", para: "owner" })],
  }) });
  send({ ...nova, at: day(1), type: "automation.create", input: blankInput({
    name: "Revisión manual", trigger: "manual", actions: [action("createTask", { titulo: "Revisar {{tema}}", asignado: "member" })],
  }) });
  send({ ...nova, at: day(1), type: "automation.create", input: blankInput({
    name: "Formulario web: precios", trigger: "formSubmitted", conditions: [{ field: "mensaje", op: "contains", value: "precio" }],
    actions: [action("prepareEmail", { para: "{{correo}}", asunto: "Sobre su consulta de precios", cuerpo: "Hola {{nombre}}, le compartimos nuestra lista de precios en breve." }), action("notifyInternal", { texto: "Consulta de precios de {{nombre}}", para: "team" })],
  }) });
  // a draft left by NEX (Level 1): it cannot activate it, and it did not pick a Worker, so it waits for one ("Configuración pendiente")
  send({ tenantId: "tenant-nova", actor: "worker:nex", at: day(2), type: "automation.create", input: blankInput({
    name: "Preparar la reunión", description: "Borrador de NEX: dejar un evento pendiente cuando se crea una reunión.", trigger: "meetingCreated",
    actions: [action("createPendingEvent", { titulo: "Preparar: {{titulo}}", enDias: "0" })], workerId: undefined,
  }) });
  send({ ...vida, at: day(1), type: "automation.create", input: blankInput({ name: "Aviso de formulario", trigger: "formSubmitted", actions: [action("notifyInternal", { texto: "Nuevo formulario de {{nombre}}", para: "team" })] }) });

  live(nova, "Prospecto caliente", 3);
  live(nova, "Bienvenida al cliente nuevo", 3);
  live(nova, "Cobro recibido", 3);
  send({ ...nova, at: day(3), type: "automation.activate", automationId: id("Revisión manual") }); // active but still in test mode
  live(nova, "Formulario web: precios", 3);
  live(vida, "Aviso de formulario", 3);
  send({ ...pablo, at: day(4), type: "automation.pause", automationId: id("Cobro recibido") });

  // events: some match, some do not, one repeats, one lacks data
  send({ ...system("tenant-nova"), at: day(5), type: "trigger.fire", kind: "newProspect", eventId: "evt-1", payload: SAMPLE_PAYLOADS.newProspect });
  send({ ...system("tenant-nova"), at: day(5), type: "trigger.fire", kind: "newProspect", eventId: "evt-2", payload: { ...SAMPLE_PAYLOADS.newProspect, nombre: "Pedro Gómez", puntaje: "40" } }); // below the threshold: nothing runs
  send({ ...system("tenant-nova"), at: day(5), type: "trigger.fire", kind: "newClient", eventId: "evt-3", payload: SAMPLE_PAYLOADS.newClient });
  send({ ...system("tenant-nova"), at: day(6), type: "trigger.fire", kind: "paymentReceived", eventId: "evt-4", payload: SAMPLE_PAYLOADS.paymentReceived }); // paused: nothing runs
  send({ ...system("tenant-nova"), at: day(6), type: "trigger.fire", kind: "formSubmitted", eventId: "evt-5", payload: SAMPLE_PAYLOADS.formSubmitted });
  send({ ...system("tenant-nova"), at: day(6), type: "trigger.fire", kind: "newProspect", eventId: "evt-1", payload: SAMPLE_PAYLOADS.newProspect }); // the same event again: processed once
  send({ ...system("tenant-nova"), at: day(7), type: "trigger.fire", kind: "newProspect", eventId: "evt-7", payload: { nombre: "Camila Rojas", empresa: "Rojas y Cía", telefono: "88889999", puntaje: "90", origen: "Referido" } }); // no email: that action cannot be prepared
  send({ ...system("tenant-vida"), at: day(7), type: "trigger.fire", kind: "formSubmitted", eventId: "evt-6", payload: SAMPLE_PAYLOADS.formSubmitted });
  send({ ...nova, at: day(7), type: "automation.runManual", automationId: id("Revisión manual"), payload: { tema: "inventario" } }); // test mode: it only logs
  send({ ...nova, at: day(7), type: "automation.test", automationId: id("Revisión manual"), payload: SAMPLE_PAYLOADS.manual });
  send({ ...pablo, at: day(8), type: "output.resolve", outputId: state.outputs.find((item) => item.kind === "task")?.id ?? "", resolution: "done" });
  return { state, errors };
}

export const demoAutomationsOk = (): AutomationState => {
  const { state, errors } = demoAutomationState();
  if (errors.length) throw new Error(errors.join("; "));
  return state;
};
