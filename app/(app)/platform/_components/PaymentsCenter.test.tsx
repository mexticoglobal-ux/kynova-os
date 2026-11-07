import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentsCenter } from "./PaymentsCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const loadSample = () => fireEvent.click(screen.getByRole("button", { name: "Cargar datos de ejemplo" }));
const pick = (name: string, value: string) => fireEvent.change(screen.getByRole("combobox", { name }), { target: { value } });
const card = (text: string) => screen.getByText(new RegExp(text)).closest("li") as HTMLElement;

describe("PaymentsCenter", () => {
  it("starts empty and says that no provider is contacted", () => {
    render(<PaymentsCenter />);
    expect(screen.getByText(/no se contacta a ningún proveedor/)).toBeTruthy();
    expect(screen.getByText("Aún no hay movimientos")).toBeTruthy();
  });

  it("loads the sample once and summarizes it", () => {
    render(<PaymentsCenter />);
    loadSample();
    expect(screen.getByText("1 reembolsos por aprobar")).toBeTruthy();
    expect(screen.getByText("2 líneas por conciliar")).toBeTruthy();
    expect(screen.getByText("1 facturas vencidas")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cargar datos de ejemplo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses a charge on a method that is not active", () => {
    render(<PaymentsCenter />);
    tab("Pagos");
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    expect(screen.getByRole("alert").textContent).toContain("no está activo");
  });

  it("rejects a malformed amount before it can become money", () => {
    render(<PaymentsCenter />);
    tab("Pagos");
    fireEvent.change(screen.getByLabelText("Monto"), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cobro" }));
    expect(screen.getByRole("alert").textContent).toContain("Monto inválido");
  });

  it("does not let whoever requests a refund approve it, and lets someone else", () => {
    render(<PaymentsCenter />);
    loadSample();
    tab("Pagos");
    fireEvent.click(within(card("pay_0001 ·")).getByRole("button", { name: "Reembolsar…" }));
    fireEvent.change(screen.getByLabelText("Monto del reembolso"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("Motivo del reembolso"), { target: { value: "Duplicado" } });
    fireEvent.click(screen.getByRole("button", { name: "Solicitar reembolso" }));

    tab("Reembolsos");
    fireEvent.click(within(card("ref_0011")).getByRole("button", { name: "Aprobar" }));
    expect(screen.getByRole("alert").textContent).toContain("no puede aprobarlo");

    fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: "bruno" } });
    fireEvent.click(within(card("ref_0011")).getByRole("button", { name: "Aprobar" }));
    expect(within(card("ref_0011")).getByText("Completado")).toBeTruthy();
  });

  it("rejects a forged webhook and shows it under errors", () => {
    render(<PaymentsCenter />);
    loadSample();
    tab("Webhooks");
    pick("Pago del webhook", "pay_0001");
    pick("Evento", "payment.failed");
    pick("Firma", "invalid");
    fireEvent.click(screen.getByRole("button", { name: "Enviar webhook simulado" }));
    tab("Actividad");
    expect(screen.getByText(/auth · Webhook rechazado: firma invalid/)).toBeTruthy();
    tab("Pagos");
    expect(within(card("pay_0001 ·")).getByText("Cobrado")).toBeTruthy(); // the forged "failed" changed nothing
  });

  it("proposes the exact match, and a person confirms it", () => {
    render(<PaymentsCenter />);
    loadSample();
    tab("Conciliación");
    expect(screen.getByText("Coincidencia exacta")).toBeTruthy();
    expect(screen.getByText("Coincidencia probable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar con pay_0004" }));
    expect(screen.getByText("Conciliada con pay_0004")).toBeTruthy();
  });

  it("keeps crypto reserved and MakaPay blocked until their documentation exists", () => {
    render(<PaymentsCenter />);
    tab("Métodos");
    expect(screen.getByText("Reservado")).toBeTruthy();
    fireEvent.click(within(card("^Criptomonedas")).getByRole("button", { name: "Administrar" }));
    const panel = screen.getByRole("region", { name: /Administrar Criptomonedas/ });
    expect((within(panel).getByRole("button", { name: "Activar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByText(/documentación técnica/)).toBeTruthy();
  });
});
