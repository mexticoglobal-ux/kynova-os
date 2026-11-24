import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const T = "51000000-0000-4000-8000-0000000000b1";
const state = vi.hoisted(() => ({
  session: { mode: "backend", tenantId: "51000000-0000-4000-8000-0000000000b1", role: "owner", can: (_permission: string) => true } as { mode: "demo" | "backend"; tenantId: string | null; role: string; can: (permission: string) => boolean },
  apiFetch: vi.fn(),
}));
vi.mock("@/components/session/SessionProvider", () => ({ useSession: () => state.session }));
vi.mock("@/lib/api/client", () => ({ apiFetch: state.apiFetch }));

import { YouTubeConnection } from "./YouTubeConnection";

const status = (over: Record<string, unknown> = {}) => ({
  ok: true,
  data: { configured: true, missing: [], state: "disconnected", channel: null, connectedAt: null, lastVerifiedAt: null, lastErrorCode: null, ...over },
});
const connectedStatus = (over: Record<string, unknown> = {}) => status({ state: "connected", channel: { id: "UCchannelAAAAAAAAAAAAA01", title: "Canal de Prueba" }, connectedAt: "2026-11-28T10:00:00.000Z", lastVerifiedAt: "2026-11-28T10:05:00.000Z", ...over });

const realLocation = window.location;
beforeEach(() => {
  Object.defineProperty(window, "location", { configurable: true, value: realLocation }); // one test replaces it to watch the redirect
  state.apiFetch.mockReset();
  state.session = { mode: "backend", tenantId: T, role: "owner", can: () => true };
  window.history.replaceState(null, "", "/platform/connected-apps");
});
afterEach(cleanup);

