import { describe, expect, it, vi } from "vitest";
import { getVerifiedSpikeUser } from "./supabase-spike-auth";

const clientWith = (getUser: () => Promise<unknown>, getClaims = vi.fn()) => ({ auth: { getUser, getClaims } }) as unknown as Parameters<typeof getVerifiedSpikeUser>[0];

describe("getVerifiedSpikeUser", () => {
  it("returns the user Auth confirms", async () => {
    const user = await getVerifiedSpikeUser(clientWith(async () => ({ data: { user: { id: "u1", email: "a@example.test" } }, error: null })));
    expect(user).toEqual({ id: "u1", email: "a@example.test" });
  });

  it("returns null when Auth rejects the session, whatever getClaims would say", async () => {
    const getClaims = vi.fn().mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    const user = await getVerifiedSpikeUser(clientWith(async () => ({ data: { user: null }, error: new Error("session_not_found") }), getClaims));
    expect(user).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("throws, instead of reporting a sign-out, when Auth itself is unavailable", async () => {
    const retryable = Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 });
    const serverError = Object.assign(new Error("boom"), { name: "AuthApiError", status: 502 });
    for (const error of [retryable, serverError]) {
      await expect(getVerifiedSpikeUser(clientWith(async () => ({ data: { user: null }, error })))).rejects.toThrow("unavailable");
    }
    const revoked = Object.assign(new Error("session_not_found"), { name: "AuthApiError", status: 403 });
    expect(await getVerifiedSpikeUser(clientWith(async () => ({ data: { user: null }, error: revoked })))).toBeNull();
  });

  it("returns null without a user id and tolerates a missing email", async () => {
    expect(await getVerifiedSpikeUser(clientWith(async () => ({ data: { user: {} }, error: null })))).toBeNull();
    expect(await getVerifiedSpikeUser(clientWith(async () => ({ data: { user: { id: "u2" } }, error: null })))).toEqual({ id: "u2", email: "" });
  });
});
