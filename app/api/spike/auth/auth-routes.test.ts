import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SPIKE_EMAIL_COOKIE, SPIKE_EMAIL_COOKIE_PATH, spikeEmailCookieOptions } from "@/lib/db/supabase-spike";
import { POST as requestOtp } from "./request/route";
import { POST as signOut } from "./sign-out/route";
import { POST as verifyOtp } from "./verify/route";

const ORIGIN = "https://kynova.test";

function post(path: string, init: { contentType?: string; body?: string } = {}) {
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.body !== undefined) headers["content-length"] = String(init.body.length);
  if (init.contentType) headers["content-type"] = init.contentType;
  return new NextRequest(`${ORIGIN}${path}`, { method: "POST", headers, body: init.body });
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "");
});

afterEach(() => vi.unstubAllEnvs());

describe("temporary email cookie", () => {
  it("is cleared with the same name and path it is created with", () => {
    const created = spikeEmailCookieOptions(10 * 60);
    const cleared = spikeEmailCookieOptions(0);
    expect(created.path).toBe(SPIKE_EMAIL_COOKIE_PATH);
    expect(cleared.path).toBe(created.path);
    expect(cleared.maxAge).toBe(0);
  });

  it("sign-out expires the cookie on the path the cookie was created with", async () => {
    const response = await signOut(post("/api/spike/auth/sign-out"));
    const cookie = response.cookies.get(SPIKE_EMAIL_COOKIE);
    expect(cookie?.path).toBe(SPIKE_EMAIL_COOKIE_PATH);
    expect(cookie?.maxAge).toBe(0);
    expect(cookie?.value).toBe("");
  });
});

describe("OTP routes with an unreadable form body", () => {
  const routes = [
    ["request", requestOtp, "/api/spike/auth/request"],
    ["verify", verifyOtp, "/api/spike/auth/verify"],
  ] as const;

  it.each(routes)("%s answers a uniform 400 without internal details", async (_name, handler, path) => {
    const response = await handler(post(path, { contentType: "text/plain", body: "not a form" }));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });

  it.each(routes)("%s answers the same 400 when the Content-Type is missing", async (_name, handler, path) => {
    const response = await handler(post(path, { body: "email=a%40b.co" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
  });
});
