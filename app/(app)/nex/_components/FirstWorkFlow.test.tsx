import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/lib/contracts/pipeline";
import { DRAFT_MARK } from "@/lib/first-work";

const T = "00000000-0000-4000-8000-0000000000b1";
const state = vi.hoisted(() => ({
  session: { mode: "backend", tenantId: "00000000-0000-4000-8000-0000000000b1", tenantName: "Nova Marketing Studio", role: "owner" } as { mode: "demo" | "backend"; tenantId?: string; tenantName?: string; role: "owner" | "viewer" },
  pipeline: { sorted: [] as unknown[], canWrite: true },
  apiFetch: vi.fn(),
}));
vi.mock("@/components/session/SessionProvider", () => ({ useSession: () => state.session }));
vi.mock("@/components/pipeline/PipelineProvider", () => ({ usePipeline: () => state.pipeline }));
vi.mock("@/lib/api/client", () => ({ apiFetch: state.apiFetch }));

import { FirstWorkFlow } from "./FirstWorkFlow";

const lead = { id: "l1", company: "Café Sol", contactName: "Ana", contact: { method: "email", value: "a@x.example" }, grade: "warm", stage: "new", nextAction: "Enviar información", approval: null } as unknown as Lead;
const props = () => ({ onExit: vi.fn(), onDeepen: vi.fn(), onSave: vi.fn(), saveFailed: false });
const serverResult = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: {
    source: "rules", reason: "disabled", label: "Redactado por reglas de KYNOVA a partir de sus dos frases, no por un modelo de IA. El modelo de IA está desactivado.",
    draft: { message: "MENSAJE DEL SERVIDOR", presentation: "PRESENTACIÓN DEL SERVIDOR" }, needsContext: [], ...over,
  },
});
const type = (offer: string, audience: string) => {
  fireEvent.change(screen.getByLabelText("¿Qué ofrece su empresa?"), { target: { value: offer } });
  fireEvent.change(screen.getByLabelText("¿A quién se dirige?"), { target: { value: audience } });
};

