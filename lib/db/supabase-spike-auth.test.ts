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

  it("returns null without a user id and tolerates a missing email", async () => {
    expect(await getVerifiedSpikeUser(clientWith(async () => ({ data: { user: {} }, error: null })))).toBeNull();
    expect(await getVerifiedSpikeUser(clientWith(async () => ({ data: { user: { id: "u2" } }, error: null })))).toEqual({ id: "u2", email: "" });
  });
});
