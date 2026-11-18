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
  it("takes company and role from the session, recommends a priority and delivers a plan without asking for anything else", () => {
    render(<FirstWorkFlow {...props()} />);
    expect(screen.getByText(/Nova Marketing Studio · su rol: Propietario/)).toBeTruthy();
    expect(screen.getByText("Tener a quién atender: preparar la captación")).toBeTruthy();
    expect(screen.getByText("Plan de captación de 7 días")).toBeTruthy();
    expect(screen.queryByText(/presupuesto|quién decide/i)).toBeNull();
    expect(screen.getByText(/Acciones ejecutadas:/).parentElement?.textContent).toContain("ninguna");
  });

  it("saves a draft only when asked, and then says it is saved", () => {
    const p = props();
    render(<FirstWorkFlow {...p} />);
    expect(p.onSave).not.toHaveBeenCalled();
    expect(screen.getByText("Ejemplo")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(p.onSave).toHaveBeenCalledTimes(1);
    expect(p.onSave.mock.calls[0]?.[0]).toMatch(new RegExp(`^${DRAFT_MARK}`));
    expect(screen.getByText("Borrador guardado")).toBeTruthy();
  });

  it("with the company's prospects it builds the plan from them", () => {
    state.pipeline = { sorted: [lead], canWrite: true };
    render(<FirstWorkFlow {...props()} />);
    expect(screen.getByText("Plan de seguimiento de 7 días")).toBeTruthy();
    expect(screen.getAllByText(/Café Sol/).length).toBeGreaterThan(0);
    expect(screen.getByText("Borrador sin guardar")).toBeTruthy();
  });

  it("offers to go deeper (optional) and to leave", () => {
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
