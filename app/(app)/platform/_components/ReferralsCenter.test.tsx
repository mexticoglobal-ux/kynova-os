import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReferralsCenter } from "./ReferralsCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const loadSample = () => fireEvent.click(screen.getByRole("button", { name: "Cargar datos de ejemplo" }));
const actAs = (value: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
const cardWith = (text: RegExp | string) => screen.getByText(text).closest("li") as HTMLElement;

describe("ReferralsCenter", () => {
  it("starts empty and says there are no APIs or gateways", () => {
    render(<ReferralsCenter />);
    expect(screen.getByText(/sin APIs ni pasarelas/)).toBeTruthy();
    expect(screen.getByText("Aún no hay programa")).toBeTruthy();
  });

  it("loads the sample and shows the dashboard", () => {
    render(<ReferralsCenter />);
    loadSample();
    expect(screen.getByText("1 comisiones por revisar")).toBeTruthy();
    expect(screen.getByText("1 pagos por decidir")).toBeTruthy();
    expect(screen.getByText("3 de 3 afiliados activos")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cargar datos de ejemplo" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("keeps each company's data apart", () => {
    render(<ReferralsCenter />);
    loadSample();
    fireEvent.change(screen.getByRole("combobox", { name: "Empresa" }), { target: { value: "tenant-vida" } });
    expect(screen.getByText("Aún no hay programa")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cargar datos de ejemplo" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByRole("combobox", { name: "Empresa" }), { target: { value: "tenant-nova" } });
    expect(screen.getByText("3 de 3 afiliados activos")).toBeTruthy();
  });

  it("does not let NEX approve a commission or request a payout", () => {
    render(<ReferralsCenter />);
    loadSample();
    actAs("worker:nex");
    tab("Comisiones");
    fireEvent.click(within(cardWith(/Mismo correo que el afiliado/)).getByRole("button", { name: "Aprobar" }));
    expect(alertText()).toContain("NEX no puede");
    tab("Pagos de comisiones");
    fireEvent.click(screen.getByRole("button", { name: "Solicitar pago de Carla Mena" }));
    expect(alertText()).toContain("NEX no puede");
  });

  it("asks another person to approve a payout, and needs an external reference to mark it paid", () => {
    render(<ReferralsCenter />);
    loadSample();
    tab("Pagos de comisiones");
    const pending = () => cardWith(/Solicitado$/);
    fireEvent.click(within(pending()).getByRole("button", { name: "Aprobar pago" })); // Ana requested it in the sample
    expect(alertText()).toContain("no puede aprobarlo");

    actAs("bruno");
    fireEvent.click(within(pending()).getByRole("button", { name: "Aprobar pago" }));
    const approved = cardWith(/Aprobado$/);
    fireEvent.click(within(approved).getByRole("button", { name: "Marcar como pagado" }));
    expect(alertText()).toContain("referencia");
    fireEvent.change(within(approved).getByLabelText(/Referencia del pago/), { target: { value: "TRANSFERENCIA-7" } });
    fireEvent.click(within(approved).getByRole("button", { name: "Marcar como pagado" }));
    expect(screen.getAllByText("Pagado")).toHaveLength(2);
  });

  it("validates the program before saving it", () => {
    render(<ReferralsCenter />);
    tab("Programa");
    fireEvent.change(screen.getByLabelText("Nombre del programa"), { target: { value: "Mi programa" } });
    fireEvent.change(screen.getByLabelText("Valor de la comisión"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar programa" }));
    expect(alertText()).toContain("porcentaje");
    expect(screen.getByText("Preparado · desactivado")).toBeTruthy();
    expect((screen.getByLabelText("Activar niveles") as HTMLInputElement).disabled).toBe(true);
  });

  it("enrolls an affiliate with a unique code and a personal link", () => {
    render(<ReferralsCenter />);
    tab("Programa");
    fireEvent.change(screen.getByLabelText("Nombre del programa"), { target: { value: "Mi programa" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar programa" }));
    tab("Afiliados");
    fireEvent.change(screen.getByLabelText("Nombre del afiliado"), { target: { value: "Sofía León" } });
    fireEvent.change(screen.getByLabelText("Correo del afiliado"), { target: { value: "sofia@x.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Inscribir y generar código" }));
    expect(screen.getByText(/^https:\/\/kynova\.example\/r\/SOFI-[A-Z0-9]{4}$/)).toBeTruthy();
  });
});
