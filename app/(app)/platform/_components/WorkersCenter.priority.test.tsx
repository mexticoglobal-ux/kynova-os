import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { WorkersCenter } from "./WorkersCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const loadSample = () => fireEvent.click(screen.getByRole("button", { name: "Cargar datos de ejemplo" }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const worker = (name: string) => within(screen.getByLabelText(`Worker ${name}`));

describe("Workers center: priority and estimated cost", () => {
  it("shows each Worker's priority and estimated cost per run", () => {
    render(<WorkersCenter />);
    const coordinator = worker("Coordinador");
    expect(coordinator.getByText("Prioridad Alta")).toBeTruthy();
    expect(coordinator.getByText(/Costo estimado por ejecución: US\$ 0\.0040 \(estimado\)/)).toBeTruthy();
    expect(worker("Analista de reportes").getByText("Prioridad Baja")).toBeTruthy();
    expect(worker("Cobranza").getByText("Prioridad Normal")).toBeTruthy();
  });

  it("shows the estimated cost of a company's runs and says it is not a bill", () => {
    render(<WorkersCenter />);
    const metrics = within(screen.getByLabelText("Métricas de KOE"));
    expect(metrics.getByText("US$ 0.0000")).toBeTruthy();
    loadSample();
    expect(metrics.queryByText("US$ 0.0000")).toBeNull();
    expect(metrics.getByText(/6 ejecuciones/)).toBeTruthy();
    expect(metrics.getByText(/no es una factura ni limita nada/)).toBeTruthy();
  });

  it("lets a company change a Worker's priority for its own installation, and nobody else", () => {
    render(<WorkersCenter />);
    loadSample();
    const sales = () => worker("Asistente comercial");
    expect(sales().getByText("Prioridad Alta")).toBeTruthy();
    fireEvent.change(sales().getByLabelText("Prioridad de sales"), { target: { value: "critical" } });
    fireEvent.click(sales().getByRole("button", { name: "Guardar configuración" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sales().getAllByText("Prioridad Crítica").length).toBeGreaterThan(0);
    actAs("vida-lucia");
    expect(within(screen.getByLabelText("Worker Asistente comercial")).getByText("Prioridad Alta")).toBeTruthy(); // Vida's view of the catalog default
    actAs("nex");
    fireEvent.click(within(screen.getByLabelText("Worker Asistente comercial")).getByRole("button", { name: "Guardar configuración" }));
    expect(alertText()).toContain("un Worker no puede");
  });

  it("shows the priority of runs and of what waits for approval", () => {
    render(<WorkersCenter />);
    loadSample();
    tab("Ejecuciones");
    expect(screen.getAllByText(/^Prioridad (Alta|Normal|Baja|Crítica)$/).length).toBeGreaterThanOrEqual(5);
    expect(screen.getAllByText(/^Est\. US\$ /).length).toBeGreaterThanOrEqual(4);
  });

  it("asks for priority and cost when building a Worker, and checks them", () => {
    render(<WorkersCenter />);
    tab("Crear");
    const review = within(screen.getByLabelText("Revisión del Worker"));
    fireEvent.change(screen.getByLabelText("Prioridad del Worker"), { target: { value: "critical" } });
    fireEvent.change(screen.getByLabelText("Costo estimado por ejecución"), { target: { value: "-5" } });
    expect(review.getByText(/Falta: costo estimado por ejecución/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Costo estimado por ejecución"), { target: { value: "2500" } });
    expect(review.queryByText(/Falta: costo estimado por ejecución/)).toBeNull();
    expect(screen.getByText(/US\$ 0\.0025/)).toBeTruthy();
  });
});
