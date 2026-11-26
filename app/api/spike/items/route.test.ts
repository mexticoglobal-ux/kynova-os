import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupabaseSpikePage from "@/app/spike/page";
import { GET } from "./route";

// Regression (Preview, 2026-11-25): with a VALID session, /api/spike/items answered 503 spike_data_unavailable and /spike showed "No se pudo completar la prueba" because the
// optional table `spike_items` does not exist in that project (PostgREST 404). The REAL libraries, route and page run here; only the network and the cookie store are simulated.
let jar: { name: string; value: string }[] = [];
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => jar, set: () => {} }) }));

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const USER = { id: "00000000-0000-4000-8000-000000000000", email: "persona@example.test" };
const exp = () => Math.floor(Date.now() / 1000) + 3600;
const validSession = () => `base64-${b64({ access_token: `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, email: USER.email, exp: exp(), role: "authenticated" })}.firmaFalsa`, refresh_token: "refresco-falso", token_type: "bearer", expires_in: 3600, expires_at: exp(), user: USER })}`;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const postgrestError = (code: string, status: number) => json({ code, message: "mensaje interno que no debe salir", details: null, hint: null }, status);

let table: () => Response;
let dataCalls = 0;
let logged: string[] = [];

beforeEach(() => {
  jar = [{ name: "sb-abcdefghijklmnop-auth-token", value: validSession() }];
  dataCalls = 0; logged = [];
  table = () => postgrestError("PGRST205", 404);
  vi.stubEnv("SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_valorFalsoDePrueba0123");
  vi.stubGlobal("fetch", async (input: string | URL | Request) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname === "/auth/v1/user") return json(USER, 200);
    if (url.pathname === "/rest/v1/spike_items") { dataCalls += 1; return table(); }
    return json({ code: "not_expected", message: url.pathname }, 500);
  });
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => { logged.push(parts.join(" ")); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const pageResult = async () => ((await SupabaseSpikePage()) as ReactElement<{ result: unknown }>).props.result;

describe("spike items with a valid session", () => {
  it.each(["PGRST205", "42P01"])("reports a missing table (%s) as not provisioned, not as a failure", async (code) => {
    table = () => postgrestError(code, 404);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], provisioned: false });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await pageResult()).toEqual({ status: "not_provisioned" });
    expect(logged).toEqual([]);
  });

  it("returns the rows when the table exists", async () => {
    const rows = [{ id: "1", tenant_id: "t", label: "Dato ficticio A-1" }];
    table = () => json(rows, 200);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: rows });
    expect(await pageResult()).toEqual({ status: "ok", items: rows });
  });

  it.each([["42501", 403], ["PGRST301", 401], ["XX000", 500], ["PGRST202", 404]] as const)("keeps any other failure (%s) as an error and logs only its code", async (code, status) => {
    table = () => postgrestError(code, status);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "spike_data_unavailable" });
    expect(await pageResult()).toEqual({ status: "unavailable" });
    expect(logged[0]).toBe(`spike_items_failed {"code":"${code}"}`);
    expect(logged.join()).not.toMatch(/mensaje interno|persona@|eyJ/);
  });

  it("never reads the data without a session", async () => {
    jar = [];
    const response = await GET();
    expect(response.status).toBe(401);
    await expect(SupabaseSpikePage()).rejects.toThrow("NEXT_REDIRECT");
    expect(dataCalls).toBe(0);
  });
});
