import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationsCenter } from "./AutomationsCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const loadSample = () => fireEvent.click(screen.getByRole("button", { name: "Cargar datos de ejemplo" }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const card = (name: string) => screen.getByLabelText(`Automatización ${name}`);
const press = (scope: ReturnType<typeof within>, name: string) => fireEvent.click(scope.getByRole("button", { name }));
const fill = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });

describe("AutomationsCenter", () => {
  it("starts empty, says nothing is sent, and loads the sample once", () => {
    render(<AutomationsCenter />);
    expect(screen.getByText(/nada se envía ni sale de la plataforma/)).toBeTruthy();
    expect(screen.getByText(/Todavía no hay automatizaciones/)).toBeTruthy();
    loadSample();
    expect(card("Prospecto caliente")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cargar datos de ejemplo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows each automation's status, mode and what it does", () => {
    render(<AutomationsCenter />);
    loadSample();
    const hot = within(card("Prospecto caliente"));
    expect(hot.getByText("Activa")).toBeTruthy();
    expect(hot.getByText("En vivo")).toBeTruthy();
    expect(hot.getByText(/Nuevo prospecto → Crear tarea · Notificación interna · Preparar correo \(sin enviarlo\)/)).toBeTruthy();
    expect(within(card("Revisión manual")).getByText("Modo de prueba")).toBeTruthy();
    expect(within(card("Cobro recibido")).getByText("Pausada")).toBeTruthy();
    expect(within(card("Preparar la reunión")).getByText("Borrador")).toBeTruthy();
    expect(within(card("Preparar la reunión")).getByText(/creada por NEX \(IA\)/)).toBeTruthy();
  });

  it("pauses, resumes and duplicates; deleting is not possible while active", () => {
    render(<AutomationsCenter />);
    loadSample();
    const hot = within(card("Prospecto caliente"));
    expect((hot.getByRole("button", { name: "Eliminar" }) as HTMLButtonElement).disabled).toBe(true);
    press(hot, "Pausar");
    expect(within(card("Prospecto caliente")).getByText("Pausada")).toBeTruthy();
    press(within(card("Prospecto caliente")), "Reanudar");
    expect(within(card("Prospecto caliente")).getByText("Activa")).toBeTruthy();
    press(within(card("Prospecto caliente")), "Duplicar");
    expect(within(card("Prospecto caliente (copia)")).getByText("Borrador")).toBeTruthy();
    expect(within(card("Prospecto caliente (copia)")).getByText("Modo de prueba")).toBeTruthy();
    press(within(card("Prospecto caliente (copia)")), "Eliminar");
    expect(screen.queryByLabelText("Automatización Prospecto caliente (copia)")).toBeNull();
  });

  it("creates an automation from the form, validating as it goes, and it starts as a draft in test mode", () => {
    render(<AutomationsCenter />);
    tab("Crear y editar");
    const create = screen.getByRole("button", { name: "Crear automatización" }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(screen.getByLabelText("Pendientes del formulario").textContent).toContain("nombre");
    fill("Nombre", "Bienvenida");
    fill("titulo de la acción 1", "Llamar a {{nombre}}");
    expect(screen.queryByLabelText("Pendientes del formulario")).toBeNull();
    fill("titulo de la acción 1", "Llamar a {{correo}}");
    expect(screen.getByLabelText("Pendientes del formulario").textContent).toContain("solo van en borradores");
    fill("titulo de la acción 1", "Llamar a {{nombre}}");
    fireEvent.click(create);
    tab("Automatizaciones");
    const made = within(card("Bienvenida"));
    expect(made.getByText("Borrador")).toBeTruthy();
    expect(made.getByText("Modo de prueba")).toBeTruthy();
  });

  it("edits an automation, and says an active one is paused while it is edited", () => {
    render(<AutomationsCenter />);
    loadSample();
    press(within(card("Prospecto caliente")), "Editar");
    expect(screen.getByText(/se pausa para que pueda revisar el cambio/)).toBeTruthy();
    fill("Nombre", "Prospecto muy caliente");
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    tab("Automatizaciones");
    const edited = within(card("Prospecto muy caliente"));
    expect(edited.getByText("Pausada")).toBeTruthy();
    expect(edited.getByText(/Versión 2/)).toBeTruthy();
  });

  it("simulates an event: a live automation prepares things, and a repeated event id is processed once", () => {
    render(<AutomationsCenter />);
    loadSample();
    tab("Simular eventos");
    fill("Evento", "newClient");
    fill("Identificador del evento", "evt-ui-1");
    fireEvent.click(screen.getByRole("button", { name: "Simular evento" }));
    fireEvent.click(screen.getByRole("button", { name: "Simular evento" }));
    tab("Resultados");
    expect(screen.getAllByLabelText(/^Ejecución /).filter((item) => item.textContent?.includes("Bienvenida al cliente nuevo"))).toHaveLength(2); // the sample's run and this one, not three
    expect(screen.getAllByText(/Hola Café Aurora/).length).toBeGreaterThan(0);
  });

  it("shows drafts as drafts and lets a person mark one as handled or dismiss it, once", () => {
    render(<AutomationsCenter />);
    loadSample();
    tab("Resultados");
    expect(screen.getByText(/Nada de esto se envió/)).toBeTruthy();
    const draft = within(screen.getAllByLabelText(/^Resultado Sobre su consulta de precios/)[0]);
    expect(draft.getByText("Borrador de correo")).toBeTruthy();
    expect(draft.getByText("Pendiente")).toBeTruthy();
    press(draft, "Marcar como hecho");
    const after = within(screen.getAllByLabelText(/^Resultado Sobre su consulta de precios/)[0]);
    expect(after.getByText("Hecho")).toBeTruthy();
    expect(after.queryByRole("button", { name: "Marcar como hecho" })).toBeNull();
  });

  it("shows the run that failed because the event lacked an email, with the reason", () => {
    render(<AutomationsCenter />);
    loadSample();
    tab("Resultados");
    expect(screen.getByText("Con errores")).toBeTruthy();
    expect(screen.getByText(/falta «correo» en el evento/)).toBeTruthy();
    expect(screen.getAllByText("Prueba (no creó nada)").length).toBeGreaterThan(0);
  });

  it("NEX can leave a draft but a person's decisions are refused with a clear message", () => {
    render(<AutomationsCenter />);
    loadSample();
    actAs("nex");
    press(within(card("Prospecto caliente")), "Pausar");
    expect(screen.getByRole("alert").textContent).toContain("NEX solo puede dejar borradores");
    expect(within(card("Prospecto caliente")).getByText("Activa")).toBeTruthy();
  });

  it("keeps each company's automations apart", () => {
    render(<AutomationsCenter />);
    loadSample();
    actAs("vida-lucia");
    expect(card("Aviso de formulario")).toBeTruthy();
    expect(screen.queryByLabelText("Automatización Prospecto caliente")).toBeNull();
    tab("Actividad");
    expect(screen.queryByText(/Prospecto caliente/)).toBeNull();
  });

  it("stops all of a company's automations at once and resumes them", () => {
    render(<AutomationsCenter />);
    loadSample();
    fireEvent.click(screen.getByRole("button", { name: "Detener todas las automatizaciones de mi empresa" }));
    expect(screen.getByText("Las automatizaciones de su empresa están detenidas.")).toBeTruthy();
    tab("Simular eventos");
    fireEvent.click(screen.getByRole("button", { name: "Simular evento" }));
    expect(screen.getByRole("alert").textContent).toContain("detenidas");
    fireEvent.click(screen.getByRole("button", { name: "Reanudar las automatizaciones de mi empresa" }));
    expect(screen.queryByText("Las automatizaciones de su empresa están detenidas.")).toBeNull();
  });

  it("runs a manual automation by hand with the data the person types", () => {
    render(<AutomationsCenter />);
    loadSample();
    press(within(card("Revisión manual")), "Pasar a en vivo");
    fireEvent.change(screen.getByLabelText("tema de Revisión manual"), { target: { value: "caja" } });
    press(within(card("Revisión manual")), "Ejecutar ahora");
    tab("Resultados");
    expect(screen.getAllByText("Revisar caja").length).toBeGreaterThan(0);
  });
});
