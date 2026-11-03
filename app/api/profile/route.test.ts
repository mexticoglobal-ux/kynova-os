import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  getClaims: vi.fn(),
  getMyTenant: vi.fn(),
  getBusinessProfile: vi.fn(),
  saveBusinessProfile: vi.fn(),
}));

const client = { auth: { getClaims: mocks.getClaims } };

vi.mock("@/lib/db/supabase-spike", () => ({
  getSupabaseSpikeConfig: mocks.getConfig,
  createSupabaseSpikeServerClient: async () => client,
}));
vi.mock("@/lib/db/tenancy", () => ({
  getMyTenant: mocks.getMyTenant,
  getBusinessProfile: mocks.getBusinessProfile,
  saveBusinessProfile: mocks.saveBusinessProfile,
}));

import { GET, PUT } from "./route";

const ORIGIN = "https://kynova.test";
const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const TENANT_ID = "00000000-0000-4000-8000-0000000000b1";
const membership = { tenantId: TENANT_ID, name: "Empresa A", role: "owner" as const };

const profile = {
  tenantId: TENANT_ID,
  tradeName: "Empresa A",
  country: "CR",
  locale: "es",
  sector: "software",
  teamSize: "small",
  channel: "web",
  crm: "basicTool",
  problem: "leads",
  goal: "moreSales",
  questionnaireVersion: 1,
  createdAt: "2026-10-31T10:00:00+00:00",
  updatedAt: "2026-10-31T10:00:00+00:00",
};

const body = {
  tradeName: "Empresa A",
  country: "CR",
  locale: "es",
  sector: "software",
  teamSize: "small",
  channel: "web",
  crm: "basicTool",
  problem: "leads",
  goal: "moreSales",
};

function put(payload: unknown, headers: Record<string, string> = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new NextRequest(`${ORIGIN}/api/profile`, {
    method: "PUT",
    headers: { origin: ORIGIN, "content-type": "application/json", "content-length": String(text.length), ...headers },
    body: text,
  });
}

const signedIn = () => mocks.getClaims.mockResolvedValue({ data: { claims: { sub: USER_ID } }, error: null });

beforeEach(() => {
  mocks.getConfig.mockReturnValue({ url: "https://kynova-test.supabase.co", publishableKey: "sb_publishable_test", canaryConfigured: false });
  signedIn();
  mocks.getMyTenant.mockResolvedValue({ ok: true, data: membership });
  mocks.getBusinessProfile.mockResolvedValue({ ok: true, data: profile });
  mocks.saveBusinessProfile.mockResolvedValue({ ok: true, data: profile });
});

describe("GET /api/profile", () => {
  it("returns the caller's tenant and profile, never cacheable", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toEqual({ tenant: { id: TENANT_ID, name: "Empresa A", role: "owner" }, profile });
    expect(mocks.getBusinessProfile).toHaveBeenCalledWith(client, TENANT_ID);
  });

  it("returns a null profile for a tenant that has none yet", async () => {
    mocks.getBusinessProfile.mockResolvedValue({ ok: true, data: null });
    expect(await (await GET()).json()).toMatchObject({ profile: null });
  });

  it("answers 503 when the spike is not configured, without touching the database", async () => {
    mocks.getConfig.mockReturnValue(null);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "not_configured" });
    expect(mocks.getMyTenant).not.toHaveBeenCalled();
  });

  it("answers 401 with no session, an auth error or an invalid subject, and reads nothing", async () => {
    for (const result of [
      { data: null, error: new Error("Auth session missing") },
      { data: { claims: {} }, error: null },
      { data: { claims: { sub: "not-a-uuid" } }, error: null },
    ]) {
      mocks.getClaims.mockResolvedValue(result);
      const response = await GET();
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect(mocks.getMyTenant).not.toHaveBeenCalled();
  });

  it("answers 404 for a signed-in user without a membership", async () => {
    mocks.getMyTenant.mockResolvedValue({ ok: true, data: null });
    const response = await GET();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "no_tenant" });
    expect(mocks.getBusinessProfile).not.toHaveBeenCalled();
  });

  it("maps data-layer failures to generic errors", async () => {
    mocks.getBusinessProfile.mockResolvedValue({ ok: false, reason: "unavailable" });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  it("answers 503 instead of throwing when the auth service fails", async () => {
    mocks.getClaims.mockRejectedValue(new Error("boom with internal details"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("boom");
  });
});

describe("PUT /api/profile", () => {
  it("saves the profile for the caller's own tenant and author", async () => {
    const response = await PUT(put(body));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(await response.json()).toMatchObject({ tenant: { id: TENANT_ID, role: "owner" }, profile: { tradeName: "Empresa A" } });
    expect(mocks.saveBusinessProfile).toHaveBeenCalledWith(client, USER_ID, TENANT_ID, body);
  });

  it("rejects a cross-site or origin-less request before doing anything", async () => {
    for (const headers of [{ origin: "https://attacker.test" }, { origin: "" }]) {
      const response = await PUT(put(body, headers));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "invalid_origin" });
    }
    expect(mocks.getClaims).not.toHaveBeenCalled();
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it("answers 401 without a session before reading or validating the body", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: new Error("Auth session missing") });
    const response = await PUT(put("not json at all"));
    expect(response.status).toBe(401);
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type with 415 and an oversized body with 413", async () => {
    expect((await PUT(put(body, { "content-type": "text/plain" }))).status).toBe(415);
    expect((await PUT(put(body, { "content-length": "4097" }))).status).toBe(413);
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it("answers 400 for malformed JSON and for an invalid profile", async () => {
    const malformed = await PUT(put("{not json"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: "invalid_request" });

    const invalid = await PUT(put({ ...body, sector: "notASector" }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_profile" });
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it("never lets the client choose the tenant or the author", async () => {
    for (const extra of [{ tenantId: "00000000-0000-4000-8000-0000000000b2" }, { tenant_id: "x" }, { createdBy: "x" }, { role: "owner" }]) {
      expect((await PUT(put({ ...body, ...extra }))).status).toBe(400);
    }
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it("answers 404 when the caller has no membership", async () => {
    mocks.getMyTenant.mockResolvedValue({ ok: true, data: null });
    const response = await PUT(put(body));
    expect(response.status).toBe(404);
    expect(mocks.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it("answers 401 when the database rejects an expired or invalid token", async () => {
    mocks.saveBusinessProfile.mockResolvedValue({ ok: false, reason: "unauthorized" });
    const response = await PUT(put(body));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });

    mocks.getMyTenant.mockResolvedValue({ ok: false, reason: "unauthorized" });
    expect((await GET()).status).toBe(401);
  });

  it("maps database refusals to 403 and 409 and failures to a generic 503", async () => {
    mocks.saveBusinessProfile.mockResolvedValue({ ok: false, reason: "forbidden" });
    expect((await PUT(put(body))).status).toBe(403);

    mocks.saveBusinessProfile.mockResolvedValue({ ok: false, reason: "conflict" });
    expect((await PUT(put(body))).status).toBe(409);

    mocks.saveBusinessProfile.mockResolvedValue({ ok: false, reason: "unavailable" });
    const response = await PUT(put(body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });
});
