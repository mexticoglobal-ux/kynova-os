import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientsManager } from "./ClientsManager";

const T = "00000000-0000-4000-8000-0000000000b1";
const client = { id: "k1", contactId: "c1", organizationId: null, status: "active", since: "2026-11-01", notes: null, createdAt: "2026-11-01T10:00:00Z", name: "Marta Ruiz", company: "Clínica Vida", email: "marta@x.co", phone: null, wonAmountMinor: 120000 };

const calls: { path: string; method: string; body: unknown }[] = [];
let list = [client];
beforeEach(() => {
  calls.length = 0;
  list = [client];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return { ok: true, status: 200, json: async () => (path.startsWith("/api/v1/clients?") ? { clients: list } : { ok: true, id: "new" }) } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("clients", () => {
  it("lists the real clients with their revenue and status", async () => {
    render(<ClientsManager tenantId={T} canWrite />);
    expect(await screen.findByText("Marta Ruiz")).toBeInTheDocument();
    expect(screen.getByText(/Clínica Vida · marta@x.co/)).toBeInTheDocument();
    expect(screen.getByText(/Ventas ganadas/)).toBeInTheDocument();
    expect(calls[0].path).toBe(`/api/v1/clients?tenantId=${T}&status=active`);
  });

  it("creates a client from the form and reloads the list", async () => {
    render(<ClientsManager tenantId={T} canWrite />);
    await screen.findByText("Marta Ruiz");
    fireEvent.click(screen.getByRole("button", { name: "Nuevo cliente" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Luis Mora" } });
    fireEvent.change(screen.getByLabelText("Correo"), { target: { value: "luis@x.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(calls.some((call) => call.method === "POST" && call.path === "/api/v1/clients")).toBe(true));
    const post = calls.find((call) => call.method === "POST");
    expect(post?.body).toEqual({ tenantId: T, name: "Luis Mora", email: "luis@x.co" });
  });

  it("edits and archives through patches", async () => {
    render(<ClientsManager tenantId={T} canWrite />);
    fireEvent.click(await screen.findByRole("button", { name: "Editar Marta Ruiz" }));
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "+506 8888 7777" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ tenantId: T, name: "Marta Ruiz", phone: "+506 8888 7777" });

    fireEvent.click(await screen.findByRole("button", { name: "Archivar Marta Ruiz" }));
    await waitFor(() => expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    expect(calls.filter((call) => call.method === "PATCH")[1].body).toEqual({ tenantId: T, status: "inactive" });
  });

  it("hides every write action from a read-only user", async () => {
    render(<ClientsManager tenantId={T} canWrite={false} />);
    await screen.findByText("Marta Ruiz");
    expect(screen.queryByRole("button", { name: "Nuevo cliente" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Editar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Archivar/ })).not.toBeInTheDocument();
  });

  it("shows an empty state, and searches with a delay", async () => {
    list = [];
    render(<ClientsManager tenantId={T} canWrite />);
    expect(await screen.findByText("Todavía no tienes clientes")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar clientes"), { target: { value: "mar" } });
    await waitFor(() => expect(calls.some((call) => call.path.includes("search=mar"))).toBe(true));
    expect(within(screen.getByRole("group", { name: "Estado" })).getByRole("button", { name: "Activos" })).toHaveAttribute("aria-pressed", "true");
  });
});