afterEach(() => {
  cleanup();
  state.session = { mode: "backend", tenantId: T, tenantName: "Nova Marketing Studio", role: "owner" };
  state.pipeline = { sorted: [], canWrite: true };
  state.apiFetch.mockReset();
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
    type("campañas de marketing", "restaurantes");
    expect(screen.getAllByText(/Lo que ofrecemos: campañas de marketing\. Trabajamos con: restaurantes\./).length).toBeGreaterThan(0);
    expect(screen.queryByText(/\[completar: (qué ofrece|a quién)/)).toBeNull();
  });

  it("distinguishes consulted data, rule-generated content and the simulated chat, without saying NEX has no data connection", () => {
    state.pipeline = { sorted: [lead], canWrite: true };
    render(<FirstWorkFlow {...props()} />);
    const origin = screen.getByText("De dónde sale esto").closest("section")?.textContent ?? "";
    expect(origin).toContain("Datos consultados: su empresa (Nova Marketing Studio), su rol y 1 prospecto del Pipeline");
    expect(origin).toContain("generado por reglas de KYNOVA");
    expect(origin).toContain("el modelo de IA está desactivado");
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
    expect(p.onSave.mock.calls[0]?.[0]).toContain("Origen del texto: Reglas de KYNOVA en su pantalla; no se consultó al servidor.");
    expect(p.onSave.mock.calls[0]?.[1]).toBe("Captación: mensaje y presentación");
    expect(screen.getByText("Borrador guardado")).toBeTruthy();
  });

  it("a follow-up draft is saved under the follow-up title", () => {
    state.pipeline = { sorted: [lead], canWrite: true };
    const p = props();
    render(<FirstWorkFlow {...p} />);
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    expect(p.onSave.mock.calls[0]?.[1]).toBe("Seguimiento: prospectos");
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

describe("FirstWorkFlow · the server draft (the model stays off)", () => {
  it("asks the route only when the person presses the button, with the company and the two phrases, and never on its own", async () => {
    state.apiFetch.mockResolvedValue(serverResult());
    render(<FirstWorkFlow {...props()} />);
    type("campañas de marketing", "restaurantes");
    expect(state.apiFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Redactar con NEX" }));
    await waitFor(() => expect(screen.getByText("MENSAJE DEL SERVIDOR")).toBeTruthy());
    expect(state.apiFetch).toHaveBeenCalledTimes(1);
    expect(state.apiFetch).toHaveBeenCalledWith("/api/v1/nex/draft", { body: { tenantId: T, offer: "campañas de marketing", audience: "restaurantes" } });
  });

  it("shows who wrote it and why: the rules, because the model is off; the typed phrases and the saved draft are kept", async () => {
    state.apiFetch.mockResolvedValue(serverResult());
    const p = props();
    render(<FirstWorkFlow {...p} />);
    type("campañas de marketing", "restaurantes");
    fireEvent.click(screen.getByRole("button", { name: "Redactar con NEX" }));
    await waitFor(() => expect(screen.getByText("PRESENTACIÓN DEL SERVIDOR")).toBeTruthy());
    expect(screen.getByText(/Origen del texto: Redactado por reglas de KYNOVA .* no por un modelo de IA\. El modelo de IA está desactivado\./)).toBeTruthy();
    expect((screen.getByLabelText("¿Qué ofrece su empresa?") as HTMLInputElement).value).toBe("campañas de marketing");
    expect((screen.getByLabelText("¿A quién se dirige?") as HTMLInputElement).value).toBe("restaurantes");
    fireEvent.click(screen.getByRole("button", { name: "Guardar borrador" }));
    const saved = String(p.onSave.mock.calls[0]?.[0]);
    expect(saved).toContain("MENSAJE DEL SERVIDOR");
    expect(saved).toContain("Origen del texto: Redactado por reglas de KYNOVA");
    expect(p.onSave.mock.calls[0]?.[1]).toBe("Captación: mensaje y presentación");
  });

  it("a fallback reason the server gives is shown as it is, not hidden", async () => {
    state.apiFetch.mockResolvedValue(serverResult({ reason: "provider_error", label: "Redactado por reglas de KYNOVA a partir de sus dos frases, no por un modelo de IA. El modelo no respondió." }));
    render(<FirstWorkFlow {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Redactar con NEX" }));
    await waitFor(() => expect(screen.getByText(/El modelo no respondió\./)).toBeTruthy());
  });

  it("when the phrases change after the answer, the server's draft is no longer shown as current and the rules draft returns, with the fields kept", async () => {
    state.apiFetch.mockResolvedValue(serverResult());
    render(<FirstWorkFlow {...props()} />);
    type("campañas", "restaurantes");
    fireEvent.click(screen.getByRole("button", { name: "Redactar con NEX" }));
    await waitFor(() => expect(screen.getByText("MENSAJE DEL SERVIDOR")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("¿A quién se dirige?"), { target: { value: "cafés" } });
    expect(screen.queryByText("MENSAJE DEL SERVIDOR")).toBeNull();
    expect(screen.getByText(/Cambió el texto: pulse «Redactar con NEX»/)).toBeTruthy();
    expect(screen.getAllByText(/Trabajamos con: cafés\./).length).toBeGreaterThan(0);
  });

  it("a refused permission (403) is said as a permission problem, never as a provider failure, and the rules draft stays", async () => {
    state.apiFetch.mockResolvedValue({ ok: false, error: "forbidden", status: 403 });
    render(<FirstWorkFlow {...props()} />);
    type("campañas de marketing", "restaurantes");
    fireEvent.click(screen.getByRole("button", { name: "Redactar con NEX" }));
    const notice = await screen.findByText(/no permite pedir este borrador al servidor/);
    expect(notice.textContent).toContain("Su rol (Propietario)");
    expect(notice.textContent).toContain("Se muestra el borrador por reglas de su pantalla");
    const all = document.body.textContent ?? "";
    expect(all).not.toMatch(/El modelo no respondió|proveedor|no se pudo consultar el servidor/i);
    expect(screen.getAllByText(/Lo que ofrecemos: campañas de marketing\./).length).toBeGreaterThan(0);
    expect((screen.getByLabelText("¿Qué ofrece su empresa?") as HTMLInputElement).value).toBe("campañas de marketing");
  });

  it("an expired session, bad phrases and an unreachable server each have their own sentence, none of them about the model", async () => {
    const cases: [number, string, RegExp][] = [[401, "unauthorized", /Su sesión terminó/], [400, "invalid_request", /Revise las frases/], [503, "unavailable", /No se pudo consultar el servidor/], [0, "unavailable", /No se pudo consultar el servidor/]];
    for (const [status, error, expected] of cases) {
      state.apiFetch.mockResolvedValue({ ok: false, error, status });
      render(<FirstWorkFlow {...props()} />);
      fireEvent.click(screen.getByRole("button", { name: "Redactar con NEX" }));
      const notice = await screen.findByText(expected);
      expect(notice.textContent, String(status)).toContain("Se muestra el borrador por reglas de su pantalla");
      expect(document.body.textContent ?? "").not.toMatch(/El modelo no respondió/);
      cleanup();
    }
  });

  it("a body that is not a draft result is treated as an unreachable server, not believed", async () => {
    state.apiFetch.mockResolvedValue({ ok: true, data: { surprise: true } });
    render(<FirstWorkFlow {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Redactar con NEX" }));
    expect(await screen.findByText(/No se pudo consultar el servidor/)).toBeTruthy();
  });

  it("a role without write permission cannot press the button, and is told why", () => {
    state.session = { mode: "backend", tenantId: T, tenantName: "Nova Marketing Studio", role: "viewer" };
    state.pipeline = { sorted: [], canWrite: false };
    render(<FirstWorkFlow {...props()} />);
    expect((screen.getByRole("button", { name: "Redactar con NEX" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Su rol \(Solo lectura\) no permite pedir este borrador al servidor/)).toBeTruthy();
    expect(state.apiFetch).not.toHaveBeenCalled();
  });

  it("the demonstration has no server to ask: no button, and the origin says so", () => {
    state.session = { mode: "demo", role: "owner" };
    render(<FirstWorkFlow {...props()} />);
    expect(screen.queryByRole("button", { name: "Redactar con NEX" })).toBeNull();
    expect(screen.getByText(/Origen del texto: Reglas de KYNOVA en su pantalla \(modo demostración\)\./)).toBeTruthy();
  });
});
