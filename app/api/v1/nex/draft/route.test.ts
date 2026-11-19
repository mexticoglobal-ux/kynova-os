import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/db/supabase-spike", () => ({
  getSupabaseSpikeConfig: mocks.config,
  createSupabaseSpikeServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

import { POST } from "./route";

const ORIGIN = "https://kynova.test";
const T = "00000000-0000-4000-8000-0000000000b1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
type Body = { source: string; reason: string | null; label: string; draft: { message: string; presentation: string }; needsContext: string[] };
const post = (body: unknown) => new NextRequest(`${ORIGIN}/api/v1/nex/draft`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
const call = (body: unknown) => POST(post(body), { params: Promise.resolve({}) });
const session = (role: string) => ({ data: { userId: "u1", email: "o@example.test", displayName: "Ana", memberships: [{ tenantId: T, name: "Nova Marketing Studio", slug: null, role }] }, error: null });

beforeEach(() => {
  mocks.config.mockReset().mockReturnValue({ url: "https://x.supabase.co", publishableKey: "k" });
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1", email: "o@example.test" } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue(session("owner"));
});

describe("POST /api/v1/nex/draft", () => {
  it("needs a signed-in user and valid input", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthApiError", status: 401 } });
    expect((await call({ tenantId: T })).status).toBe(401);
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "o@example.test" } }, error: null });
    expect((await call({ tenantId: "nope" })).status).toBe(400);
    expect((await call({ tenantId: T, offer: "a".repeat(161) })).status).toBe(400);
  });

  it("refuses a company the user does not belong to, and a role without write permission", async () => {
    expect((await call({ tenantId: OTHER, offer: "x" })).status).toBe(403);
    mocks.rpc.mockResolvedValue(session("viewer"));
    expect((await call({ tenantId: T, offer: "x" })).status).toBe(403);
  });

  it("lets owner, admin and member through, with the same permission that works the commercial data", async () => {
    for (const role of ["owner", "admin", "member"]) {
      mocks.rpc.mockResolvedValue(session(role));
      expect((await call({ tenantId: T, offer: "x" })).status, role).toBe(200);
    }
  });

  it("answers with the rules draft and says the model is off; no model is called and nothing else is read", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const response = await call({ tenantId: T, offer: "campañas de marketing", audience: "restaurantes" });
    const body = (await response.json()) as Body;
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ source: "rules", reason: "disabled" });
    expect(body.label).toContain("no por un modelo de IA");
    expect(body.draft.message).toContain("Lo que ofrecemos: campañas de marketing. Trabajamos con: restaurantes.");
    expect(body.draft.message).toContain("Nova Marketing Studio");
    expect(fetchSpy).not.toHaveBeenCalled();
    // the only database call is the session's memberships: no prospect, client or other data is read
    expect(mocks.rpc.mock.calls.map((callArgs) => callArgs[0])).toEqual(["session_bootstrap"]);
    fetchSpy.mockRestore();
  });

  it("marks what the person did not say as open and returns no content beyond the draft", async () => {
    const body = (await (await call({ tenantId: T })).json()) as Body;
    expect(body.needsContext).toEqual(["qué ofrece su empresa", "a quién se dirige"]);
    expect(Object.keys(body).sort()).toEqual(["draft", "label", "needsContext", "reason", "source"]);
  });
});
