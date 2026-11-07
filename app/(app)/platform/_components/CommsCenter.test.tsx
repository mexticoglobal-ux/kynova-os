import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CommsCenter } from "./CommsCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const kpi = (name: string) => within(screen.getByLabelText(name, { selector: "div" }));
const row = (name: string) => within(screen.getByLabelText(`Conversación ${name}`));
const press = (scope: ReturnType<typeof within>, name: string | RegExp) => fireEvent.click(scope.getByRole("button", { name }));
const openConversation = (name: string) => press(row(name), "Abrir");
const pick = (conversationName: string) => { const select = screen.getByRole("combobox", { name: "Conversación" }) as unknown as HTMLSelectElement; const option = Array.from(select.options).find((item) => item.textContent?.startsWith(conversationName)); fireEvent.change(select, { target: { value: option?.value ?? "" } }); };

describe("CommsCenter", () => {
  it("opens on one unified inbox with a card per conversation across every channel", () => {
    render(<CommsCenter />);
    expect(screen.getByText(/no se envía ningún mensaje ni se conecta ningún proveedor/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Bandeja unificada" })).getAllByRole("listitem")).toHaveLength(10);
    for (const name of ["Conversaciones", "Esperando respuesta", "Sin responsable", "Críticas", "Espera promedio"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    for (const channel of ["Email", "WhatsApp", "Facebook Messenger", "Instagram Direct", "Chat Web", "Formulario Web"]) expect(within(screen.getByRole("list", { name: "Bandeja unificada" })).getAllByText(channel).length, channel).toBeGreaterThan(0);
    const first = within(screen.getByRole("list", { name: "Bandeja unificada" })).getAllByRole("listitem")[0];
    expect(first.textContent).toContain("Luis Prado");
    expect(first.textContent).toContain("Prioridad Crítica");
  });

  it("shows on every card the customer, company, channel, state, owner, priority, waiting time, last activity and labels", () => {
    render(<CommsCenter />);
    const marta = row("Marta Solís");
    expect(marta.getByText("Clínica Dental Sol", { exact: false })).toBeTruthy();
    expect(marta.getByText("Email")).toBeTruthy();
    expect(marta.getByText("Abierta")).toBeTruthy();
    expect(marta.getByText(/Responsable: ana/)).toBeTruthy();
    expect(marta.getByText(/^Prioridad /)).toBeTruthy();
    expect(marta.getByText("Espera 2 h 10 min")).toBeTruthy();
    expect(marta.getByText(/Última actividad/)).toBeTruthy();
    expect(marta.getByText("#seguimiento")).toBeTruthy();
    expect(marta.getByText(/KOE recomienda/)).toBeTruthy();
    expect(row("Visitante 213").getByText(/Responsable: Sin responsable/)).toBeTruthy();
  });

  it("filters by channel, state, responsible, label and text", () => {
    render(<CommsCenter />);
    const count = () => within(screen.getByRole("list", { name: "Bandeja unificada" })).queryAllByRole("listitem").length;
    fireEvent.change(screen.getByLabelText("Canal"), { target: { value: "whatsapp" } });
    expect(count()).toBe(2);
    fireEvent.change(screen.getByLabelText("Canal"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "archived" } });
    expect(count()).toBe(1);
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Responsable"), { target: { value: "unassigned" } });
    expect(row("Elena Vargas")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Responsable"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "COTIZACION" } });
    expect(row("Marta Solís")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "no existe nada así" } });
    expect(screen.getByText("No hay conversaciones con esos filtros.")).toBeTruthy();
  });

  it("opens a conversation with its data, the customer's messages, notes and the customer context from the CRM", () => {
    render(<CommsCenter />);
    openConversation("Marta Solís");
    const data = within(screen.getByLabelText("Datos de la conversación"));
    expect(data.getByText("Marta Solís")).toBeTruthy();
    expect(data.getByText(/Responsable: ana/)).toBeTruthy();
    expect(data.getByText(/Tiempo de espera: 2 h 10 min/)).toBeTruthy();
    const thread = within(screen.getByRole("list", { name: "Mensajes" }));
    expect(thread.getByText(/cotización final con los precios/)).toBeTruthy();
    expect(thread.getByText(/respuesta enviada fuera de la plataforma/, { exact: false })).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Notas internas" })).getByText(/descuento del 5 %/)).toBeTruthy();
    expect(screen.getByText(/Nunca las ve el cliente/)).toBeTruthy();
    expect(within(screen.getByLabelText("Pipeline del cliente")).getByText(/etapa/)).toBeTruthy();
    expect(within(screen.getByLabelText("Business Audit del cliente")).getByText(/ajuste \d+\/100/)).toBeTruthy();
    expect(screen.getByText(/Se consulta al CRM de KOE; no se copia aquí/)).toBeTruthy();
  });

  it("shows the Customer 360 of a customer: payments, products, Academy, Marketplace, referrals, Workers and automations", () => {
    render(<CommsCenter />);
    openConversation("Elena Vargas");
    const c360 = within(screen.getByLabelText("Customer 360"));
    expect(c360.getByText(/Studio Verde/)).toBeTruthy();
    expect(c360.getByText("US$ 3 500.00")).toBeTruthy();
    for (const kind of ["Pagos", "Productos", "Academia", "Marketplace", "Referidos", "Workers", "Automatizaciones"]) expect(c360.getByText(`${kind}:`), kind).toBeTruthy();
    expect(c360.getByText(/Pago de implementación/)).toBeTruthy();
  });

  it("adds an internal note as a person, and never as NEX", () => {
    render(<CommsCenter />);
    openConversation("Visitante 213");
    fireEvent.change(screen.getByLabelText("Nota interna"), { target: { value: "Verificar el cobro con finanzas" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar nota" }));
    expect(within(screen.getByRole("list", { name: "Notas internas" })).getByText(/Verificar el cobro con finanzas/)).toBeTruthy();
    actAs("nex");
    fireEvent.change(screen.getByLabelText("Nota interna"), { target: { value: "Nota de NEX" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar nota" }));
    expect(alertText()).toContain("NEX solo puede preparar");
  });

  it("records a reply a person sent outside the platform, and says plainly that nothing is sent from here", () => {
    render(<CommsCenter />);
    openConversation("Carlos Mena");
    expect(screen.getByText(/La plataforma no envía nada/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Respuesta enviada"), { target: { value: "El plan anual cuesta 500 USD." } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar respuesta enviada" }));
    expect(within(screen.getByRole("list", { name: "Mensajes" })).getByText(/El plan anual cuesta 500 USD/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Enviar/ })).toBeNull();
  });

  it("shows one omnichannel timeline with channels, notes, Workers, automations, Business Audit and the CRM in order", () => {
    render(<CommsCenter />);
    openConversation("Marta Solís");
    tab("Línea de tiempo");
    const items = within(screen.getByRole("list", { name: "Línea de tiempo omnicanal" })).getAllByRole("listitem");
    const text = items.map((item) => item.textContent ?? "");
    for (const kind of ["Correo", "Nota interna", "Worker", "Automatización", "Business Audit", "Enrutamiento de KOE", "Asignación"]) expect(text.some((entry) => entry.includes(kind)), kind).toBe(true);
    expect(text.some((entry) => entry.includes("CRM"))).toBe(true);
    const times = text.map((entry) => entry.slice(0, 16));
    expect(times).toEqual([...times].sort());
  });

  it("shows the Draft Center: drafts per channel, never sent, with every revision kept and only a person deciding", () => {
    render(<CommsCenter />);
    tab("Borradores");
    expect(screen.getByText(/Nunca se envían/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Borradores" })).getAllByLabelText(/^Borrador /)).toHaveLength(4);
    const email = within(screen.getByLabelText("Borrador Marta Solís Correo"));
    expect(email.getByText(/Lista para que una persona la envíe/)).toBeTruthy();
    expect(email.getByText(/Revisiones \(1\)/)).toBeTruthy();
    const whatsapp = within(screen.getByLabelText("Borrador Elena Vargas WhatsApp"));
    fireEvent.change(whatsapp.getByLabelText("Texto del borrador de Elena Vargas"), { target: { value: "Hola Elena, ya lo estamos revisando con el equipo técnico." } });
    press(whatsapp, "Guardar como nueva revisión");
    expect(within(screen.getByLabelText("Borrador Elena Vargas WhatsApp")).getByText(/Revisiones \(2\)/)).toBeTruthy();
    actAs("nex");
    press(within(screen.getByLabelText("Borrador Elena Vargas WhatsApp")), "Marcar como lista");
    expect(alertText()).toContain("NEX solo puede preparar");
    actAs("nova-ana");
    press(within(screen.getByLabelText("Borrador Elena Vargas WhatsApp")), "Marcar como lista");
    expect(within(screen.getByLabelText("Borrador Elena Vargas WhatsApp")).getByText(/La plataforma no la envía/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Enviar/ })).toBeNull();
  });

  it("lets NEX prepare a draft for the chosen conversation", () => {
    render(<CommsCenter />);
    tab("Borradores");
    actAs("nex");
    fireEvent.change(screen.getByLabelText("Conversación del borrador"), { target: { value: (screen.getByLabelText("Conversación del borrador") as unknown as HTMLSelectElement).querySelector("option")?.value ?? "" } });
    fireEvent.click(screen.getByRole("button", { name: "Preparar borrador" }));
    expect(within(screen.getByRole("list", { name: "Borradores" })).getAllByLabelText(/^Borrador /)).toHaveLength(5);
  });

  it("assigns, marks pending, resolves, archives and reopens, with a history; resolving is never NEX's", () => {
    render(<CommsCenter />);
    tab("Asignaciones");
    pick("Visitante 213");
    fireEvent.change(screen.getByLabelText("Responsable nuevo"), { target: { value: "pablo" } });
    expect(within(screen.getByLabelText("Asignación")).getByText(/Responsable: pablo/)).toBeTruthy();
    press(within(screen.getByLabelText("Asignación")), "Marcar pendiente");
    press(within(screen.getByLabelText("Asignación")), "Marcar resuelta");
    press(within(screen.getByLabelText("Asignación")), "Archivar");
    press(within(screen.getByLabelText("Asignación")), "Reabrir");
    const history = within(screen.getByRole("list", { name: "Historial de asignaciones" })).getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(history).toHaveLength(5);
    expect(history[0]).toContain("asignó la conversación a pablo (antes: nadie)");
    expect(history[4]).toContain("de «archivada» a «abierta»");
    actAs("nex");
    press(within(screen.getByLabelText("Asignación")), "Marcar resuelta");
    expect(alertText()).toContain("NEX solo puede preparar");
    press(within(screen.getByLabelText("Asignación")), "Archivar");
    expect(alertText()).toContain("NEX solo puede preparar");
  });

  it("lets NEX reassign only with a vigente authorization", () => {
    render(<CommsCenter />);
    tab("Asignaciones");
    pick("Visitante 213");
    actAs("nex");
    fireEvent.change(screen.getByLabelText("Responsable nuevo"), { target: { value: "ana" } });
    expect(within(screen.getByLabelText("Asignación")).getByText(/Responsable: ana/)).toBeTruthy(); // the sample has a vigente authorization
    actAs("nova-ana");
    fireEvent.click(screen.getByRole("button", { name: "Revocar autorización" }));
    expect(screen.getByText("Sin autorización")).toBeTruthy();
    actAs("nex");
    fireEvent.change(screen.getByLabelText("Responsable nuevo"), { target: { value: "pablo" } });
    expect(alertText()).toContain("necesita una autorización vigente");
  });

  it("shows Conversation Intelligence: urgency, simulated sentiment, intent, category, probabilities, wait, next best action and why", () => {
    render(<CommsCenter />);
    tab("Inteligencia");
    pick("Marta Solís");
    for (const name of ["Urgencia", "Sentimiento (simulado)", "Intención", "Categoría", "Probabilidad de venta", "Probabilidad de soporte", "Tiempo de espera", "Próxima mejor acción"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(kpi("Intención").getByText("Quiere comprar")).toBeTruthy();
    expect(kpi("Categoría").getByText("Ventas")).toBeTruthy();
    expect(kpi("Tiempo de espera").getByText("2 h 10 min")).toBeTruthy();
    expect(within(screen.getByLabelText("Motivo de la recomendación")).getByText(/el sentimiento es una estimación simulada/)).toBeTruthy();
    pick("Luis Prado");
    expect(kpi("Urgencia").getByText("Crítica")).toBeTruthy();
    expect(kpi("Próxima mejor acción").getByText("Asignar")).toBeTruthy();
  });

  it("shows what KOE decided: Worker, specialty, priority, model and why; classifying adds to the history", () => {
    render(<CommsCenter />);
    tab("Inteligencia");
    pick("Visitante 213");
    const routing = within(screen.getByLabelText("Enrutamiento de KOE"));
    expect(routing.getByText("Cobranza")).toBeTruthy();
    expect(routing.getByText("collections")).toBeTruthy();
    expect(routing.getByText("Rápido A")).toBeTruthy();
    expect(routing.getByText(/Categoría «billing» → especialidad «collections»/)).toBeTruthy();
    const count = () => within(screen.getByRole("list", { name: "Historial de enrutamiento" })).getAllByRole("listitem").length;
    const before = count();
    fireEvent.click(routing.getAllByRole("button", { name: "Clasificar y enrutar con KOE" })[0]);
    expect(count()).toBe(before + 1);
    expect(screen.getByText(/nunca se sobrescribe/)).toBeTruthy();
  });

  it("receives a simulated customer message through the platform, routes it, and refuses SMS", () => {
    render(<CommsCenter />);
    fireEvent.change(screen.getByLabelText("Nombre del cliente simulado"), { target: { value: "Visitante 777" } });
    fireEvent.change(screen.getByLabelText("Texto del mensaje simulado"), { target: { value: "Quiero cancelar, es urgente" } });
    fireEvent.click(screen.getByRole("button", { name: "Recibir mensaje (plataforma)" }));
    expect(within(screen.getByRole("list", { name: "Bandeja unificada" })).getAllByRole("listitem")).toHaveLength(11);
    expect(row("Visitante 777").getByText("Chat Web")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Canal del mensaje simulado"), { target: { value: "sms" } });
    fireEvent.click(screen.getByRole("button", { name: "Recibir mensaje (plataforma)" }));
    expect(alertText()).toContain("arquitectura futura");
  });

  it("declares the future connectors without building them", () => {
    render(<CommsCenter />);
    const future = within(screen.getByRole("list", { name: "Conectores futuros" }));
    for (const name of ["WhatsApp Business API", "Meta Messenger", "Instagram Graph", "Gmail", "Microsoft 365", "Twilio", "Telefonía", "Video llamadas"]) expect(future.getByText(name)).toBeTruthy();
    expect(future.getAllByText("No construido")).toHaveLength(8);
    expect(screen.getByText(/nunca directo a un proveedor/)).toBeTruthy();
  });

  it("keeps each company apart, and never names a provider in the interface", () => {
    render(<CommsCenter />);
    actAs("vida-lucia");
    expect(within(screen.getByRole("list", { name: "Bandeja unificada" })).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByLabelText("Conversación Marta Solís")).toBeNull();
    for (const name of ["Bandeja", "Conversación", "Línea de tiempo", "Borradores", "Asignaciones", "Inteligencia"]) {
      tab(name);
      expect(document.body.textContent ?? "", name).not.toMatch(/proveedor-|openai|anthropic|gemini|mistral/i);
    }
  });
});
