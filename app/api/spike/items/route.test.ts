import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getClaims: vi.fn(),
  getUser: vi.fn(),
  select: vi.fn(),
}));

const client = { auth: { getClaims: mocks.getClaims, getUser: mocks.getUser }, from: () => ({ select: () => ({ order: mocks.select }) }) };

vi.mock("@/lib/db/supabase-spike", () => ({
  getSupabaseSpikeConfig: mocks.getConfig,
  createSupabaseSpikeServerClient: async () => client,
}));

import { GET } from "./route";

beforeEach(() => {
  mocks.getConfig.mockReturnValue({ url: "https://kynova-test.supabase.co", publishableKey: "sb_publishable_test", canaryConfigured: false });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a", email: "a@example.test" } }, error: null });
  mocks.select.mockResolvedValue({ data: [{ id: "1", tenant_id: "t", label: "A-1" }], error: null });
});

describe("GET /api/spike/items", () => {
  it("returns the rows of a live session with no-store headers", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ items: [{ id: "1", tenant_id: "t", label: "A-1" }] });
  });

  it("answers 503, not 401, and reads nothing when Auth is unavailable", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 }) });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  // A1/B4: a signed-out session's JWT still verifies locally; only Auth knows the session is gone.
  it("answers 401 and reads nothing for a revoked session whose JWT still verifies locally", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-a" } }, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("session_not_found") });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
    expect(mocks.select).not.toHaveBeenCalled();
  });
});
