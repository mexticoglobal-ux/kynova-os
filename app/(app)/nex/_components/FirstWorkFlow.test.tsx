import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/lib/contracts/pipeline";
import { DRAFT_MARK } from "@/lib/first-work";

const state = vi.hoisted(() => ({
  session: { mode: "backend", tenantName: "Nova Marketing Studio", role: "owner" } as { mode: "demo" | "backend"; tenantName?: string; role: "owner" | "viewer" },
  pipeline: { sorted: [] as unknown[], canWrite: true },
}));
vi.mock("@/components/session/SessionProvider", () => ({ useSession: () => state.session }));
vi.mock("@/components/pipeline/PipelineProvider", () => ({ usePipeline: () => state.pipeline }));

import { FirstWorkFlow } from "./FirstWorkFlow";

const lead = { id: "l1", company: "Café Sol", contactName: "Ana", contact: { method: "email", value: "a@x.example" }, grade: "warm", stage: "new", nextAction: "Enviar información", approval: null } as unknown as Lead;
const props = () => ({ onExit: vi.fn(), onDeepen: vi.fn(), onSave: vi.fn(), saveFailed: false });

afterEach(() => {
  cleanup();
  state.session = { mode: "backend", tenantName: "Nova Marketing Studio", role: "owner" };
  state.pipeline = { sorted: [], canWrite: true };
});

describe("FirstWorkFlow", () => {
  it("takes company and role from the session and shows a ready draft without asking for anything required", () => {
    render(<FirstWorkFlow {...props()} />);
    expect(screen.getByText(/Nova Marketing Studio · su rol: Propietario/)).toBeTruthy();
    expect(screen.getByText("Propuesta de mensaje y presentación")).toBeTruthy();
    expect(screen.getByText(/Mensaje propuesto · no enviado/)).toBeTruthy();
    expect(screen.getByText(/Pieza de presentación \(borrador\) · no enviado/)).toBeTruthy();
    expect(screen.queryByText(/presupuesto|quién decide/i)).toBeNull();
    expect(screen.getByText(/Acciones ejecutadas:/).parentElement?.textContent).toContain("ninguna");
  });

  it("with a prospect in the Pipeline, choosing capture does not claim there are none", () => {
    state.pipeline = { sorted: [lead], canWrite: true };
    render(<FirstWorkFlow {...props()} />);
    expect(screen.getByText(/Prospectos en el Pipeline: 1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Conseguir más clientes/ }));
    expect(screen.getByText(/Ya tiene 1 prospecto abierto/)).toBeTruthy();
    expect(screen.queryByText(/Todavía no hay prospectos/)).toBeNull();
  });

  it("the two optional sentences fill the draft; left empty it says [completar] and invents nothing", () => {
    render(<FirstWorkFlow {...props()} />);
    expect(screen.getAllByText(/\[completar: qué ofrece su empresa/).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("¿Qué ofrece su empresa?"), { target: { value: "campañas de marketing" } });
    fireEvent.change(screen.getByLabelText("¿A quién se dirige?"), { target: { value: "restaurantes" } });
    expect(screen.getAllByText(/Nos dedicamos a campañas de marketing, pensado para restaurantes\./).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\[completar: (qué ofrece|a quién)/)).toBeNull();
  });

  it("distinguishes consulted data, rule-generated content and the simulated chat, without saying NEX has no data connection", () => {
    state.pipeline = { sorted: [lead], canWrite: true };
    render(<FirstWorkFlow {...props()} />);
    const origin = screen.getByText("De dónde sale esto").closest("section")?.textContent ?? "";
    expect(origin).toContain("Datos consultados: su empresa (Nova Marketing Studio), su rol y 1 prospecto del Pipeline");
    expect(origin).toContain("generado por reglas de KYNOVA");
    expect(origin).toContain("Chat libre de NEX: sigue siendo simulado");
    expect(origin).not.toMatch(/no está conectado a tus datos/);
  });

  it("saves a draft only when asked, and then says it is saved", () => {
    const p = props();
    render(<FirstWorkFlow {...p} />);
    expect(p.onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Borrador sin guardar")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(p.onSave).toHaveBeenCalledTimes(1);
    expect(p.onSave.mock.calls[0]?.[0]).toMatch(new RegExp(`^${DRAFT_MARK}`));
    expect(screen.getByText("Borrador guardado")).toBeTruthy();
  });

  it("states that execution depends on connected channels and configured permissions, and that none happens today", () => {
    render(<FirstWorkFlow {...props()} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Hoy no se ejecutan envíos");
    expect(text).toContain("dependerá de los canales que se conecten y de los permisos que se configuren");
  });

  it("keeps the diagnostic optional and lets the person leave", () => {
    const p = props();
    render(<FirstWorkFlow {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Profundizar/ }));
    expect(p.onDeepen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Volver/ }));
    expect(p.onExit).toHaveBeenCalled();
  });

  it("shows when saving failed", () => {
    render(<FirstWorkFlow {...props()} saveFailed />);
    expect(screen.getByRole("alert").textContent).toContain("No se pudo guardar");
  });
});
