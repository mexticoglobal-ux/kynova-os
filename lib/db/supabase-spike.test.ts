import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseSpikeConfig } from "./supabase-spike-config";
import { SPIKE_EMAIL_COOKIE_PATH } from "./supabase-spike";

describe("Supabase spike runtime config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("fails closed when the URL or publishable key is missing", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
    expect(getSupabaseSpikeConfig()).toBeNull();
  });

  it("accepts an HTTPS project URL and exposes only whether the canary exists", () => {
    vi.stubEnv("SUPABASE_URL", "https://kynova-test.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    vi.stubEnv("SPIKE_SECRET_CANARY", "never-return-this-test-value");
    const config = getSupabaseSpikeConfig();
    expect(config).toEqual({ url: "https://kynova-test.supabase.co", publishableKey: "sb_publishable_test", canaryConfigured: true });
    expect(JSON.stringify(config)).not.toContain("never-return-this-test-value");
  });

  it("rejects non-HTTPS remote project URLs", () => {
    vi.stubEnv("SUPABASE_URL", "http://kynova-test.supabase.co");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
    expect(getSupabaseSpikeConfig()).toBeNull();
  });

  it("makes the temporary email cookie available to the verification route", () => {
    const endpoint = "/api/spike/auth/verify";
    expect(endpoint.startsWith(SPIKE_EMAIL_COOKIE_PATH)).toBe(true);
    expect(SPIKE_EMAIL_COOKIE_PATH).toBe("/");
  });
});
