import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PLATFORM_SECTIONS, sectionInfo } from "./catalog";
import { ConnectedApps } from "./ConnectedApps";

afterEach(cleanup);

const row = (label: string) => screen.getByRole("table", { name: "Aplicaciones conectadas" }).querySelector(`tr:has(button[aria-label$="${label}"])`) as HTMLElement;

describe("ConnectedApps", () => {
  it("lists the twelve apps as disconnected, says nothing is contacted or stored, and shows the health of the eight provider groups", () => {
    render(<ConnectedApps />);
    expect(screen.getByText(/0 de 12 conectadas/)).toBeTruthy();
    expect(screen.getByText(/no se contacta a ningún proveedor ni se guarda ninguna credencial/)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Aplicaciones conectadas" });
    expect(within(table).getAllByText("Desconectada")).toHaveLength(12);
    for (const header of ["Aplicación", "Estado", "Última sincronización", "Permisos", "Empresa"]) expect(within(table).getByRole("columnheader", { name: header })).toBeTruthy();
    const health = within(screen.getByRole("list", { name: "Salud por proveedor" }));
    for (const name of ["Google", "Microsoft", "Meta", "YouTube", "WhatsApp", "LinkedIn", "TikTok", "Drive"]) expect(health.getByText(name)).toBeTruthy();
    expect(health.getAllByText("Operativo")).toHaveLength(8);
    for (const name of ["Gmail", "Outlook", "Google Calendar", "Microsoft Calendar", "Google Drive", "OneDrive", "WhatsApp Business", "Facebook Pages", "Instagram Business", "LinkedIn Company", "YouTube", "TikTok Business"]) {
      expect(screen.getByRole("button", { name: `Conectar ${name}` })).toBeTruthy();
    }
  });

  it("connects an app through the authorization flow, shows its state, permissions (all off) and company, and offers Desconectar", () => {
    render(<ConnectedApps />);
    fireEvent.click(screen.getByRole("button", { name: "Conectar Gmail" }));
    expect(screen.getByText(/1 de 12 conectadas/)).toBeTruthy();
    const gmail = within(row("Gmail"));
    expect(gmail.getByText("Conectada")).toBeTruthy();
    expect(gmail.getByText("Leer correos: apagado")).toBeTruthy();
    expect(gmail.getByText("tenant-demo")).toBeTruthy();
    expect(gmail.getByText("Nunca")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Conectar Gmail" })).toBeNull();
    expect(gmail.getByRole("button", { name: "Desconectar Gmail" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Conectar Outlook" })).toBeTruthy();
  });

  it("disconnects an app and lets it be connected again", () => {
    render(<ConnectedApps />);
    fireEvent.click(screen.getByRole("button", { name: "Conectar YouTube" }));
    fireEvent.click(screen.getByRole("button", { name: "Conectar TikTok Business" }));
    expect(screen.getByText(/2 de 12 conectadas/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desconectar YouTube" }));
    expect(screen.getByText(/1 de 12 conectadas/)).toBeTruthy();
    expect(within(row("YouTube")).getByText("Desconectada")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Conectar YouTube" }));
    expect(screen.getByText(/2 de 12 conectadas/)).toBeTruthy();
  });

  it("explains that AI agents never reach a provider and that each company authorizes only its own accounts", () => {
    render(<ConnectedApps />);
    expect(screen.getByText(/Cada empresa autoriza solo sus cuentas/)).toBeTruthy();
    expect(screen.getByText(/Los Agentes IA no hablan con ningún proveedor/)).toBeTruthy();
  });

  it("shows the Google Workspace panel: account, state, last sync, last email, event and file, and a health score that rises with a sync", () => {
    render(<ConnectedApps />);
    const panel = screen.getByRole("table", { name: "Google Workspace" });
    for (const header of ["Cuenta", "Estado", "Última sincronización", "Último correo", "Último evento", "Último archivo", "Health Score"]) expect(within(panel).getByRole("columnheader", { name: header })).toBeTruthy();
    expect(within(panel).getByText("Gmail")).toBeTruthy();
    expect(within(panel).getByText("Google Calendar")).toBeTruthy();
    expect(within(panel).getByText("Google Drive")).toBeTruthy();
    expect(within(panel).getByLabelText("Health Score de Gmail").textContent).toBe("0");
    fireEvent.click(screen.getByRole("button", { name: "Conectar Gmail" }));
    expect(within(panel).getByText("cuenta-de-ejemplo@gmail.test")).toBeTruthy();
    expect(within(panel).getByLabelText("Health Score de Gmail").textContent).toBe("70");
    fireEvent.click(within(panel).getByRole("button", { name: "Sincronizar Gmail (ejemplo)" }));
    expect(within(panel).getByLabelText("Health Score de Gmail").textContent).toBe("100");
    expect(within(panel).queryAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText(/nunca se muestra el contenido de un correo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desconectar Gmail" }));
    expect(within(panel).getByLabelText("Health Score de Gmail").textContent).toBe("0");
  });

  it("is registered as a platform section with its own address", () => {
    expect(sectionInfo("connectedApps")).toMatchObject({ href: "/platform/connected-apps", title: "Apps conectadas" });
    expect(PLATFORM_SECTIONS.map((item) => item.key)).toContain("connectedApps");
  });
});
