import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(),
  getConfig: vi.fn(),
  getClaims: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/db/supabase-spike", () => ({
  getSupabaseSpikeConfig: mocks.getConfig,
  createSupabaseSpikeServerClient: async () => ({ auth: { getClaims: mocks.getClaims, getUser: mocks.getUser } }),
}));

import SupabaseSpikeLoginPage from "./page";

const props = { searchParams: Promise.resolve({}) };

beforeEach(() => {
  mocks.getConfig.mockReturnValue({ url: "https://kynova-test.supabase.co", publishableKey: "sb_publishable_test", canaryConfigured: false });
  // Like Next's redirect(): it interrupts rendering by throwing.
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe("Supabase spike login page", () => {
  it("sends an authenticated person to the panel instead of swallowing the redirect", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "user-a" } }, error: null });
    await expect(SupabaseSpikeLoginPage(props)).rejects.toThrow("NEXT_REDIRECT:/spike");
    expect(mocks.redirect).toHaveBeenCalledWith("/spike");
  });

  it("shows the login form when there is no session", async () => {
    mocks.getUser.mockResolvedValue({ data: null, error: new Error("no session") });
    await expect(SupabaseSpikeLoginPage(props)).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("shows the login form for a revoked session whose JWT still verifies locally", async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "user-a" } }, error: null });
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: new Error("session_not_found") });
    await expect(SupabaseSpikeLoginPage(props)).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("shows the login form when the auth check itself fails", async () => {
    mocks.getUser.mockRejectedValue(new Error("auth unavailable"));
    await expect(SupabaseSpikeLoginPage(props)).resolves.toBeTruthy();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("does not check the session when the spike is not configured", async () => {
    mocks.getConfig.mockReturnValue(null);
    await expect(SupabaseSpikeLoginPage(props)).resolves.toBeTruthy();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
