/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BillingCenter } from "./BillingCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const kpi = (name: string) => within(screen.getByLabelText(name, { selector: "div" }));
const press = (scope: ReturnType<typeof within> | typeof screen, name: string | RegExp) => fireEvent.click(scope.getByRole("button", { name }));
const PROVIDERS = /\b(openai|anthropic|llama|gemini|mistral)\b|workers ai/i;

describe("BillingCenter", () => {
  it("opens on the dashboard with the plan, status, renewal, usage, monthly bill and ROI", () => {
    render(<BillingCenter />);
    expect(screen.getByText(/no hay pasarela de pagos ni se cobra a nadie/)).toBeTruthy();
    for (const name of ["Plan actual", "Estado de la suscripción", "Próxima renovación", "Usuarios activos", "Workers activos", "Consumo IA", "Storage", "Automatizaciones", "Integraciones", "Marketplace", "Academy", "Facturación mensual", "ROI estimado"]) {
      expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    }
    expect(kpi("Plan actual").getByText("Professional")).toBeTruthy();
    expect(kpi("Estado de la suscripción").getByText("Activa")).toBeTruthy();
    expect(kpi("Próxima renovación").getByText("2026-11-05")).toBeTruthy();
    expect(kpi("Próxima renovación").getByText(/en 3 días/)).toBeTruthy();
    expect(kpi("Usuarios activos").getByText("11 de 25")).toBeTruthy();
    expect(kpi("Workers activos").getByText("5 de 10")).toBeTruthy();
    expect(kpi("Storage").getByText("62 de 100 GB")).toBeTruthy();
    expect(kpi("Integraciones").getByText("6 de 10")).toBeTruthy();
    expect(kpi("Facturación mensual").getByText("US$ 197.00")).toBeTruthy();
    expect(kpi("ROI estimado").getByText(/\d %/)).toBeTruthy();
  });

  it("shows KOE's limit alerts with their options, and applies one as a person", () => {
    render(<BillingCenter />);
    const alerts = within(screen.getByRole("list", { name: "Alertas de límites" }));
    expect(alerts.getByText(/Comunicaciones \(canales\): 6 de 6 \(En el límite\)/)).toBeTruthy();
    expect(alerts.getByText(/nunca bloquea ni borra lo que ya existe/)).toBeTruthy();
    press(alerts, /Subir al plan Business/);
    expect(kpi("Plan actual").getByText("Business")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks KOE for an analysis, recording the Worker and model, and keeps the history", () => {
    render(<BillingCenter />);
    const before = within(screen.getByRole("list", { name: "Historial de análisis de KOE" })).getAllByRole("listitem").length;
    press(screen, "Pedir un análisis a KOE");
    const history = within(screen.getByRole("list", { name: "Historial de análisis de KOE" })).getAllByRole("listitem");
    expect(history.length).toBe(before + 1);
    expect(history[0]?.textContent).toMatch(/modelo .+ · Mantener el plan · costo del análisis US\$/);
  });

  it("lets a person approve or reject NEX's proposals, and refuses anyone without billing authority", () => {
    render(<BillingCenter />);
    expect(screen.getByText("Solicitud autorizada")).toBeTruthy();
    const proposals = screen.getAllByLabelText(/^Propuesta /);
    const addon = proposals.find((item) => /Comprar 1 × Almacenamiento/.test(item.textContent ?? ""))!;
    actAs("nova-carla");
    press(within(addon), "Aprobar");
    expect(alertText()).toMatch(/Solo el propietario o quien administra la facturación/);
    actAs("nex");
    press(within(addon), "Aprobar");
    expect(alertText()).toMatch(/NEX nunca cobra, cancela, renueva/);
    actAs("nova-ana");
    press(within(addon), "Aprobar");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(within(screen.getAllByLabelText(/^Propuesta /).find((item) => /Comprar 1 × Almacenamiento/.test(item.textContent ?? ""))!).getByText("Aprobada")).toBeTruthy();
    tab("Add-ons");
    expect(within(screen.getByRole("list", { name: "Add-ons comprados" })).getByText(/1 × Almacenamiento/)).toBeTruthy();
  });

  it("shows the four plans with every limit, and marks the current one", () => {
    render(<BillingCenter />);
    tab("Planes");
    for (const name of ["Starter", "Professional", "Business", "Enterprise"]) expect(screen.getByLabelText(`Plan ${name}`), name).toBeTruthy();
    expect(within(screen.getByLabelText("Plan Professional")).getByText("Plan actual")).toBeTruthy();
    expect(within(screen.getByLabelText("Plan Business")).getByText("US$ 399.00")).toBeTruthy();
    for (const resource of ["Usuarios", "Workers IA", "Almacenamiento (GB)", "Academy (cursos)", "Marketplace (publicaciones)", "Integraciones", "Automatizaciones", "API (llamadas al mes)", "AI Studio (activos)", "Comunicaciones (canales)", "Insights (reportes)", "CRM (contactos)"]) {
      expect(within(screen.getByLabelText("Plan Starter")).getByText(resource), resource).toBeTruthy();
    }
  });

  it("shows the licenses, the other limits and the options when one is reached", () => {
    render(<BillingCenter />);
    tab("Licencias");
    const licenses = within(screen.getByRole("table", { name: "Licencias" }));
    for (const name of ["Usuarios", "Workers IA", "Sucursales", "Departamentos", "Equipos", "Academy (cursos)", "Marketplace (publicaciones)", "Integraciones"]) expect(licenses.getByText(name), name).toBeTruthy();
    expect(licenses.getAllByRole("row").length).toBe(9); // header + eight licenses
    expect(within(screen.getByRole("table", { name: "Otros límites" })).getByText("API (llamadas al mes)")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Opciones por límite" })).getByText(/Comunicaciones/)).toBeTruthy();
  });

  it("buys and cancels add-ons as a person, and only prepares a proposal as NEX", () => {
    render(<BillingCenter />);
    tab("Add-ons");
    const card = within(screen.getByLabelText("Almacenamiento (paquete de 50 GB)"));
    press(card, "Comprar (simulado)");
    const bought = within(screen.getByRole("list", { name: "Add-ons comprados" }));
    expect(bought.getByText(/1 × Almacenamiento/)).toBeTruthy();
    const item = bought.getByText(/1 × Almacenamiento/).closest("li") as HTMLElement;
    press(within(item), "Cancelar add-on");
    expect(within(item).getByText("Cancelado")).toBeTruthy();
    actAs("nex");
    press(within(screen.getByLabelText("Marketplace (paquete de 10 publicaciones)")), "Preparar propuesta");
    expect(screen.queryByRole("alert")).toBeNull();
    tab("Panel");
    expect(within(screen.getByRole("list", { name: "Propuestas" })).getByText(/Comprar 1 × Marketplace/)).toBeTruthy();
  });

  it("issues a renewal, applies the credit, records a simulated payment and keeps the receipt", () => {
    render(<BillingCenter />);
    tab("Facturación");
    const table = () => within(screen.getByRole("table", { name: "Facturas" }));
    expect(table().getByText("F-0001")).toBeTruthy();
    expect(table().getByText("Pagada")).toBeTruthy();
    press(screen, "Renovar ahora (simulado)");
    expect(table().getByText("F-0002")).toBeTruthy();
    expect(within(table().getByText("F-0002").closest("tr") as HTMLElement).getByText("Pendiente")).toBeTruthy();
    expect(kpi("Crédito disponible").getByText("US$ 0.0000")).toBeTruthy();
    press(screen, "Pagar F-0002 con tarjeta");
    expect(table().getAllByText("Pagada").length).toBe(2);
    const receipts = within(screen.getByRole("list", { name: "Recibos" })).getAllByRole("listitem");
    expect(receipts.length).toBe(3);
    expect(receipts[0]?.textContent).toMatch(/R-0003 .* Tarjeta \(simulada\) · F-0002 · ana/);
    expect(within(screen.getByRole("list", { name: "Historial de cambios de plan" })).getByText(/Alta/)).toBeTruthy();
  });

  it("adds a credit and lists the payment methods that will exist later, none of them built", () => {
    render(<BillingCenter />);
    tab("Facturación");
    press(screen, "Agregar un crédito de US$ 10");
    expect(kpi("Crédito disponible").getByText("US$ 30.00")).toBeTruthy();
    expect(within(screen.getByRole("list", { name: "Créditos" })).getByText(/US\$ 10\.00 · Crédito de cortesía/)).toBeTruthy();
    const future = within(screen.getByLabelText("Métodos de pago futuros"));
    for (const name of ["Stripe", "PayPal", "MakaPay", "MakaWallet", "SINPE", "Cripto", "Apple Pay", "Google Pay"]) expect(future.getByText(`${name} · no construido`), name).toBeTruthy();
  });

  it("shows KOE AI Usage by department, Worker, automation and agent, without any provider", () => {
    render(<BillingCenter />);
    tab("Consumo IA");
    for (const name of ["Tareas ejecutadas", "Costo estimado", "Costo promedio por tarea", "Tiempo ahorrado"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    for (const title of ["Costo por departamento", "Costo por Worker", "Costo por automatización", "Costo por agente IA"]) expect(screen.getByText(title), title).toBeTruthy();
    expect(screen.getByText(/KOE AI Usage/)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(PROVIDERS);
  });

  it("shows the forecast, the recommendation and the ROI with its assumption", () => {
    render(<BillingCenter />);
    tab("Forecast");
    for (const name of ["Consumo proyectado", "Costo proyectado de IA", "Costo proyectado total", "Recomendación"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(within(screen.getByLabelText("Recomendación de KOE")).getByText(/El plan actual alcanza/)).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Uso proyectado" })).getByText("Tareas de KOE al mes")).toBeTruthy();
    const roi = within(screen.getByLabelText("Resumen del ROI"));
    for (const name of ["Tiempo ahorrado", "Costo IA", "Costo plataforma", "Ahorro estimado", "ROI"]) expect(roi.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(screen.getByText(/un supuesto de la simulación/)).toBeTruthy();
  });

  it("recommends an upgrade to a company over its plan and applies it as its owner", () => {
    render(<BillingCenter />);
    actAs("vida-lucia");
    tab("Forecast");
    const card = within(screen.getByLabelText("Recomendación de KOE"));
    expect(card.getByText(/KOE recomienda subir a Professional/)).toBeTruthy();
    expect(card.getByText(/Alternativa: cubrirlo solo con add-ons costaría US\$ 18\.00 al mes/)).toBeTruthy();
    press(card, "Cambiar a Professional");
    tab("Panel");
    expect(kpi("Plan actual").getByText("Professional")).toBeTruthy();
  });

  it("works the Upgrade Center: upgrade, a downgrade that does not fit, a trial, cancelling and reactivating", () => {
    render(<BillingCenter />);
    tab("Upgrade Center");
    press(within(screen.getByLabelText("Cambiar a Starter")), "Hacer downgrade");
    expect(alertText()).toMatch(/El uso actual supera lo que daría ese cambio/);
    expect(within(screen.getByLabelText("Cambiar a Business")).getByRole("button", { name: "Probar 14 días" })).toBeTruthy();
    press(screen, "Cancelar suscripción");
    expect(screen.getAllByText("Cancelada").length).toBeGreaterThan(0);
    expect(screen.getByText(/los datos no se borran/)).toBeTruthy();
    press(screen, "Reactivar suscripción");
    expect(screen.getAllByText("Activa").length).toBeGreaterThan(0);
    press(within(screen.getByLabelText("Cambiar a Business")), "Hacer upgrade");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Plan Business")).toBeTruthy();
    press(within(screen.getByLabelText("Cambiar a Enterprise")), "Pasar a Enterprise");
    expect(screen.getByText("Plan Enterprise")).toBeTruthy();
  });

  it("lets NEX request an upgrade with its authorization, but never cancel, and a person still decides", () => {
    render(<BillingCenter />);
    actAs("nex");
    tab("Upgrade Center");
    press(screen, "Cancelar suscripción");
    expect(alertText()).toMatch(/NEX nunca cobra, cancela, renueva/);
    press(screen, "Solicitar upgrade a Business (como NEX)");
    expect(screen.queryByRole("alert")).toBeNull();
    tab("Panel");
    expect(screen.getAllByText("Solicitud autorizada").length).toBe(2);
    expect(kpi("Plan actual").getByText("Professional")).toBeTruthy(); // a request never changes the plan
    tab("Upgrade Center");
    press(screen, "Solicitar upgrade a Business (como NEX)");
    expect(alertText()).toMatch(/autorización vigente/); // one request a day
  });

  it("keeps each company apart: Clínica Vida sees its own trial and nothing of Nova's", () => {
    render(<BillingCenter />);
    actAs("vida-lucia");
    expect(kpi("Plan actual").getByText("Starter")).toBeTruthy();
    expect(kpi("Estado de la suscripción").getByText("En prueba")).toBeTruthy();
    expect(screen.queryByText(/Almacenamiento \(paquete/)).toBeNull();
    tab("Facturación");
    expect(screen.getByText("Todavía no hay facturas.")).toBeTruthy();
    expect(screen.queryByText("F-0001")).toBeNull();
    tab("Upgrade Center");
    press(screen, "Simular el fin de la prueba (plataforma)");
    expect(alertText()).toMatch(/la prueba no ha vencido/);
    expect(document.body.textContent ?? "").not.toMatch(/Nova Marketing/);
  });

  it("never shows a provider anywhere in the module", () => {
    render(<BillingCenter />);
    for (const name of ["Panel", "Planes", "Licencias", "Add-ons", "Facturación", "Consumo IA", "Forecast", "Upgrade Center"]) {
      tab(name);
      expect(document.body.textContent ?? "", name).not.toMatch(PROVIDERS);
    }
  });
});
