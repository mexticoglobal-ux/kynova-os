import { describe, expect, it, vi } from "vitest";
import { authFailureReport, describeSupabaseKey, logAuthFailure } from "./supabase-auth-diagnostics";

const jwt = (role: string) => ["x", Buffer.from(JSON.stringify({ role })).toString("base64url"), "firma"].join(".");
const KEY = "sb_publishable_valorFalsoDePrueba0123";
const vars = { SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", SUPABASE_PUBLISHABLE_KEY: KEY };

describe("describeSupabaseKey", () => {
  it("names the kind of key without showing it", () => {
    expect(describeSupabaseKey(undefined)).toBe("missing");
    expect(describeSupabaseKey(KEY)).toBe("publishable");
    expect(describeSupabaseKey("sb_secret_valorFalso")).toBe("secret");
    expect(describeSupabaseKey(jwt("anon"))).toBe("anon_jwt");
    expect(describeSupabaseKey(jwt("service_role"))).toBe("service_role_jwt");
    expect(describeSupabaseKey("cualquier cosa")).toBe("unknown");
  });
});

describe("authFailureReport", () => {
  it("keeps the name, status and code of the error and the shape of the configuration", () => {
    expect(authFailureReport("auth.request", { name: "AuthApiError", status: 429, code: "over_email_send_rate_limit", message: "no se registra" }, vars)).toEqual({
      where: "auth.request", name: "AuthApiError", status: 429, code: "over_email_send_rate_limit",
      urlHost: "abcdefghijklmnop.supabase.co", urlHeaderSafe: true, keyKind: "publishable", keyHeaderSafe: true,
    });
  });

  it("flags a key that cannot travel in a header (a pasted control character), which fails before reaching Supabase", () => {
    const broken = { ...vars, SUPABASE_PUBLISHABLE_KEY: "\u0016" };
    expect(authFailureReport("auth.request", { name: "AuthRetryableFetchError", status: 0 }, broken)).toMatchObject({ status: 0, keyKind: "unknown", keyHeaderSafe: false });
    expect(authFailureReport("auth.request", {}, { ...vars, SUPABASE_PUBLISHABLE_KEY: `${KEY}é` }).keyHeaderSafe).toBe(false);
  });

  it("never carries the key, an email, a code or the provider's message", () => {
    const report = authFailureReport("x", { name: "AuthApiError", status: 400, code: "bad code with spaces persona@example.test", message: `Invalid header value ${KEY} persona@example.test 123456` }, vars);
    const text = JSON.stringify(report);
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/persona@|123456|Invalid header/);
    expect(report.code).toBeNull();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", KEY);
    logAuthFailure("auth.request", { name: "AuthApiError", status: 401, message: KEY });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
    spy.mockRestore(); vi.unstubAllEnvs();
  });
});
