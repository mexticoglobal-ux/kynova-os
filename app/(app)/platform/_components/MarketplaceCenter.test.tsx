import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarketplaceCenter } from "./MarketplaceCenter";

afterEach(cleanup);

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
const loadSample = () => fireEvent.click(screen.getByRole("button", { name: "Cargar datos de ejemplo" }));
const actAs = (id: string) => fireEvent.change(screen.getByRole("combobox", { name: "Actuar como" }), { target: { value: id } });
const alertText = () => screen.getByRole("alert").textContent ?? "";
// a listing card is an <li>; an open detail panel is a <section> with the same heading, so only look at cards
const card = (name: string) => screen.getAllByRole("heading", { name }).map((heading) => heading.closest("li")).find((item): item is HTMLLIElement => item !== null) as HTMLElement;
const row = (text: RegExp | string) => screen.getByText(text).closest("li") as HTMLElement;
const open = (name: string) => fireEvent.click(within(card(name)).getByRole("button", { name: "Ver detalle" }));

describe("MarketplaceCenter", () => {
  it("starts empty and says there are no APIs or real payments", () => {
    render(<MarketplaceCenter />);
    expect(screen.getByText(/sin APIs ni pagos reales/)).toBeTruthy();
    expect(screen.getByText("Sin resultados")).toBeTruthy();
  });

  it("loads the sample once, searches, and filters", () => {
    render(<MarketplaceCenter />);
    loadSample();
    expect(screen.getByText("4 resultados")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Cargar datos de ejemplo" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "CLINICAS" } });
    expect(screen.getByText("1 resultados")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "free" } });
    expect(screen.getByText("1 resultados")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Plantillas de WhatsApp" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Precio"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Tipo"), { target: { value: "app" } });
    expect(screen.getByRole("heading", { name: "Reservas rápidas" })).toBeTruthy();
  });

  it("does not let a company buy its own listing, and lets another one subscribe", () => {
    render(<MarketplaceCenter />);
    loadSample();
    open("Marketing para clínicas"); // Nova is the seller
    fireEvent.click(screen.getByRole("button", { name: "Comprar (simulado)" }));
    expect(alertText()).toContain("propia");

    actAs("mar-marco");
    fireEvent.click(within(card("Marketing para clínicas")).getByRole("button", { name: "Cerrar" })); // close the detail left open
    open("Asistente de seguimiento");
    fireEvent.click(screen.getByRole("button", { name: "Suscribirse (simulado)" }));
    expect(screen.getByText("Ya lo tiene")).toBeTruthy();
    tab("Mis compras");
    expect(screen.getByText(/Asistente de seguimiento · Suscripción/)).toBeTruthy();
  });

  it("shows each company only its own purchases", () => {
    render(<MarketplaceCenter />);
    loadSample();
    actAs("vida-lucia");
    tab("Mis compras");
    expect(screen.getByText(/Marketing para clínicas · Precio único/)).toBeTruthy();
    actAs("nova-ana");
    expect(screen.queryByText(/Marketing para clínicas · Precio único/)).toBeNull();
  });

  it("lets NEX prepare a draft but not send it to review", () => {
    render(<MarketplaceCenter />);
    loadSample();
    actAs("nex");
    tab("Vender");
    expect(screen.getByText(/borrador preparado por NEX/)).toBeTruthy();
    fireEvent.click(within(row(/Aviso de prospecto caliente/)).getByRole("button", { name: "Enviar a revisión" }));
    expect(alertText()).toContain("NEX no puede");
  });

  it("publishes only after an administrator approves", () => {
    render(<MarketplaceCenter />);
    loadSample();
    tab("Vender");
    fireEvent.click(within(row(/Aviso de prospecto caliente/)).getByRole("button", { name: "Enviar a revisión" })); // a person submits NEX's draft
    expect(within(row(/Aviso de prospecto caliente/)).getByText("En revisión")).toBeTruthy();
    tab("Catálogo");
    expect(screen.getByText("4 resultados")).toBeTruthy(); // still not in the catalog

    actAs("vida-lucia");
    tab("Moderación");
    expect(screen.getByText("Solo administración")).toBeTruthy();

    actAs("admin-bruno");
    expect(screen.getByText("Cola de revisión (2)")).toBeTruthy();
    fireEvent.click(within(row(/Aviso de prospecto caliente/)).getByRole("button", { name: "Aprobar" }));
    tab("Catálogo");
    expect(screen.getByText("5 resultados")).toBeTruthy();
  });

  it("requires a reason to reject", () => {
    render(<MarketplaceCenter />);
    loadSample();
    actAs("admin-bruno");
    tab("Moderación");
    fireEvent.click(within(row(/Auditoría comercial/)).getByRole("button", { name: "Rechazar" }));
    expect(alertText()).toContain("motivo");
  });

  it("needs a second administrator for a revenue-share change", () => {
    render(<MarketplaceCenter />);
    loadSample();
    actAs("nova-ana");
    tab("Administración");
    expect(screen.getByText("Solo administración")).toBeTruthy();

    actAs("admin-ana");
    fireEvent.click(screen.getByRole("button", { name: "Aprobar cambio" })); // Ana proposed it in the sample
    expect(alertText()).toContain("no puede aprobarlo");

    actAs("nex");
    expect(screen.getByText("Solo administración")).toBeTruthy();

    actAs("admin-bruno");
    fireEvent.click(screen.getByRole("button", { name: "Aprobar cambio" }));
    expect(within(screen.getByText("Reparto por defecto").closest("li") as HTMLElement).getByText("20 %")).toBeTruthy();
  });

  it("settles a seller in three steps and records an outside reference", () => {
    render(<MarketplaceCenter />);
    loadSample();
    actAs("admin-bruno");
    tab("Administración");
    fireEvent.click(screen.getByRole("button", { name: "Aprobar liquidación" })); // Ana requested Hotel Mar's in the sample
    const approved = row(/Hotel Mar · .* Aprobada/);
    fireEvent.click(within(approved).getByRole("button", { name: "Marcar como pagada" }));
    expect(alertText()).toContain("referencia");
    fireEvent.change(within(approved).getByLabelText(/Referencia de st_/), { target: { value: "TRANSFERENCIA-77" } });
    fireEvent.click(within(approved).getByRole("button", { name: "Marcar como pagada" }));
    expect(screen.getByText(/Hotel Mar · .* Pagada · solicita admin:ana · TRANSFERENCIA-77/)).toBeTruthy();
  });

  it("creates a draft from the form and refuses a bad price", () => {
    render(<MarketplaceCenter />);
    tab("Vender");
    fireEvent.change(screen.getByLabelText("Nombre de la publicación"), { target: { value: "Mi servicio" } });
    fireEvent.change(screen.getByLabelText("Modelo de precio"), { target: { value: "oneTime" } });
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(screen.getByRole("alert").textContent).toContain("Precio inválido");
    fireEvent.change(screen.getByLabelText("Importe"), { target: { value: "12.50" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear borrador" }));
    expect(screen.getByText(/Mi servicio · Recurso digital/)).toBeTruthy();
  });
});
