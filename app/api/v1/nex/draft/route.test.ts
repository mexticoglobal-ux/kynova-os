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

// The first AI test: the model is reached ONLY when the deployment variable names this company, and then only through the budget. Everything here uses a simulated provider (fetch is mocked).
describe("POST /api/v1/nex/draft with the first AI test switched on for one company", () => {
  const REQ = "00000000-0000-4000-8000-0000000000c1";
  const PHRASES = { offer: "campañas de marketing para pequeños negocios", audience: "restaurantes y cafés" };
  const ANSWER = JSON.stringify({ message: `Hola, le escribo de parte de Nova. Lo que ofrecemos: ${PHRASES.offer}. Trabajamos con: ${PHRASES.audience}. ¿Conversamos 15 minutos?`, presentation: `Nova\nQué hacemos: ${PHRASES.offer}\nA quién ayudamos: ${PHRASES.audience}` });
  const completion = () => new Response(JSON.stringify({ choices: [{ message: { content: ANSWER }, finish_reason: "stop" }], usage: { prompt_tokens: 650, completion_tokens: 300 } }), { status: 200, headers: { "content-type": "application/json" } });
  const granted = { ok: true, reservationId: "00000000-0000-4000-8000-0000000000d1", periodStart: "2026-11-01", expiresAt: "2026-11-21T12:05:00.000Z", repeated: false };
  const settled = { ok: true, reservationId: granted.reservationId, settledMicros: 280, overageMicros: 0, repeated: false };
  const rpcNames = () => mocks.rpc.mock.calls.map((args) => args[0]);
  const withBudget = (reserve: unknown) => mocks.rpc.mockImplementation(async (name: string) => (name === "session_bootstrap" ? session("owner") : name === "reserve_ai_budget" ? { data: reserve, error: null } : name === "settle_ai_budget" ? { data: settled, error: null } : { data: { ok: true }, error: null }));
  const switchOn = (tenant: string = T) => { vi.stubEnv("NEX_AI_FIRST_TEST_TENANT", tenant); vi.stubEnv("OPENAI_API_KEY", "sk-" + "x".repeat(30)); };

  it("is OFF without the variable: no budget call, no provider call, the rules draft saying it is disabled", async () => {
    vi.stubEnv("OPENAI_API_KEY", "sk-" + "x".repeat(30));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => completion());
    withBudget(granted);
    const body = (await (await call({ tenantId: T, requestId: REQ, ...PHRASES })).json()) as Body;
    expect(body).toMatchObject({ source: "rules", reason: "disabled" });
    expect(rpcNames()).toEqual(["session_bootstrap"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("is OFF for every other company even when the variable is set for one", async () => {
    switchOn(OTHER);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => completion());
    withBudget(granted);
    expect(((await (await call({ tenantId: T, ...PHRASES })).json()) as Body).reason).toBe("disabled");
    expect(rpcNames()).toEqual(["session_bootstrap"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("reserves FIRST, makes exactly one provider call, settles with the provider's own tokens, and answers with the model's draft", async () => {
    switchOn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => completion());
    withBudget(granted);
    const body = (await (await call({ tenantId: T, requestId: REQ, ...PHRASES })).json()) as Body;
    expect(body).toMatchObject({ source: "model", reason: null });
    expect(rpcNames()).toEqual(["session_bootstrap", "reserve_ai_budget", "settle_ai_budget"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain("api.openai.com/v1/chat/completions");
    const reserveArgs = mocks.rpc.mock.calls.find((args) => args[0] === "reserve_ai_budget")?.[1] as Record<string, unknown>;
    expect(reserveArgs).toMatchObject({ p_tenant: T, p_purpose: "message.draft", p_idempotency_key: REQ });
    expect(Number(reserveArgs.p_estimate_micros)).toBeGreaterThan(0);
    const settleArgs = mocks.rpc.mock.calls.find((args) => args[0] === "settle_ai_budget")?.[1] as { p_attempts: { attempt_no: number; billable: boolean; input_tokens: number; output_tokens: number }[] };
    expect(settleArgs.p_attempts).toHaveLength(1);
    expect(settleArgs.p_attempts[0]).toMatchObject({ attempt_no: 1, billable: true, input_tokens: 650, output_tokens: 300 });
    // the key is sent to the provider only in its header, never in what the route answers
    expect(JSON.stringify(body)).not.toContain("sk-");
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("a refused reservation (no budget, money, call cap) never reaches the provider and answers with the rules draft", async () => {
    for (const reason of ["no_budget", "budget_exceeded", "call_limit_reached"]) {
      switchOn();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => completion());
      mocks.rpc.mockReset();
      withBudget({ ok: false, reason });
      const body = (await (await call({ tenantId: T, requestId: REQ, ...PHRASES })).json()) as Body;
      expect(body, reason).toMatchObject({ source: "rules", reason: "budget_unavailable" });
      expect(rpcNames(), reason).toEqual(["session_bootstrap", "reserve_ai_budget"]);
      expect(fetchSpy, reason).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("a repeated request id is not granted a second call", async () => {
    switchOn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => completion());
    withBudget({ ...granted, repeated: true });
    expect(((await (await call({ tenantId: T, requestId: REQ, ...PHRASES })).json()) as Body)).toMatchObject({ source: "rules", reason: "budget_unavailable" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("an uncertain failure of the provider leaves the reservation held: no settle and no release", async () => {
    switchOn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 503 }));
    withBudget(granted);
    const body = (await (await call({ tenantId: T, requestId: REQ, ...PHRASES })).json()) as Body;
    expect(body).toMatchObject({ source: "rules", reason: "provider_error" });
    expect(rpcNames()).toEqual(["session_bootstrap", "reserve_ai_budget"]);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no retry
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("no provider key: nothing is sent and the reservation is released (it is KNOWN that no call left)", async () => {
    vi.stubEnv("NEX_AI_FIRST_TEST_TENANT", T);
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => completion());
    withBudget(granted);
    const body = (await (await call({ tenantId: T, requestId: REQ, ...PHRASES })).json()) as Body;
    expect(body).toMatchObject({ source: "rules", reason: "provider_error" });
    expect(rpcNames()).toEqual(["session_bootstrap", "reserve_ai_budget", "release_ai_budget"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    vi.unstubAllEnvs();
  });

  it("refuses a request id that is not a UUID", async () => {
    expect((await call({ tenantId: T, requestId: "not-a-uuid", offer: "x" })).status).toBe(400);
  });
});
