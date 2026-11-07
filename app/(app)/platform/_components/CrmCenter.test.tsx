import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CrmCenter } from "./CrmCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const kpi = (name: string) => within(screen.getByLabelText(name, { selector: "div" }));
const card = (name: string) => within(screen.getByLabelText(`Tarjeta ${name}`));
const column = (name: string) => within(screen.getByLabelText(`Columna ${name}`));
const press = (scope: ReturnType<typeof within>, name: string | RegExp) => fireEvent.click(scope.getByRole("button", { name }));
const open = (lead: string) => { tab("Pipeline"); press(card(lead), "Ver"); };

describe("CrmCenter", () => {
  it("opens on the commercial dashboard with every figure asked for", () => {
    render(<CrmCenter />);
    expect(screen.getByText(/KOE analiza y recomienda; NEX solo prepara/)).toBeTruthy();
    for (const name of ["Prospectos nuevos", "Prospectos activos", "Oportunidades", "Clientes", "Ventas estimadas", "Conversión"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(kpi("Prospectos activos").getByText("5")).toBeTruthy();
    expect(kpi("Clientes").getByText("2")).toBeTruthy();
    expect(kpi("Conversión").getByText("25.0 %")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Próximas acciones" })).getAllByRole("listitem")).toHaveLength(5);
    expect(within(screen.getByRole("list", { name: "Reuniones" })).getByText(/Reunión de diagnóstico con Taller Rápido/)).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Actividad reciente" })).getAllByRole("listitem")).toHaveLength(8);
  });

  it("shows the Kanban: seven stages, and on every card both scores, next action, value, time in stage, risk and owner", () => {
    render(<CrmCenter />);
    tab("Pipeline");
    for (const stage of ["Prospecto", "Calificado", "Reunión", "Propuesta", "Negociación", "Ganado", "Perdido"]) expect(screen.getByLabelText(`Columna ${stage}`), stage).toBeTruthy();
    const marta = card("Marta Solís");
    expect(marta.getByText(/^Lead \d+/)).toBeTruthy();
    expect(marta.getByText(/^Oportunidad \d+/)).toBeTruthy();
    expect(marta.getByText(/^Riesgo /)).toBeTruthy();
    expect(marta.getByText(/Valor US\$ 4 800.00/)).toBeTruthy();
    expect(marta.getByText(/9 días en la etapa · Responsable: ana/)).toBeTruthy();
    expect(marta.getByText(/Llamar/)).toBeTruthy();
    expect(column("Negociación").getByText("Marta Solís")).toBeTruthy();
    expect(card("Luis Prado").getByText("Riesgo Crítico")).toBeTruthy();
    expect(card("Pedro Gómez").getByText(/Responsable: Sin asignar/)).toBeTruthy();
  });

  it("lets a person move a stage, lose a deal with a reason, win a deal and reopen a lost one", () => {
    render(<CrmCenter />);
    tab("Pipeline");
    press(card("Pedro Gómez"), "Mover a Calificado");
    expect(column("Calificado").getByText("Pedro Gómez")).toBeTruthy();
    press(card("Luis Prado"), "Marcar perdido");
    expect(alertText()).toContain("el motivo de la pérdida");
    fireEvent.change(screen.getByLabelText("Motivo de la pérdida"), { target: { value: "Sin presupuesto" } });
    press(card("Luis Prado"), "Marcar perdido");
    expect(column("Perdido").getByText("Luis Prado")).toBeTruthy();
    press(card("Luis Prado"), "Reabrir");
    expect(column("Prospecto").getByText("Luis Prado")).toBeTruthy();
    press(card("Marta Solís"), "Marcar ganado");
    expect(column("Ganado").getByText("Marta Solís")).toBeTruthy();
  });

  it("lets NEX move one step only inside the authorization and when KOE agrees; it can never win or lose", () => {
    render(<CrmCenter />);
    actAs("nex");
    tab("Pipeline");
    press(card("Marta Solís"), "Marcar ganado");
    expect(alertText()).toContain("NEX solo puede preparar");
    press(card("Pedro Gómez"), "Mover a Calificado");
    expect(alertText()).toContain("KOE no recomienda avanzar todavía");
    expect(alertText()).toContain("KOE pide al menos 60");
    press(card("Sofía Rey"), "Mover a Reunión");
    expect(column("Reunión").getByText("Sofía Rey")).toBeTruthy(); // inside the authorization, and KOE's score says yes
    tab("Dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Revocar autorización" }));
    expect(alertText()).toContain("NEX solo puede preparar"); // a person revokes it, not NEX
    actAs("nova-ana");
    fireEvent.click(screen.getByRole("button", { name: "Revocar autorización" }));
    expect(screen.getByText("Sin autorización")).toBeTruthy();
    actAs("nex");
    tab("Pipeline");
    press(card("Sofía Rey"), "Mover a Propuesta");
    expect(alertText()).toContain("necesita una autorización vigente");
  });

  it("shows Opportunity Intelligence: probability, risk, expected value and time, the next best action and why", () => {
    render(<CrmCenter />);
    open("Luis Prado");
    for (const name of ["Probabilidad de cierre", "Nivel de riesgo", "Valor esperado", "Tiempo esperado", "Puntajes"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(kpi("Nivel de riesgo").getByText("Crítico")).toBeTruthy();
    const next = within(screen.getByLabelText("Siguiente mejor acción"));
    expect(next.getByText("Llamar")).toBeTruthy();
    expect(next.getByText(/Han pasado 12 días sin contacto: llamar hoy/)).toBeTruthy();
    const why = within(screen.getByLabelText("Por qué"));
    expect(why.getByText(/Etapa «qualified»/)).toBeTruthy();
    expect(why.getByText(/Pasaron 12 días sin contacto/)).toBeTruthy();
  });

  it("says which Worker and model KOE used, and keeps the history of analyses: refreshing adds one", () => {
    render(<CrmCenter />);
    open("Marta Solís");
    const koe = within(screen.getByLabelText("Análisis de KOE"));
    expect(koe.getByText("Asistente comercial")).toBeTruthy();
    expect(koe.getAllByText("Rápido A").length).toBe(2); // the model and the reason KOE gave
    expect(koe.getByText(/Costo estimado/)).toBeTruthy();
    const newest = () => within(screen.getByRole("list", { name: "Historial de análisis" })).getAllByRole("listitem")[0].textContent ?? "";
    expect(newest()).not.toContain("actualización");
    fireEvent.click(screen.getByRole("button", { name: "Actualizar análisis de KOE" }));
    expect(newest()).toContain("actualización"); // a new entry on top; the earlier ones are still below
    expect(screen.getByText(/nunca se sobrescribe/)).toBeTruthy();
  });

  it("updates the scores with a Business Audit, and keeps the earlier audits", () => {
    render(<CrmCenter />);
    open("Pedro Gómez");
    const audits = within(screen.getByLabelText("Business Audit"));
    expect(audits.getAllByText(/ajuste \d+\/100/)).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Resultado simulado del audit"), { target: { value: "hot" } });
    press(audits, "Simular un Business Audit (plataforma)");
    expect(within(screen.getByLabelText("Business Audit")).getAllByText(/ajuste \d+\/100/)).toHaveLength(2);
    expect(within(screen.getByRole("list", { name: "Historial de análisis" })).getAllByText(/Business Audit/)[0]).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Historial de análisis" })).getAllByText(/antes \d+/).length).toBeGreaterThan(0);
  });

  it("shows the whole story of a prospect in order, and lets a person record a contact", () => {
    render(<CrmCenter />);
    tab("Pipeline");
    press(card("Marta Solís"), "Ver");
    tab("Línea de tiempo");
    const items = within(screen.getByRole("list", { name: "Línea de tiempo" })).getAllByRole("listitem");
    const kinds = items.map((item) => item.textContent ?? "");
    for (const kind of ["Correo", "WhatsApp", "Llamada", "Automatización", "Worker", "Business Audit", "NEX"]) expect(kinds.some((text) => text.includes(kind)), kind).toBe(true);
    const times = kinds.map((text) => text.slice(0, 16));
    expect(times).toEqual([...times].sort());
    fireEvent.change(screen.getByLabelText("Resumen del contacto"), { target: { value: "Marta pidió una nueva propuesta" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(within(screen.getByRole("list", { name: "Línea de tiempo" })).getByText("Marta pidió una nueva propuesta")).toBeTruthy();
    actAs("nex");
    fireEvent.click(screen.getByRole("button", { name: "Registrar" }));
    expect(alertText()).toContain("NEX solo puede preparar");
  });

  it("shows NEX's proposals with drafts, and only a person accepts, completes or dismisses them; nothing is sent", () => {
    render(<CrmCenter />);
    tab("Tareas");
    expect(screen.getByText(/Nada se envía ni se ejecuta desde aquí/)).toBeTruthy();
    expect(screen.getByText("Propuesta de NEX (5)")).toBeTruthy();
    expect(screen.getByText("Aceptada por una persona (1)")).toBeTruthy();
    expect(screen.getByText("Hecha (1)")).toBeTruthy();
    const task = within(screen.getByLabelText("Tarea Enviar correo a Pedro Gómez"));
    expect(task.getByText(/Borrador preparado por NEX \(no enviado\)/)).toBeTruthy();
    press(task, "Aceptar");
    expect(screen.getByText("Propuesta de NEX (4)")).toBeTruthy();
    expect(screen.getByText("Aceptada por una persona (2)")).toBeTruthy();
    actAs("nex");
    press(within(screen.getByLabelText("Tarea Enviar correo a Pedro Gómez")), "Marcar como hecha");
    expect(alertText()).toContain("NEX solo puede preparar");
    expect(screen.queryByRole("button", { name: /^Enviar/ })).toBeNull();
  });

  it("prepares tasks from the opportunity, as proposals", () => {
    render(<CrmCenter />);
    open("Pedro Gómez");
    fireEvent.click(screen.getByRole("button", { name: "Preparar tareas (propuestas)" }));
    tab("Tareas");
    expect(screen.getByText("Propuesta de NEX (5)")).toBeTruthy(); // that one was already waiting: nothing is repeated
  });

  it("shows Customer 360 with every connection KOE brings together, and converts a won deal only by a person", () => {
    render(<CrmCenter />);
    tab("Cliente 360");
    expect(screen.getByLabelText("Empresa", { selector: "div" }).textContent).toContain("Studio Verde");
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: screen.getAllByRole("option", { name: "Studio Verde" })[0].getAttribute("value") ?? "" } });
    expect(kpi("Pagado").getByText("US$ 3 500.00")).toBeTruthy();
    for (const kind of ["Productos", "Academia", "Marketplace", "Automatizaciones", "Workers", "Pagos", "Referidos"]) expect(screen.getByLabelText(`Conexión ${kind}`), kind).toBeTruthy();
    expect(within(screen.getByLabelText("Conexión Pagos")).getByText(/Pago de implementación · US\$ 3 000.00/)).toBeTruthy();
    expect(within(screen.getByLabelText("Lista de contactos")).getByText(/Raúl Vargas/)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/IBAN|tarjeta|número de cuenta/i);
    tab("Pipeline");
    press(card("Marta Solís"), "Marcar ganado");
    tab("Cliente 360");
    const pending = within(screen.getByLabelText("Ventas ganadas sin convertir"));
    actAs("nex");
    press(pending, "Convertir en cliente");
    expect(alertText()).toContain("NEX solo puede preparar");
    actAs("nova-ana");
    press(within(screen.getByLabelText("Ventas ganadas sin convertir")), "Convertir en cliente");
    expect(screen.queryByLabelText("Ventas ganadas sin convertir")).toBeNull();
    expect(screen.getAllByRole("option", { name: "Clínica Dental Sol" }).length).toBeGreaterThan(0);
  });

  it("lets a person add a contact to a customer", () => {
    render(<CrmCenter />);
    tab("Cliente 360");
    fireEvent.change(screen.getByLabelText("Nombre del contacto"), { target: { value: "Nora Díaz" } });
    fireEvent.change(screen.getByLabelText("Cargo del contacto"), { target: { value: "Compras" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir contacto" }));
    expect(within(screen.getByLabelText("Lista de contactos")).getByText(/Nora Díaz/)).toBeTruthy();
  });

  it("speaks as a sales assistant, and declares the future without building it", () => {
    render(<CrmCenter />);
    tab("Asistente de ventas");
    const list = within(screen.getByRole("list", { name: "Recomendaciones del asistente" }));
    for (const text of ["Este prospecto tiene alta probabilidad.", "Recomiendo llamar hoy.", "Existe riesgo de perder la oportunidad.", "Este cliente puede comprar otro servicio."]) expect(list.getAllByText(text).length, text).toBeGreaterThan(0);
    expect(list.getByText("Han pasado 12 días.")).toBeTruthy();
    const future = within(screen.getByRole("list", { name: "Capacidades futuras del CRM" }));
    for (const name of ["Predicción de ventas", "Forecast comercial", "Detección de abandono", "Cross Selling", "Up Selling", "Renovaciones", "Churn Prediction"]) expect(future.getByText(name)).toBeTruthy();
    expect(future.getAllByText("No construido")).toHaveLength(7);
  });

  it("keeps each company apart, and never names a provider", () => {
    render(<CrmCenter />);
    actAs("vida-lucia");
    tab("Pipeline");
    expect(screen.getByLabelText("Tarjeta Dra. Rosa Pineda")).toBeTruthy();
    expect(screen.queryByLabelText("Tarjeta Marta Solís")).toBeNull();
    tab("Cliente 360");
    expect(screen.getByText("Todavía no hay clientes.")).toBeTruthy();
    for (const name of ["Dashboard", "Pipeline", "Oportunidad", "Línea de tiempo", "Tareas", "Cliente 360", "Asistente de ventas"]) {
      tab(name);
      expect(document.body.textContent ?? "", name).not.toMatch(/proveedor-|openai|anthropic|gemini|mistral/i);
    }
  });
});
