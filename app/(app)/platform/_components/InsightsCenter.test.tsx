import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InsightsCenter } from "./InsightsCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const kpi = (name: string) => within(screen.getByLabelText(name, { selector: "div" }));
const digits = (name: string) => Number((screen.getByLabelText(name, { selector: "div" }).textContent ?? "").replace(/\D/g, ""));
const alertText = () => screen.getByRole("alert").textContent ?? "";
const press = (scope: ReturnType<typeof within>, name: string | RegExp) => fireEvent.click(scope.getByRole("button", { name }));

describe("InsightsCenter", () => {
  it("opens on the executive summary with every figure asked for, and says where the numbers come from", () => {
    render(<InsightsCenter />);
    expect(screen.getByText(/Todas las cifras salen de KOE, la única fuente de verdad/)).toBeTruthy();
    for (const name of ["ROI estimado", "Horas ahorradas", "Automatizaciones ejecutadas", "Workers activos", "Agentes activos", "Clientes atendidos", "Prospectos convertidos", "Tareas completadas", "Costo estimado IA", "Ahorro estimado", "Tiempo promedio de respuesta", "Prompts más utilizados"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(kpi("ROI estimado").getByText(/^×/)).toBeTruthy();
    expect(kpi("Prompts más utilizados").getByText("Respuesta a prospecto")).toBeTruthy();
    expect(screen.getByText(/Supuesto: una hora de trabajo manual vale US\$ 20.00/)).toBeTruthy();
    expect(screen.getByText(/Todo es estimado, no una factura/)).toBeTruthy();
  });

  it("limits every figure to the period chosen", () => {
    render(<InsightsCenter />);
    const all = digits("Tareas completadas");
    fireEvent.change(screen.getByLabelText("Periodo"), { target: { value: "7d" } });
    expect(digits("Tareas completadas")).toBeLessThan(all);
    expect(digits("Tareas completadas")).toBeGreaterThan(0);
  });

  it("charts every module: sales, marketing, SEO, CRM, Academy, Marketplace, referrals, automations, Workers, payments and integrations", () => {
    render(<InsightsCenter />);
    tab("Analítica");
    for (const name of ["Ventas", "Marketing", "SEO", "CRM", "Academia", "Marketplace", "Referidos", "Automatizaciones", "Workers", "Pagos", "Integraciones"]) {
      const chart = within(screen.getByLabelText(`Analítica de ${name}`));
      expect(chart.getByRole("img").getAttribute("aria-label"), name).toContain(`${name}:`);
    }
  });

  it("shows AI by Worker, model and specialty, with time, cost, success, errors, fallbacks and comparisons", () => {
    render(<InsightsCenter />);
    tab("IA");
    expect(screen.getByText(/no hay llamadas reales a ningún modelo/)).toBeTruthy();
    for (const name of ["Ejecuciones", "Tiempo promedio", "Costo promedio", "Éxito", "Errores y respaldos"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Uso por Worker" })).getByText("Asistente comercial")).toBeTruthy();
    expect(within(screen.getByRole("table", { name: "Uso por modelo" })).getByText("Rápido A")).toBeTruthy();
    expect(screen.getByText("Uso por especialidad")).toBeTruthy();
    expect(screen.getByText("Modelos preferidos por KOE")).toBeTruthy();
    expect(screen.getByText(/Respuesta a prospecto v1 frente a Respuesta a prospecto v2/)).toBeTruthy();
  });

  it("shows productivity: hours saved, time automated, processes eliminated, ranking and time by department", () => {
    render(<InsightsCenter />);
    tab("Productividad");
    for (const name of ["Horas ahorradas", "Tiempo automatizado", "Procesos manuales eliminados"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(screen.getByText("Ranking de procesos")).toBeTruthy();
    expect(screen.getByText("Responder a un prospecto")).toBeTruthy();
    const table = within(screen.getByRole("table", { name: "Tiempo por departamento" }));
    for (const department of ["Ventas", "Marketing", "Atención", "Finanzas", "Operaciones"]) expect(table.getByText(department)).toBeTruthy();
  });

  it("shows finance: ROI, cost by Worker, agent, automation and company, revenue, value, and never bank data", () => {
    render(<InsightsCenter />);
    tab("Finanzas");
    for (const name of ["ROI", "Costo IA", "Valor generado", "Ingresos estimados", "Costo de la empresa"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    for (const title of ["Costo por Worker", "Costo por agente", "Costo por automatización", "Costo por mes"]) expect(screen.getByText(title)).toBeTruthy();
    expect(screen.getByText(/nunca aparecen datos bancarios, cuentas ni tarjetas/)).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/IBAN|SWIFT|número de tarjeta|número de cuenta/i);
  });

  it("shows customers: new, active, lost, conversion, retention and the funnel", () => {
    render(<InsightsCenter />);
    tab("Clientes");
    for (const name of ["Clientes nuevos", "Clientes activos", "Clientes perdidos", "Conversión", "Retención"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    const funnel = within(screen.getByRole("list", { name: "Embudo" }));
    for (const stage of ["Prospectos", "Calificados", "Propuestas", "Convertidos"]) expect(funnel.getByText(stage)).toBeTruthy();
    expect(funnel.getAllByText(/de la etapa anterior/).length).toBe(3);
  });

  it("answers the KOE questions and declares the future without building it", () => {
    render(<InsightsCenter />);
    tab("KOE");
    expect(screen.getByText(/sin otro motor de estadísticas/)).toBeTruthy();
    for (const name of ["Worker más eficiente", "Worker más utilizado", "Worker más costoso", "Worker más rápido", "Automatización más usada", "Prompt más utilizado", "Agente más utilizado", "Modelo recomendado", "Especialidad más utilizada", "Eventos procesados"]) expect(screen.getByLabelText(name, { selector: "div" }), name).toBeTruthy();
    expect(kpi("Prompt más utilizado").getByText("Respuesta a prospecto")).toBeTruthy();
    const future = within(screen.getByRole("list", { name: "Capacidades futuras" }));
    for (const name of ["Forecast", "Predicciones", "Análisis IA", "Benchmark", "Machine Learning", "Recomendaciones"]) expect(future.getByText(name)).toBeTruthy();
    expect(future.getAllByText("No construido")).toHaveLength(6);
  });

  it("keeps each company's figures apart", () => {
    render(<InsightsCenter />);
    const nova = digits("Tareas completadas");
    actAs("vida-lucia");
    const vida = digits("Tareas completadas");
    expect(vida).toBeGreaterThan(0);
    expect(vida).toBeLessThan(nova);
    expect(kpi("Prompts más utilizados").getByText("Todavía no se probó ningún prompt.")).toBeTruthy();
    tab("Finanzas");
    expect(screen.queryByText("Prospecto caliente")).toBeNull(); // Nova's automations are not Vida's
    expect(screen.getByText("Costo de la empresa")).toBeTruthy();
  });

  it("never names a provider on any screen", () => {
    render(<InsightsCenter />);
    for (const name of ["Resumen ejecutivo", "Analítica", "IA", "Productividad", "Finanzas", "Clientes", "KOE", "Reportes"]) {
      tab(name);
      expect(document.body.textContent ?? "", name).not.toMatch(/proveedor-|openai|anthropic|gemini|mistral/i);
    }
  });

  it("lets NEX prepare a report draft and a simulated export, but not approve, schedule or share it", () => {
    render(<InsightsCenter />);
    tab("Reportes");
    actAs("nex");
    fireEvent.change(screen.getByLabelText("Nombre del reporte"), { target: { value: "Cierre trimestral" } });
    fireEvent.click(screen.getByLabelText("Sección Finanzas"));
    fireEvent.click(screen.getByRole("button", { name: "Preparar borrador de reporte" }));
    const draft = within(screen.getByLabelText("Reporte Cierre trimestral"));
    expect(draft.getByText("Borrador")).toBeTruthy();
    press(draft, "Aprobar");
    expect(alertText()).toContain("NEX solo puede preparar borradores");
    fireEvent.change(draft.getByLabelText("Frecuencia de Cierre trimestral"), { target: { value: "weekly" } });
    expect(alertText()).toContain("NEX solo puede preparar borradores");
    press(within(screen.getByLabelText("Reporte Cierre trimestral")), "Exportar (simulado)");
    expect(within(screen.getByRole("list", { name: "Exportaciones simuladas" })).getByText(/cierre-trimestral-.*\.pdf/)).toBeTruthy();
    expect(screen.getAllByText("Simulada, sin archivo").length).toBeGreaterThan(0);
  });

  it("lets a person approve a report, schedule it and share it with the team (records only), and refuses sharing outside", () => {
    render(<InsightsCenter />);
    tab("Reportes");
    const monthly = within(screen.getByLabelText("Reporte Resumen ejecutivo mensual"));
    expect(monthly.getByText("Aprobado")).toBeTruthy();
    expect(monthly.getAllByText("Mensual").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Reporte Rendimiento de la IA").textContent).toContain("creado por NEX (IA)");
    press(within(screen.getByLabelText("Reporte Rendimiento de la IA")), "Aprobar");
    expect(within(screen.getByLabelText("Reporte Rendimiento de la IA")).getByText("Aprobado")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Compartir Rendimiento de la IA con"), { target: { value: "alguien@correo.com" } });
    press(within(screen.getByLabelText("Reporte Rendimiento de la IA")), "Compartir");
    expect(alertText()).toContain("destinatarios internos");
    fireEvent.change(screen.getByLabelText("Compartir Rendimiento de la IA con"), { target: { value: "pablo, ana" } });
    press(within(screen.getByLabelText("Reporte Rendimiento de la IA")), "Compartir");
    expect(screen.getByLabelText("Reporte Rendimiento de la IA").textContent).toContain("compartido con pablo, ana");
  });

  it("corrects a figure only with a person's approval, as a compensating record, and the figure follows", () => {
    render(<InsightsCenter />);
    const before = digits("Tareas completadas");
    tab("Reportes");
    const pending = within(screen.getAllByLabelText(/^Corrección /)[0]);
    expect(pending.getByText("Propuesta")).toBeTruthy();
    expect(pending.getByText(/propuesta por NEX \(IA\)/)).toBeTruthy();
    actAs("nex");
    press(within(screen.getAllByLabelText(/^Corrección /)[0]), "Aprobar corrección");
    expect(alertText()).toContain("NEX solo puede preparar borradores");
    actAs("nova-pablo");
    press(within(screen.getAllByLabelText(/^Corrección /)[0]), "Aprobar corrección");
    const done = within(screen.getAllByLabelText(/^Corrección /)[0]);
    expect(done.getByText("Aprobada")).toBeTruthy();
    expect(done.getByText(/El valor original se conserva/)).toBeTruthy();
    tab("Resumen ejecutivo");
    expect(digits("Tareas completadas")).toBe(before + 3);
  });

  it("says plainly that metrics cannot be edited or deleted, and what the future holds", () => {
    render(<InsightsCenter />);
    tab("Reportes");
    expect(screen.getByText(/nadie puede editarlas ni borrarlas/)).toBeTruthy();
    expect(screen.getByText(/Forecast, Predicciones, Análisis IA, Benchmark, Machine Learning, Recomendaciones: declarados, no construidos/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /borrar|eliminar|editar métrica/i })).toBeNull();
  });
});
