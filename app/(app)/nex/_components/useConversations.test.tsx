import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

import { SessionProvider } from "@/components/session/SessionProvider";
import { useConversations } from "./useConversations";

const T = "00000000-0000-4000-8000-0000000000b1";
const SERVER_ID = "00000000-0000-4000-8000-0000000000c1";
const NEW_ID = "00000000-0000-4000-8000-0000000000c2";
const backend = { userId: "u1", email: "o@example.test", displayName: "Owner", memberships: [{ tenantId: T, name: "Nova", slug: "nova", role: "owner" as const }], active: { tenantId: T, name: "Nova", slug: "nova", role: "owner" as const } };

const calls: { path: string; method: string; body: unknown }[] = [];
function setup() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      const method = init?.method ?? (init?.body ? "POST" : "GET");
      calls.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      let data: unknown = { ok: true };
      if (path.startsWith("/api/v1/conversations?")) data = { conversations: [{ id: SERVER_ID, kind: "assistant", title: "Resumen de la semana", status: "open", mode: "free", contactId: null, contactName: null, leadId: null, lastMessageAt: "2026-11-06T10:00:00Z", startedAt: "2026-11-06T09:00:00Z" }] };
      else if (path === `/api/v1/conversations/${SERVER_ID}/messages` && method === "GET") data = { messages: [{ id: "m1", createdAt: "2026-11-06T10:00:00Z", direction: "in", senderKind: "user", contentType: "text", body: "Resume mi semana", payload: {}, deliveryStatus: "sent" }, { id: "m2", createdAt: "2026-11-06T10:00:01Z", direction: "out", senderKind: "nex", contentType: "text", body: "Aquí va.", payload: {}, deliveryStatus: "sent" }] };
      else if (path === "/api/v1/conversations" && method === "POST") data = { id: NEW_ID };
      return { ok: true, status: 200, json: async () => data } as Response;
    }),
  );
}

let api!: ReturnType<typeof useConversations>;
function Probe() {
  api = useConversations();
  return <p>{api.conversations.map((conversation) => `${conversation.title}:${conversation.messages.length}`).join("|") || "empty"}</p>;
}

beforeEach(() => {
  calls.length = 0;
  window.localStorage.clear();
  setup();
});
afterEach(() => vi.unstubAllGlobals());

describe("NEX history in a company", () => {
  it("loads the saved conversations from the database and opens one with its messages", async () => {
    render(
      <SessionProvider backend={backend}>
        <Probe />
      </SessionProvider>,
    );
    expect(await screen.findByText("Resumen de la semana:0")).toBeInTheDocument();
    act(() => api.setActiveId(SERVER_ID));
    expect(await screen.findByText("Resumen de la semana:2")).toBeInTheDocument();
    expect(api.active?.messages.map((message) => message.role)).toEqual(["user", "nex"]);
    expect(window.localStorage.getItem("kynova.nex.conversations")).toBeNull(); // nothing is kept in the browser
  });

  it("stores a new conversation and its messages in order, once the server has created it", async () => {
    render(
      <SessionProvider backend={backend}>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("Resumen de la semana:0");
    calls.length = 0;
    act(() => {
      api.appendMessage("local-1", { role: "user", text: "¿Qué leads necesitan seguimiento?" }, "¿Qué leads");
      api.appendMessage("local-1", { role: "nex", text: "Hay 2." }, "¿Qué leads");
    });
    await waitFor(() => expect(calls.filter((call) => call.path.endsWith("/messages"))).toHaveLength(2));
    expect(calls[0]).toMatchObject({ path: "/api/v1/conversations", method: "POST", body: { tenantId: T } });
    expect(calls.slice(1).map((call) => [call.path, call.body])).toEqual([
      [`/api/v1/conversations/${NEW_ID}/messages`, { direction: "in", senderKind: "user", body: "¿Qué leads necesitan seguimiento?" }],
      [`/api/v1/conversations/${NEW_ID}/messages`, { direction: "out", senderKind: "nex", body: "Hay 2." }],
    ]);
  });

  it("appends to a saved conversation without creating a new one, and deletes it remotely", async () => {
    render(
      <SessionProvider backend={backend}>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText("Resumen de la semana:0");
    calls.length = 0;
    act(() => api.appendMessage(SERVER_ID, { role: "user", text: "Otra pregunta" }, "x"));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].path).toBe(`/api/v1/conversations/${SERVER_ID}/messages`);
    act(() => api.remove(SERVER_ID));
    await waitFor(() => expect(calls.some((call) => call.method === "DELETE" && call.path === `/api/v1/conversations/${SERVER_ID}`)).toBe(true));
  });
});

describe("NEX history in demonstration mode", () => {
  it("keeps using this browser and never calls the API", async () => {
    render(<Probe />);
    act(() => api.appendMessage("local-1", { role: "user", text: "Hola" }, "Hola"));
    await waitFor(() => expect(window.localStorage.getItem("kynova.nex.conversations")).toContain("Hola"));
    expect(calls).toEqual([]);
  });
});
