import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ config: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/db/supabase-spike", () => ({
  getSupabaseSpikeConfig: mocks.config,
  createSupabaseSpikeServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

import { api, ok, readBody, tenantParam } from "./handler";

const ORIGIN = "https://kynova.test";
const route = { params: Promise.resolve({}) };
const user = { id: "00000000-0000-4000-8000-0000000000a1", email: "owner@example.test" };

const request = (method: string, options: { origin?: string | null; body?: string; type?: string } = {}) =>
  new NextRequest(`${ORIGIN}/api/v1/x?tenantId=00000000-0000-4000-8000-0000000000b1`, {
    method,
    headers: { ...(options.origin === null ? {} : { origin: options.origin ?? ORIGIN }), ...(options.body !== undefined ? { "content-type": options.type ?? "application/json" } : {}) },
    body: options.body,
  });

beforeEach(() => {
  mocks.config.mockReset().mockReturnValue({ url: "https://x.supabase.co", publishableKey: "k" });
  mocks.getUser.mockReset().mockResolvedValue({ data: { user }, error: null });
  mocks.rpc.mockReset();
});

describe("api wrapper", () => {
  it("answers 503 when no database is configured", async () => {
    mocks.config.mockReturnValue(null);
    const response = await api(async () => ok())(request("GET"), route);
    expect(response.status).toBe(503);
  });

  it("requires a verified user and never calls the handler without one", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthApiError", status: 401 } });
    const handler = vi.fn(async () => ok());
    expect((await api(handler)(request("GET"), route)).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails closed with 503 (not 401) when Auth itself is down", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0 } });
    expect((await api(async () => ok())(request("GET"), route)).status).toBe(503);
  });

  it("rejects writes from another origin or without an origin", async () => {
    const handler = vi.fn(async () => ok());
    expect((await api(handler)(request("POST", { origin: "https://evil.test", body: "{}" }), route)).status).toBe(403);
    expect((await api(handler)(request("DELETE", { origin: null }), route)).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("gives the handler the user and a backend, and maps backend errors to status codes", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    const response = await api(async ({ db, userId }) => {
      expect(userId).toBe(user.id);
      return ok(await db.listLeads("00000000-0000-4000-8000-0000000000b1"));
    })(request("GET"), route);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("never exposes internal error details", async () => {
    const response = await api(async () => {
      throw new Error("secret connection string postgres://user:pw@host");
    })(request("GET"), route);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("postgres://");
  });

  it("marks every answer as not cacheable", async () => {
    const response = await api(async () => ok({ a: 1 }))(request("GET"), route);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});

describe("body and params helpers", () => {
  it("reads JSON only with the right content type and size", async () => {
    expect(await readBody(request("POST", { body: '{"a":1}' }))).toEqual({ a: 1 });
    expect(await readBody(request("POST", { body: '{"a":1}', type: "text/plain" }))).toBeUndefined();
    expect(await readBody(request("POST", { body: "{not json" }))).toBeUndefined();
    expect(await readBody(request("POST", { body: JSON.stringify({ big: "x".repeat(300_000) }) }))).toBeUndefined();
  });

  it("accepts only a uuid as tenantId", () => {
    expect(tenantParam(request("GET"))).toBe("00000000-0000-4000-8000-0000000000b1");
    expect(tenantParam(new Request(`${ORIGIN}/x?tenantId=abc`))).toBeNull();
    expect(tenantParam(new Request(`${ORIGIN}/x`))).toBeNull();
  });
});