describe("YouTubeConnection", () => {
  it("never shows Conectado without a session of a company: it asks to sign in and calls nothing", () => {
    state.session = { mode: "demo", tenantId: null, role: "owner", can: () => true };
    render(<YouTubeConnection />);
    expect(screen.getByText(/Inicia sesión con una empresa/)).toBeTruthy();
    expect(screen.queryByText("Conectado")).toBeNull();
    expect(state.apiFetch).not.toHaveBeenCalled();
  });

  it("is disconnected by default and offers to connect, saying it only reads", async () => {
    state.apiFetch.mockResolvedValue(status());
    render(<YouTubeConnection />);
    expect(await screen.findByText("Desconectado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Conectar canal de YouTube" })).toBeEnabled();
    expect(screen.getByText(/No sube, programa ni publica videos/)).toBeTruthy();
    expect(screen.queryByText("Conectado")).toBeNull();
    expect(state.apiFetch).toHaveBeenCalledWith(`/api/v1/connections/youtube?tenantId=${T}`);
  });

  it("shows exactly what is missing and the setup steps when the server has no Google credentials, and cannot connect", async () => {
    state.apiFetch.mockResolvedValue(status({ configured: false, missing: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] }));
    render(<YouTubeConnection />);
    expect(await screen.findByText(/Falta configurar Google en el servidor: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET\./)).toBeTruthy();
    expect(screen.getByText(/YouTube Data API v3/)).toBeTruthy();
    expect(screen.getByText(/youtube\.readonly/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Conectar canal de YouTube" })).toBeDisabled();
    expect(screen.queryByText("Conectado")).toBeNull();
  });

  it("shows Conectado only with the channel name and id the server returned, and the dates", async () => {
    state.apiFetch.mockResolvedValue(connectedStatus());
    render(<YouTubeConnection />);
    expect(await screen.findByText("Conectado")).toBeTruthy();
    expect(screen.getByText("Canal de Prueba")).toBeTruthy();
    expect(screen.getByText("UCchannelAAAAAAAAAAAAA01")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Verificar de nuevo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desconectar" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Conectar canal de YouTube" })).toBeNull();
    expect(document.body.textContent).not.toMatch(/token|secret|v1\./i);
  });

  it("starts the authorization at Google only (a redirect to anywhere else is ignored)", async () => {
    state.apiFetch.mockResolvedValueOnce(status());
    const assign = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...window.location, assign, search: "", pathname: "/platform/connected-apps" } });
    render(<YouTubeConnection />);
    state.apiFetch.mockResolvedValueOnce({ ok: true, data: { url: "https://evil.example.test/steal" } });
    fireEvent.click(await screen.findByRole("button", { name: "Conectar canal de YouTube" }));
    await waitFor(() => expect(state.apiFetch).toHaveBeenCalledWith("/api/v1/connections/youtube/start", { body: { tenantId: T } }));
    expect(assign).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toBeTruthy();
    state.apiFetch.mockResolvedValueOnce({ ok: true, data: { url: "https://accounts.google.com/o/oauth2/v2/auth?client_id=1&state=x" } });
    fireEvent.click(screen.getByRole("button", { name: "Conectar canal de YouTube" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?client_id=1&state=x"));
  });

  it("shows an expired authorization and offers to authorize again, never as connected", async () => {
    state.apiFetch.mockResolvedValue(status({ state: "expired", lastErrorCode: "invalid_grant" }));
    render(<YouTubeConnection />);
    expect(await screen.findByText("Autorización vencida")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Autorizar YouTube de nuevo" })).toBeTruthy();
    expect(screen.queryByText("Conectado")).toBeNull();
  });

  it("shows an error with its code and lets it be verified again", async () => {
    state.apiFetch.mockResolvedValueOnce(connectedStatus({ state: "error", lastErrorCode: "provider_unavailable" }));
    render(<YouTubeConnection />);
    expect(await screen.findByText("Con error")).toBeTruthy();
    expect(screen.getByText(/provider_unavailable/)).toBeTruthy();
    state.apiFetch.mockResolvedValueOnce({ ok: true, data: { status: connectedStatus().data, code: null } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar de nuevo" }));
    expect(await screen.findByText("Conectado")).toBeTruthy();
    expect(screen.getByText(/sigue vigente y el canal coincide/)).toBeTruthy();
  });

  it("a verification that finds the authorization expired shows it as expired", async () => {
    state.apiFetch.mockResolvedValueOnce(connectedStatus());
    render(<YouTubeConnection />);
    await screen.findByText("Conectado");
    state.apiFetch.mockResolvedValueOnce({ ok: true, data: { status: status({ state: "expired", lastErrorCode: "invalid_grant" }).data, code: "invalid_grant" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar de nuevo" }));
    expect(await screen.findByText("Autorización vencida")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/venció o fue revocada/);
  });

  it("asks before disconnecting, then disconnects and shows the result", async () => {
    state.apiFetch.mockResolvedValueOnce(connectedStatus());
    render(<YouTubeConnection />);
    fireEvent.click(await screen.findByRole("button", { name: "Desconectar" }));
    expect(screen.getByText(/¿Desconectar y eliminar el permiso guardado\?/)).toBeTruthy();
    expect(state.apiFetch).toHaveBeenCalledTimes(1); // nothing was sent yet
    state.apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true, revoked: true } }).mockResolvedValueOnce(status());
    fireEvent.click(screen.getByRole("button", { name: "Sí, desconectar" }));
    expect(await screen.findByText(/se revocó en Google/)).toBeTruthy();
    expect(await screen.findByText("Desconectado")).toBeTruthy();
    expect(state.apiFetch).toHaveBeenCalledWith("/api/v1/connections/youtube/disconnect", { body: { tenantId: T } });
  });

  it("says plainly when Google could not confirm the revocation", async () => {
    state.apiFetch.mockResolvedValueOnce(connectedStatus());
    render(<YouTubeConnection />);
    fireEvent.click(await screen.findByRole("button", { name: "Desconectar" }));
    state.apiFetch.mockResolvedValueOnce({ ok: true, data: { ok: true, revoked: false } }).mockResolvedValueOnce(status());
    fireEvent.click(screen.getByRole("button", { name: "Sí, desconectar" }));
    expect(await screen.findByText(/No se pudo confirmar la revocación en Google/)).toBeTruthy();
  });

  it("gives a member or viewer no buttons to manage, and explains who can", async () => {
    state.session = { mode: "backend", tenantId: T, role: "member", can: (permission) => permission !== "admin" && permission !== "owner" };
    state.apiFetch.mockResolvedValue(connectedStatus());
    render(<YouTubeConnection />);
    expect(await screen.findByText("Conectado")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Desconectar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Verificar de nuevo" })).toBeNull();
    expect(screen.getByText(/Solo el propietario o un administrador/)).toBeTruthy();
  });

  it("a forbidden or failing status shows a message and never Conectado", async () => {
    state.apiFetch.mockResolvedValue({ ok: false, error: "forbidden", status: 403 });
    render(<YouTubeConnection />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Solo el propietario o un administrador/);
    expect(screen.queryByText("Conectado")).toBeNull();
    cleanup();
    state.apiFetch.mockResolvedValue({ ok: false, error: "unavailable", status: 0 });
    render(<YouTubeConnection />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/No pudimos completar/);
  });

  it("reads the result of the OAuth return from the address, shows it once and cleans the address", async () => {
    window.history.replaceState(null, "", "/platform/connected-apps?youtube_error=account_taken");
    state.apiFetch.mockResolvedValue(status());
    render(<YouTubeConnection />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/ya está conectado a otra empresa/);
    expect(window.location.search).toBe("");
    cleanup();
    window.history.replaceState(null, "", "/platform/connected-apps?youtube=connected");
    state.apiFetch.mockResolvedValue(connectedStatus());
    render(<YouTubeConnection />);
    expect(await screen.findByText(/KYNOVA confirmó su nombre e identificador con YouTube/)).toBeTruthy();
    cleanup();
    window.history.replaceState(null, "", "/platform/connected-apps?youtube_error=<script>");
    state.apiFetch.mockResolvedValue(status());
    render(<YouTubeConnection />);
    expect((await screen.findByRole("alert")).textContent).toMatch(/No pudimos completar/); // an unknown word is never shown as it came
  });
});
