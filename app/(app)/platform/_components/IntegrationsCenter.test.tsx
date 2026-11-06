import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { IntegrationsCenter } from "./IntegrationsCenter";

afterEach(cleanup);

const open = (label: string) => {
  const card = screen.getByRole("heading", { name: label }).closest("li") as HTMLElement;
  fireEvent.click(within(card).getByRole("button", { name: "Administrar" }));
};

describe("IntegrationsCenter", () => {
  it("lists every provider as not connected and says nothing is contacted", () => {
    render(<IntegrationsCenter />);
    expect(screen.getByText(/no se contacta a ningún proveedor/)).toBeTruthy();
    expect(screen.getAllByText("No conectado")).toHaveLength(11);
  });

  it("blocks activation until the configuration is complete, then activates and deactivates with an audit trail", () => {
    render(<IntegrationsCenter />);
    open("Stripe");
    const panel = screen.getByRole("region", { name: "Administrar Stripe" });
    expect((within(panel).getByRole("button", { name: "Activar" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(panel).getAllByRole("textbox")[0], { target: { value: "Cobros" } });
    fireEvent.change(within(panel).getByRole("combobox", { name: /Modo/ }), { target: { value: "test" } });
    fireEvent.change(within(panel).getByPlaceholderText("secret:nombre"), { target: { value: "secret:stripe-main" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Guardar configuración" }));
    fireEvent.click(within(panel).getByRole("button", { name: "Activar" }));
    expect(screen.getAllByText("Activo")).toHaveLength(1);
    expect(within(panel).getByText("demo · activate")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Desactivar" }));
    expect(within(panel).getByText("demo · deactivate")).toBeTruthy();
  });

  it("never offers an unattended grant for sending messages", () => {
    render(<IntegrationsCenter />);
    open("WhatsApp");
    const select = screen.getByLabelText("Permiso sendMessages") as unknown as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual(["off", "approval"]);
  });

  it("refuses to activate a provider whose API is still unknown", () => {
    render(<IntegrationsCenter />);
    open("MakaPay");
    const panel = screen.getByRole("region", { name: "Administrar MakaPay" });
    expect((within(panel).getByRole("button", { name: "Activar" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByText(/documentación técnica/)).toBeTruthy();
  });
});
