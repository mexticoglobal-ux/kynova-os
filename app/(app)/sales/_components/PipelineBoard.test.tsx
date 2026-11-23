import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineProvider } from "@/components/pipeline/PipelineProvider";
import { PipelineBoard } from "./PipelineBoard";

const T = "00000000-0000-4000-8000-0000000000b1";
const base = {
  contactId: "c1", conversationId: null, grade: "warm", points: 5, priority: "medium", challenge: null, question: null,
  qualification: { reasons: [], services: [], topGaps: [], treatment: "usted" }, nextActionText: "Decidir cómo continuar con este prospecto", nextActionAt: "2030-01-01T00:00:00Z",
  ownerUserId: null, ownerName: null, createdAt: "2026-01-01T00:00:00Z", convertedOpportunityId: null, assessment: null, meetingApproved: false, approval: null,
};
// two fictitious prospects: one that can be reached and one with no contact at all
const withContact = { ...base, id: "l1", contactName: "Ana", company: "Café Sol", email: "ana@cafesol.example", phone: null };
const noContact = { ...base, id: "l2", contactName: "Luis", company: "Taller Norte", email: null, phone: null };
const server = {
  since: "2026-11-05T00:00:00Z", sinceVisit: { analyzed: 0, prospects: 0, hot: 0, conversations: 0, won: 0 }, leads: { open: 2, hot: 0, needFollowUp: 0, total: 2 },
  approvals: { pending: 0, items: [] }, opportunities: { open: 0, won: 0, openAmountMinor: 0, wonAmountMinor: 0 }, customers: { active: 0 }, conversations: { open: 0, messagesToday: 0 }, activity: [],
};

/** A tiny server: the status of each prospect is kept between requests, as the database keeps it, so a reload reads what was recorded. */
function installServer() {
  const status: Record<string, string> = { l1: "new", l2: "new" };
  const calls: { path: string; method: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const patch = /^\/api\/v1\/leads\/(l\d)\/status$/.exec(path);
    if (patch && method === "PATCH") { status[patch[1] as string] = (JSON.parse(String(init?.body)) as { status: string }).status; return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response; }
    const data = path.startsWith("/api/v1/leads?") ? { leads: [{ ...withContact, status: status["l1"] }, { ...noContact, status: status["l2"] }] } : path.startsWith("/api/v1/dashboard") ? server : { ok: true };
    return { ok: true, status: 200, json: async () => data } as Response;
  }));
  return { calls, status };
}

/** The text of a card's "Estado" field. */
const estado = (id: string): string => within(screen.getByTestId(`lead-${id}`)).getByText("Estado").parentElement?.querySelector("dd")?.textContent ?? "";

const mount = () => render(<PipelineProvider backend={{ tenantId: T }} seed={false}><PipelineBoard /></PipelineProvider>);
const card = (id: string) => screen.findByTestId(`lead-${id}`);

beforeEach(() => vi.unstubAllGlobals());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Ventas: registrar el seguimiento de un prospecto y conservarlo al recargar", () => {
  it("a prospect that can be reached: the follow-up is recorded through the server, shows 'En seguimiento' and is still there after reloading; nothing is marked as sent", async () => {
    const { calls } = installServer();
    mount();
    const first = within(await card("l1"));
    expect(first.queryByText("En seguimiento", { selector: "span" })).toBeNull();
    expect(estado("l1")).toBe("Nuevo");
    await userEvent.click(first.getByRole("button", { name: "Registrar seguimiento" }));
    await waitFor(() => expect(estado("l1")).toBe("En seguimiento"));
    expect(within(screen.getByTestId("lead-l1")).getByText("En seguimiento", { selector: "span" })).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "PATCH")).toEqual([{ path: "/api/v1/leads/l1/status", method: "PATCH", body: { status: "working" } }]);
    expect(within(screen.getByTestId("lead-l1")).queryByRole("button", { name: "Registrar seguimiento" })).toBeNull();
    // the field "Estado" says it too (it used to keep saying "Nuevo")
    expect(estado("l1")).toBe("En seguimiento");
    expect(screen.getByTestId("lead-l1").textContent).toContain("No se envió ningún mensaje");
    // reload: a new mount reads the status the server kept
    cleanup();
    mount();
    expect(within(await card("l1")).getByText("En seguimiento", { selector: "span" })).toBeInTheDocument();
    expect(estado("l1")).toBe("En seguimiento"); // read from the stored status after the reload
    expect(screen.queryByText(/enviado a|mensaje enviado/i)).toBeNull();
  });

  it("a prospect without any contact keeps 'En espera' before and after recording the follow-up, and after reloading; nothing is sent", async () => {
    installServer();
    mount();
    const waiting = within(await card("l2"));
    expect(waiting.getByText("En espera", { selector: "span" })).toBeInTheDocument();
    expect(estado("l2")).toBe("En espera");
    expect(waiting.getByText(/sin contacto/)).toBeInTheDocument();
    await userEvent.click(waiting.getByRole("button", { name: "Registrar seguimiento" }));
    await waitFor(() => expect(screen.getByTestId("lead-l2").textContent).toContain("Seguimiento registrado"));
    const after = within(screen.getByTestId("lead-l2"));
    expect(after.getByText("En espera", { selector: "span" })).toBeInTheDocument();
    expect(estado("l2")).toBe("En espera");
    expect(after.queryByText("En seguimiento")).toBeNull();
    expect(screen.getByTestId("lead-l2").textContent).toContain("Registrar el seguimiento no envía nada");
    cleanup();
    mount();
    const reloaded = within(await card("l2"));
    expect(reloaded.getByText("En espera", { selector: "span" })).toBeInTheDocument();
    expect(estado("l2")).toBe("En espera");
    expect(screen.getByTestId("lead-l2").textContent).toContain("Sin medio de contacto: esperar a que el prospecto vuelva a escribir");
  });

  it("leaves the other prospect alone: only the one asked about is changed", async () => {
    const { calls, status } = installServer();
    mount();
    await userEvent.click(within(await card("l2")).getByRole("button", { name: "Registrar seguimiento" }));
    await waitFor(() => expect(status["l2"]).toBe("working"));
    expect(status["l1"]).toBe("new");
    expect(calls.filter((call) => call.method === "PATCH")).toHaveLength(1);
  });
});
