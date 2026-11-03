import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPIKE_EMAIL_COOKIE, SPIKE_EMAIL_COOKIE_PATH } from "@/lib/db/supabase-spike";

const supabase = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signInWithOtp: vi.fn(),
}));

type CookieToSet = { name: string; value: string; options?: Record<string, unknown> };
type ServerClientOptions = {
  cookieOptions: Record<string, unknown>;
  cookies: { getAll: () => unknown; setAll: (cookies: CookieToSet[]) => void };
};

// The real createSupabaseSpikeRouteClient runs, so its cookie handling is what is tested; only
// @supabase/ssr is replaced. Like the library, the fake hands its cookies to setAll with the configured
// cookie options merged in: a session cookie, and the PKCE verifier cookie removed after the exchange.
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: ServerClientOptions) => ({
    auth: {
      signInWithOtp: supabase.signInWithOtp,
      exchangeCodeForSession: async (code: string) => {
        const result = await supabase.exchangeCodeForSession(code);
        if (!result?.error) {
          options.cookies.setAll([
            { name: "sb-test-auth-token", value: "session-value", options: { ...options.cookieOptions, maxAge: 34560000 } },
            { name: "sb-test-auth-token-code-verifier", value: "", options: { ...options.cookieOptions, maxAge: 0 } },
          ]);
        }
        return result;
      },
    },
  }),
}));

import { POST as requestOtp } from "../request/route";
import { GET as callback } from "./route";

// An allowed spike origin (lib/db/supabase-spike-config.ts).
const ORIGIN = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test-key");
  supabase.exchangeCodeForSession.mockReset();
  supabase.signInWithOtp.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

const get = (query = "") => callback(new NextRequest(`${ORIGIN}/api/spike/auth/callback${query}`));

function postRequest(body: string, origin = ORIGIN) {
  return new NextRequest(`${origin}/api/spike/auth/request`, {
    method: "POST",
    headers: { origin, "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length) },
    body,
  });
}

describe("magic-link callback", () => {
  it("exchanges the PKCE code, writes the session cookies and redirects to the protected spike", async () => {
    supabase.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await get("?code=one-time-code");

    expect(supabase.exchangeCodeForSession).toHaveBeenCalledWith("one-time-code");
    expect(response.headers.get("location")).toBe(`${ORIGIN}/spike`);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");

    const session = response.cookies.get("sb-test-auth-token");
    expect(session?.value).toBe("session-value");
    expect(session).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(session?.maxAge).toBeGreaterThan(0);
    // The PKCE verifier is single use: the library removes it after a successful exchange.
    expect(response.cookies.get("sb-test-auth-token-code-verifier")?.maxAge).toBe(0);
  });

  it("clears the temporary email cookie with the name and path it was created with", async () => {
    supabase.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await get("?code=one-time-code");

    expect(response.cookies.get(SPIKE_EMAIL_COOKIE)).toMatchObject({
      value: "",
      maxAge: 0,
      path: SPIKE_EMAIL_COOKIE_PATH,
      httpOnly: true,
    });
  });

  it("redirects generically and sets no cookie when the code is missing", async () => {
    const response = await get();

    expect(supabase.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/spike/login?status=required`);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("does not reveal details, writes no session and keeps the email cookie when the exchange fails", async () => {
    supabase.exchangeCodeForSession.mockResolvedValue({ error: new Error("internal details") });
    const response = await get("?code=invalid");

    expect(response.headers.get("location")).toBe(`${ORIGIN}/spike/login?status=error`);
    expect(response.headers.get("location")).not.toContain("internal details");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("redirects generically when the exchange throws", async () => {
    supabase.exchangeCodeForSession.mockRejectedValue(new Error("network down"));
    const response = await get("?code=whatever");

    expect(response.headers.get("location")).toBe(`${ORIGIN}/spike/login?status=error`);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("shows the setup state, without calling Supabase, when the project is not configured", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    const response = await get("?code=one-time-code");

    expect(supabase.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(`${ORIGIN}/spike/login?status=setup`);
  });
});

describe("magic-link request", () => {
  it("asks Supabase for a link back to the fixed callback of the trusted origin, without creating users", async () => {
    supabase.signInWithOtp.mockResolvedValue({ error: null });
    // A caller-supplied destination is ignored: only the email field is read.
    const response = await requestOtp(postRequest("email=owner%40example.com&redirectTo=https%3A%2F%2Fevil.test%2Fsteal&next=%2F%2Fevil.test"));

    expect(supabase.signInWithOtp).toHaveBeenCalledWith({
      email: "owner@example.com",
      options: { shouldCreateUser: false, emailRedirectTo: `${ORIGIN}/api/spike/auth/callback` },
    });
    expect(response.headers.get("location")).toBe(`${ORIGIN}/spike/login?status=sent`);
    expect(response.cookies.get(SPIKE_EMAIL_COOKIE)).toMatchObject({ value: "owner@example.com", httpOnly: true, path: SPIKE_EMAIL_COOKIE_PATH });
  });

  it("accepts the other allowed local and Preview origins", async () => {
    for (const origin of ["http://localhost:8787", "https://kynova-os-preview.novamarketingstudiocr.workers.dev"]) {
      supabase.signInWithOtp.mockReset();
      supabase.signInWithOtp.mockResolvedValue({ error: null });
      await requestOtp(postRequest("email=owner%40example.com", origin));
      expect(supabase.signInWithOtp).toHaveBeenCalledTimes(1);
      expect(supabase.signInWithOtp).toHaveBeenCalledWith(
        expect.objectContaining({ options: expect.objectContaining({ emailRedirectTo: `${origin}/api/spike/auth/callback` }) }),
      );
    }
  });

  it("refuses a browser on 127.0.0.1: Next resolves request.url to localhost, so use http://localhost:8787", async () => {
    const response = await requestOtp(postRequest("email=owner%40example.com", "http://127.0.0.1:8787"));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "invalid_origin" });
    expect(supabase.signInWithOtp).not.toHaveBeenCalled();
  });

  it("refuses an origin that is not allowed, even when Origin and Host agree, and sends no email", async () => {
    for (const origin of [
      "https://attacker.test",
      "http://localhost:3001",
      "https://localhost:3000",
      "https://kynova-os-preview.novamarketingstudiocr.workers.dev.attacker.test",
    ]) {
      const response = await requestOtp(postRequest("email=owner%40example.com", origin));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "origin_not_allowed" });
      expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(supabase.signInWithOtp).not.toHaveBeenCalled();
  });
});
