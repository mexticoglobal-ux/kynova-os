import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StudioCenter } from "./StudioCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const loadSample = () => fireEvent.click(screen.getByRole("button", { name: "Cargar datos de ejemplo" }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const fill = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const card = (kind: string, name: string) => screen.getAllByLabelText(`${kind} ${name}`)[0];
const press = (scope: ReturnType<typeof within>, name: string | RegExp) => fireEvent.click(scope.getByRole("button", { name }));
const alertText = () => screen.getByRole("alert").textContent ?? "";

describe("StudioCenter", () => {
  it("starts empty, says no model or provider is involved, and loads the sample once", () => {
    render(<StudioCenter />);
    expect(screen.getByText(/ningún modelo ni proveedor/)).toBeTruthy();
    loadSample();
    expect(screen.getByText("Pendientes de aprobación (Nivel 3 · aprobación de una persona)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cargar datos de ejemplo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the dashboard: counts, versions that are never overwritten, the estimated cost and the Constitution levels", () => {
    render(<StudioCenter />);
    loadSample();
    expect(screen.getByText("Nunca se sobrescriben")).toBeTruthy();
    expect(screen.getByText(/estimación, no factura/)).toBeTruthy();
    expect(screen.getByText("Nivel 1 · prepara")).toBeTruthy();
    expect(screen.getByText("Nivel 2 · con autorización")).toBeTruthy();
    expect(within(screen.getByLabelText("Autorización de asignaciones")).getByText("Vigente")).toBeTruthy();
    expect(screen.getByLabelText("Pendiente Respuesta a prospecto v2").textContent).toContain("enviada por NEX (IA)");
  });

  it("lets a person approve what NEX sent, and a person only: NEX gets a clear refusal", () => {
    render(<StudioCenter />);
    loadSample();
    actAs("nex");
    press(within(screen.getByLabelText("Pendiente Respuesta a prospecto v2")), "Aprobar y publicar");
    expect(alertText()).toContain("NEX solo puede dejar borradores");
    actAs("nova-pablo");
    press(within(screen.getByLabelText("Pendiente Respuesta a prospecto v2")), "Aprobar y publicar");
    expect(screen.queryByLabelText("Pendiente Respuesta a prospecto v2")).toBeNull();
    tab("Prompts");
    const versions = within(screen.getAllByLabelText("Versiones de Respuesta a prospecto")[0]);
    expect(versions.getAllByText("Publicada").length).toBe(1);
    expect(versions.getByText("Reemplazada")).toBeTruthy();
  });

  it("rejects with a reason and keeps the rejected version on record", () => {
    render(<StudioCenter />);
    loadSample();
    const pending = within(screen.getByLabelText("Pendiente Respuesta a prospecto v2"));
    press(pending, "Rechazar");
    expect(alertText()).toContain("el motivo del rechazo");
    fireEvent.change(screen.getByLabelText("Motivo del rechazo de Respuesta a prospecto v2"), { target: { value: "Falta el tono" } });
    press(within(screen.getByLabelText("Pendiente Respuesta a prospecto v2")), "Rechazar");
    tab("Prompts");
    const versions = within(screen.getAllByLabelText("Versiones de Respuesta a prospecto")[0]);
    expect(versions.getByText("Rechazada")).toBeTruthy();
    expect(screen.getByText(/«Falta el tono»/)).toBeTruthy();
  });

  it("lists prompts and agents with category, tags, status and versions, and filters them", () => {
    render(<StudioCenter />);
    loadSample();
    tab("Prompts");
    const prospect = within(card("Prompt", "Resumen semanal"));
    expect(prospect.getByText("Análisis")).toBeTruthy();
    expect(prospect.getByText("#reportes")).toBeTruthy();
    expect(prospect.getAllByText("Borrador").length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("Buscar en Biblioteca de Prompts"), { target: { value: "reportes" } });
    expect(screen.queryByLabelText("Prompt Respuesta a prospecto")).toBeNull();
    fireEvent.change(screen.getByLabelText("Buscar en Biblioteca de Prompts"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filtrar por categoría"), { target: { value: "analysis" } });
    expect(screen.queryByLabelText("Prompt Respuesta a prospecto")).toBeNull();
    tab("Agentes IA");
    const agent = within(card("Agente IA", "Asistente comercial"));
    expect(agent.getByText(/Workers: 1 · Automatizaciones: 1 · Cursos: 1/)).toBeTruthy();
    expect(agent.getByText("Publicado")).toBeTruthy();
  });

  it("creates a prompt with variables, validating as it goes, and edits it as a new version", () => {
    render(<StudioCenter />);
    tab("Constructor");
    const create = screen.getByRole("button", { name: "Crear prompt" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fill("Nombre", "Bienvenida");
    fill("Etiquetas", "ventas, hola");
    fill("Texto del prompt", "Saluda a {{nombre}}.");
    expect(screen.getByText("{{nombre}}")).toBeTruthy();
    expect(screen.queryByLabelText("Pendientes del formulario")).toBeNull();
    fill("Texto del prompt", "Usa la clave sk_live_abcdef123456 con {{nombre}}");
    expect(screen.getByLabelText("Pendientes del formulario").textContent).toContain("secreto");
    fill("Texto del prompt", "Saluda a {{nombre}}.");
    fireEvent.click(create);
    expect(screen.getByRole("status").textContent).toContain("Se creó «Bienvenida» como borrador");
    tab("Prompts");
    const made = within(card("Prompt", "Bienvenida"));
    expect(made.getAllByText("Borrador").length).toBeGreaterThan(0);
    expect(made.getByText("#hola")).toBeTruthy();
    press(made, "Editar (nueva versión)");
    expect(screen.getByText(/Las versiones nunca se sobrescriben: guardar crea la versión 2/)).toBeTruthy();
    fill("Texto del prompt", "Saluda a {{nombre}} con calidez.");
    fireEvent.click(screen.getByRole("button", { name: "Guardar nueva versión" }));
    tab("Prompts");
    const versions = within(screen.getByLabelText("Versiones de Bienvenida"));
    expect(versions.getByText("v1")).toBeTruthy();
    expect(versions.getByText("v2")).toBeTruthy();
  });

  it("builds an agent: main prompt, Workers, automations, courses, memory, personality and limits; Level 2 needs an authorization", () => {
    render(<StudioCenter />);
    loadSample();
    press(within(screen.getByLabelText("Autorización de asignaciones")), "Revocar autorización");
    tab("Agentes IA");
    fireEvent.click(screen.getByRole("button", { name: "Nuevo agente" }));
    fill("Nombre", "Agente de soporte");
    fill("Prompt principal", screen.getAllByRole("option", { name: "Respuesta a prospecto" })[0].getAttribute("value") ?? "");
    fireEvent.click(screen.getByLabelText("Worker Asistente comercial"));
    expect(screen.getByText(/necesita una autorización vigente/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Tono"), { target: { value: "formal" } });
    fireEvent.change(screen.getByLabelText("Memoria"), { target: { value: "none" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear agente" }));
    expect(alertText()).toContain("necesita una autorización vigente");
    tab("Panel");
    fireEvent.click(screen.getByRole("button", { name: "Conceder autorización (10 usos por día)" }));
    tab("Agentes IA");
    fireEvent.click(screen.getByRole("button", { name: "Nuevo agente" }));
    fill("Nombre", "Agente de soporte");
    fill("Prompt principal", screen.getAllByRole("option", { name: "Respuesta a prospecto" })[0].getAttribute("value") ?? "");
    fireEvent.click(screen.getByLabelText("Worker Asistente comercial"));
    fireEvent.click(screen.getByRole("button", { name: "Crear agente" }));
    expect(screen.getByRole("status").textContent).toContain("Se creó «Agente de soporte»");
  });

  it("tests a prompt in the Playground through KOE: Worker, model, reasons, estimated cost and time; no model is called", () => {
    render(<StudioCenter />);
    loadSample();
    tab("Prompts");
    press(within(screen.getAllByLabelText("Versiones de Respuesta a prospecto")[0]), "Probar v1");
    fill("Entrada nombre", "Marta");
    fill("Entrada tema", "precios");
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    const result = within(screen.getByLabelText("Resultado v1"));
    expect(result.getByText("Asistente comercial")).toBeTruthy();
    expect(result.getAllByText("Rápido A").length).toBe(2); // the model and the reason KOE gave
    expect(result.getByText(/Worker utilizado/)).toBeTruthy();
    expect(result.getByText(/Motivo de la selección/)).toBeTruthy();
    expect(result.getByText(/Costo estimado/)).toBeTruthy();
    expect(result.getByText(/Tiempo estimado/)).toBeTruthy();
    expect(result.getByText(/no se llamó a ningún modelo/)).toBeTruthy();
    expect(screen.getAllByText(/Responde a Marta sobre precios/).length).toBeGreaterThan(0);
  });

  it("asks for every input, compares two versions through the same Worker and shows what changed", () => {
    render(<StudioCenter />);
    loadSample();
    tab("Prompts");
    press(within(screen.getAllByLabelText("Versiones de Respuesta a prospecto")[0]), "Probar v2");
    fireEvent.click(screen.getByRole("button", { name: "Probar" }));
    expect(alertText()).toContain("falta el dato");
    fill("Entrada nombre", "Marta");
    fill("Entrada tema", "precios");
    fill("Comparar con", "1");
    fireEvent.click(screen.getByRole("button", { name: "Comparar versiones" }));
    expect(screen.getByText("Comparación de versiones")).toBeTruthy();
    expect(screen.getByLabelText("Resultado v1")).toBeTruthy();
    expect(screen.getByLabelText("Resultado v2")).toBeTruthy();
    expect(screen.getByText(/Ambas pasaron por el mismo Worker/)).toBeTruthy();
    expect(screen.getByLabelText("Diferencias del texto").textContent).toContain("Pregunta por el presupuesto disponible.");
  });

  it("keeps the history of tests and of everything that happened", () => {
    render(<StudioCenter />);
    loadSample();
    tab("Historial");
    expect(screen.getAllByLabelText(/^Prueba /).length).toBe(4);
    expect(screen.getAllByText(/Worker utilizado/).length).toBe(4);
    expect(screen.getByText("Registro de actividad")).toBeTruthy();
    expect(screen.getAllByText(/version.approve/).length).toBeGreaterThan(0);
  });

  it("creates a template (with author, company, source and version), starts a draft from it and shares as a record", () => {
    render(<StudioCenter />);
    loadSample();
    tab("Plantillas y compartir");
    const template = within(screen.getByLabelText("Plantilla Respuesta a prospecto"));
    expect(template.getByText("PromptTemplate")).toBeTruthy();
    expect(template.getByText(/Versión 1 · autor ana · empresa Nova Marketing Studio · origen own/)).toBeTruthy();
    expect(template.getByText(/todavía no se publica nada/)).toBeTruthy();
    expect(screen.getByText(/Todavía no hay Marketplace de prompts/)).toBeTruthy();
    expect(within(screen.getByLabelText(/^Acuerdo /)).getByText("Aprobado (sin efecto todavía)")).toBeTruthy();
    press(template, "Crear borrador desde la plantilla");
    tab("Prompts");
    expect(screen.getAllByLabelText("Prompt Respuesta a prospecto").some((item) => item.textContent?.includes("origen: plantilla"))).toBe(true);
  });

  it("keeps each company's work apart, and never names a provider", () => {
    render(<StudioCenter />);
    loadSample();
    actAs("vida-lucia");
    tab("Prompts");
    expect(card("Prompt", "Aviso de cita")).toBeTruthy();
    expect(screen.queryByLabelText("Prompt Respuesta a prospecto")).toBeNull();
    tab("Plantillas y compartir");
    expect(screen.getByText("No hay acuerdos de compartir.")).toBeTruthy();
    actAs("nova-ana");
    tab("Historial");
    expect(document.body.textContent ?? "").not.toMatch(/proveedor-|openai|anthropic|gemini|mistral/i);
  });
});
