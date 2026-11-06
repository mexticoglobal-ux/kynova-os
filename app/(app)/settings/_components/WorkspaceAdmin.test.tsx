import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }));

import { SessionProvider } from "@/components/session/SessionProvider";
import type { Role } from "@/lib/contracts/backend";
import { WorkspaceAdmin } from "./WorkspaceAdmin";

const T = "00000000-0000-4000-8000-0000000000b1";
const ME = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000a2";

const session = (role: Role) => ({
  userId: ME,
  email: "me@example.test",
  displayName: "Yo",
  memberships: [{ tenantId: T, name: "Nova", slug: "nova", role }],
  active: { tenantId: T, name: "Nova", slug: "nova", role },
});

const team = [
  { kind: "member", userId: ME, email: "me@example.test", name: "Yo", role: "owner", since: "2026-11-01T00:00:00Z" },
  { kind: "member", userId: OTHER, email: "ana@example.test", name: "Ana", role: "member", since: "2026-11-02T00:00:00Z" },
  { kind: "invitation", invitationId: "00000000-0000-4000-8000-0000000000d1", email: "nuevo@example.test", name: "nuevo@example.test", role: "viewer", since: "2026-11-03T00:00:00Z" },
];

const calls: { path: string; method: string; body: unknown }[] = [];
beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? (init?.body ? "POST" : "GET"), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const data = path.startsWith("/api/v1/team?") ? { team } : path.startsWith("/api/v1/activity") ? { activity: [{ id: "a1", at: "2026-11-06T10:00:00Z", kind: "prospect.captured", level: 1, summary: "NEX recibió y preparó a un prospecto", reason: "Conversación guiada completada", actor: "nex", actorName: null, outcome: "ok" }] } : { status: "invited" };
      return { ok: true, status: 200, json: async () => data } as Response;
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("company administration", () => {
  it("shows nothing in demonstration mode", () => {
    const { container } = render(<WorkspaceAdmin />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lets an owner see the team, invite, change a role and read the activity trail", async () => {
    render(
      <SessionProvider backend={session("owner")}>
        <WorkspaceAdmin />
      </SessionProvider>,
    );
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText(/Invitación pendiente/)).toBeInTheDocument();
    expect(await screen.findByText("NEX recibió y preparó a un prospecto")).toBeInTheDocument();
    expect(screen.getByText(/Observar y preparar/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Invitar por correo"), { target: { value: "otra@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: /^Invitar$/ }));
    await waitFor(() => expect(calls.some((call) => call.path === "/api/v1/team" && call.method === "POST")).toBe(true));
    expect(calls.find((call) => call.path === "/api/v1/team" && call.method === "POST")?.body).toEqual({ tenantId: T, email: "otra@example.test", role: "member" });

    fireEvent.change(screen.getByLabelText("Rol de Ana"), { target: { value: "viewer" } });
    await waitFor(() => expect(calls.some((call) => call.path === `/api/v1/team/${OTHER}` && call.method === "PATCH")).toBe(true));
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ tenantId: T, role: "viewer" });
  });

  it("deletes the company only after the name is typed", async () => {
    render(
      <SessionProvider backend={session("owner")}>
        <WorkspaceAdmin />
      </SessionProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Eliminar esta empresa/ }));
    const confirm = screen.getByRole("button", { name: "Eliminar empresa" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirmar nombre de la empresa"), { target: { value: "Nova" } });
    expect(confirm).toBeEnabled();
  });

  it("gives an admin the team tools but not the deletion, and a member only the list", async () => {
    const { unmount } = render(
      <SessionProvider backend={session("admin")}>
        <WorkspaceAdmin />
      </SessionProvider>,
    );
    expect(await screen.findByLabelText("Invitar por correo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Eliminar esta empresa/ })).not.toBeInTheDocument();
    unmount();

    render(
      <SessionProvider backend={session("member")}>
        <WorkspaceAdmin />
      </SessionProvider>,
    );
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.queryByLabelText("Invitar por correo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Rol de Ana")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nombre de la empresa")).not.toBeInTheDocument();
  });
});
