import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkersCenter } from "./WorkersCenter";

afterEach(cleanup);

const loadSample = () => fireEvent.click(screen.getByRole("button", { name: "Cargar datos de ejemplo" }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const worker = (name: string) => within(screen.getByLabelText(`Worker ${name}`));
const section = (title: string) => within(screen.getByLabelText(title));

describe("Workers center: installed, available, status, models and configuration per company", () => {
  it("separates what is installed from what is available, and moves a Worker when it is installed", () => {
    render(<WorkersCenter />);
    expect(screen.getByRole("heading", { name: "Instalados en su empresa (0)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Disponibles para instalar (7)" })).toBeTruthy();
    fireEvent.click(worker("Cobranza").getByRole("button", { name: "Activar en mi empresa" }));
    expect(screen.getByRole("heading", { name: "Instalados en su empresa (1)" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Disponibles para instalar (6)" })).toBeTruthy();
    expect(section("Instalados en su empresa").getByLabelText("Worker Cobranza")).toBeTruthy();
    expect(section("Disponibles para instalar").queryByLabelText("Worker Cobranza")).toBeNull();
  });

  it("shows the three states, Active, Paused and Disabled, and moves between them", () => {
    render(<WorkersCenter />);
    fireEvent.click(worker("Analista de reportes").getByRole("button", { name: "Activar en mi empresa" }));
    const card = () => worker("Analista de reportes");
    expect(card().getAllByText("Activo").length).toBeGreaterThan(0);
    fireEvent.click(card().getByRole("button", { name: "Pausar" }));
    expect(card().getAllByText("En pausa").length).toBeGreaterThan(0);
    expect(card().queryByRole("button", { name: "Pausar" })).toBeNull();
    fireEvent.click(card().getByRole("button", { name: "Deshabilitar" }));
    expect(card().getAllByText("Deshabilitado").length).toBeGreaterThan(0);
    expect(card().getByText(/Instalado en su empresa/)).toBeTruthy();
    expect(card().queryByRole("button", { name: "Reanudar" })).toBeNull();
    fireEvent.click(card().getByRole("button", { name: "Habilitar" }));
    expect(card().getByText(/Activo en su empresa/)).toBeTruthy();
  });

  it("lists which models each Worker may use and why the others are out, without calling anything", () => {
    render(<WorkersCenter />);
    const collections = within(screen.getByLabelText("Modelos de Cobranza"));
    expect(collections.getByText(/Puede usar:/).closest("p")?.textContent).toContain("Rápido A");
    expect(collections.getByText(/No puede usar:/).textContent).toContain("Visión D (no admite herramientas)");
    expect(collections.getByText(/no se conecta ninguna API/)).toBeTruthy();
    const reporter = within(screen.getByLabelText("Modelos de Analista de reportes"));
    expect(reporter.getByText(/Puede usar:/).closest("p")?.textContent).toContain("Razonamiento B, Razonamiento C");
  });

  it("lets a company limit a Worker, and the models it may use change when it excludes a provider", () => {
    render(<WorkersCenter />);
    fireEvent.click(worker("Analista de reportes").getByRole("button", { name: "Activar en mi empresa" }));
    const card = () => worker("Analista de reportes");
    fireEvent.change(card().getByLabelText("Máximo de ejecuciones de reporter"), { target: { value: "0" } });
    fireEvent.click(card().getByRole("button", { name: "Guardar configuración" }));
    expect(alertText()).toContain("de 1 a");
    fireEvent.change(card().getByLabelText("Máximo de ejecuciones de reporter"), { target: { value: "5" } });
    fireEvent.change(card().getByLabelText("Proveedores excluidos de reporter"), { target: { value: "proveedor-inventado" } });
    fireEvent.click(card().getByRole("button", { name: "Guardar configuración" }));
    expect(alertText()).toContain("proveedor desconocido");
    fireEvent.change(card().getByLabelText("Proveedores excluidos de reporter"), { target: { value: "proveedor-c" } });
    fireEvent.click(card().getByRole("button", { name: "Guardar configuración" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(card().getByText(/Puede usar:/).closest("p")?.textContent).toBe("Puede usar: Razonamiento B");
    expect(card().getByText(/0 de 5 ejecuciones hoy/)).toBeTruthy();
  });

  it("keeps each company's installation and configuration separate", () => {
    render(<WorkersCenter />);
    loadSample();
    expect(within(screen.getByLabelText("Worker Tutor de cursos")).getAllByText("Deshabilitado").length).toBeGreaterThan(0); // Nova installed it and switched it off
    expect(within(screen.getByLabelText("Worker Asistente comercial")).getByLabelText("Máximo de ejecuciones de sales")).toHaveProperty("value", "20");
    actAs("vida-lucia");
    expect(screen.getByRole("heading", { name: "Instalados en su empresa (1)" })).toBeTruthy(); // only the reporter
    expect(within(screen.getByLabelText("Worker Tutor de cursos")).queryByText("Deshabilitado")).toBeNull();
    expect(within(screen.getByLabelText("Worker Asistente comercial")).queryByLabelText("Máximo de ejecuciones de sales")).toBeNull();
  });

  it("does not let NEX change a Worker's status or configuration", () => {
    render(<WorkersCenter />);
    loadSample();
    actAs("nex");
    fireEvent.click(within(screen.getByLabelText("Worker Tutor de cursos")).getByRole("button", { name: "Habilitar" }));
    expect(alertText()).toContain("un Worker no puede");
    fireEvent.click(within(screen.getByLabelText("Worker Asistente comercial")).getByRole("button", { name: "Guardar configuración" }));
    expect(alertText()).toContain("un Worker no puede");
    fireEvent.click(within(screen.getByLabelText("Worker Asistente comercial")).getByRole("button", { name: "Deshabilitar" }));
    expect(alertText()).toContain("un Worker no puede");
  });
});
