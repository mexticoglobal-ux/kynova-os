import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessProfileInput } from "@/lib/contracts/tenancy";
import { getBusinessProfile, getMyTenant, saveBusinessProfile } from "./tenancy";

const TENANT_ID = "00000000-0000-4000-8000-0000000000b1";
const USER_ID = "00000000-0000-4000-8000-0000000000a1";

const input: BusinessProfileInput = {
  tradeName: "Empresa de prueba",
  country: "CR",
  locale: "es",
  sector: "software",
  teamSize: "small",
  channel: "web",
  crm: "basicTool",
  problem: "leads",
  goal: "moreSales",
};

const row = {
  tenant_id: TENANT_ID,
  trade_name: "Empresa de prueba",
  country: "CR",
  locale: "es",
  sector: "software",
  team_size: "small",
  channel: "web",
  crm: "basicTool",
  problem: "leads",
  goal: "moreSales",
  questionnaire_version: 1,
  created_at: "2026-10-31T10:00:00+00:00",
  updated_at: "2026-10-31T10:05:00+00:00",
};

type Result = { data: unknown; error: { code?: string; message?: string } | null };
type Call = { table: string; ops: Array<[string, unknown[]]> };

// Each query consumes the next scripted result. The builder is thenable like supabase-js's.
function fakeClient(results: Result[]) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, ops: [] };
      calls.push(call);
      const next = () => Promise.resolve(results.shift() ?? { data: null, error: { code: "XX000" } });
      const builder: Record<string, unknown> = {};
      for (const op of ["select", "insert", "update", "eq", "order", "limit"]) {
        builder[op] = (...args: unknown[]) => {
          call.ops.push([op, args]);
          return builder;
        };
      }
      builder.maybeSingle = () => next();
      builder.single = () => next();
      builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => next().then(resolve, reject);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const opsNamed = (call: Call | undefined, name: string) => call?.ops.filter(([op]) => op === name) ?? [];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getMyTenant", () => {
  it("returns the oldest membership with the tenant name", async () => {
    const { client, calls } = fakeClient([{ data: [{ tenant_id: TENANT_ID, role: "owner", tenants: { name: "Empresa A" } }], error: null }]);
    expect(await getMyTenant(client)).toEqual({ ok: true, data: { tenantId: TENANT_ID, name: "Empresa A", role: "owner" } });
    expect(calls[0]?.table).toBe("memberships");
    // Deterministic even when memberships share created_at: tenant_id is the tiebreak.
    expect(opsNamed(calls[0], "order").map(([, args]) => args)).toEqual([
      ["created_at", { ascending: true }],
      ["tenant_id", { ascending: true }],
    ]);
  });

  it("returns null when the user has no membership", async () => {
    expect(await getMyTenant(fakeClient([{ data: [], error: null }]).client)).toEqual({ ok: true, data: null });
  });

  it("does not trust a malformed row", async () => {
    const { client } = fakeClient([{ data: [{ tenant_id: "x", role: "owner", tenants: { name: "A" } }], error: null }]);
    expect(await getMyTenant(client)).toEqual({ ok: false, reason: "unavailable" });
  });

  it("maps database errors without leaking them, logging only the error code", async () => {
    expect(await getMyTenant(fakeClient([{ data: null, error: { code: "XX000", message: "secret detail" } }]).client)).toEqual({
      ok: false,
      reason: "unavailable",
    });
    expect(console.error).toHaveBeenCalledWith("tenancy_query_failed", { code: "XX000" });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("secret detail");
  });

  it("maps an expired or invalid JWT to unauthorized so the client can sign in again", async () => {
    for (const code of ["PGRST301", "PGRST303"]) {
      expect(await getMyTenant(fakeClient([{ data: null, error: { code } }]).client)).toEqual({ ok: false, reason: "unauthorized" });
    }
  });
});

describe("getBusinessProfile", () => {
  it("filters by tenant_id and maps the row to the contract", async () => {
    const { client, calls } = fakeClient([{ data: row, error: null }]);
    const result = await getBusinessProfile(client, TENANT_ID);
    expect(result.ok && result.data?.tradeName).toBe("Empresa de prueba");
    expect(opsNamed(calls[0], "eq")[0]?.[1]).toEqual(["tenant_id", TENANT_ID]);
  });

  it("returns null when the tenant has no profile yet", async () => {
    expect(await getBusinessProfile(fakeClient([{ data: null, error: null }]).client, TENANT_ID)).toEqual({ ok: true, data: null });
  });

  it("reports forbidden for a permission error", async () => {
    expect(await getBusinessProfile(fakeClient([{ data: null, error: { code: "42501" } }]).client, TENANT_ID)).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });
});

describe("saveBusinessProfile", () => {
  it("inserts when no profile exists, stamping the author and never sending an id", async () => {
    const { client, calls } = fakeClient([
      { data: null, error: null },
      { data: row, error: null },
    ]);
    const result = await saveBusinessProfile(client, USER_ID, TENANT_ID, input);
    expect(result.ok).toBe(true);

    const payload = opsNamed(calls[1], "insert")[0]?.[1][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ tenant_id: TENANT_ID, created_by: USER_ID, updated_by: USER_ID, sector: "software", team_size: "small" });
    expect(payload).not.toHaveProperty("id");
  });

  it("updates an existing profile without touching tenant_id or created_by", async () => {
    const { client, calls } = fakeClient([
      { data: { tenant_id: TENANT_ID }, error: null },
      { data: { ...row, trade_name: "Renombrada" }, error: null },
    ]);
    const result = await saveBusinessProfile(client, USER_ID, TENANT_ID, { ...input, tradeName: "Renombrada" });
    expect(result.ok && result.data.tradeName).toBe("Renombrada");

    const payload = opsNamed(calls[1], "update")[0]?.[1][0] as Record<string, unknown>;
    expect(payload).toMatchObject({ trade_name: "Renombrada", updated_by: USER_ID });
    expect(payload).not.toHaveProperty("tenant_id");
    expect(payload).not.toHaveProperty("created_by");
    expect(opsNamed(calls[1], "eq")[0]?.[1]).toEqual(["tenant_id", TENANT_ID]);
  });

  it("treats zero updated rows as forbidden: RLS hid the row", async () => {
    const { client } = fakeClient([
      { data: { tenant_id: TENANT_ID }, error: null },
      { data: null, error: null },
    ]);
    expect(await saveBusinessProfile(client, USER_ID, TENANT_ID, input)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("maps a rejected insert to forbidden", async () => {
    const denied = fakeClient([
      { data: null, error: null },
      { data: null, error: { code: "42501" } },
    ]);
    expect(await saveBusinessProfile(denied.client, USER_ID, TENANT_ID, input)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("is idempotent when a concurrent first save wins the race: the duplicate insert becomes an update", async () => {
    const { client, calls } = fakeClient([
      { data: null, error: null }, // lookup: no profile yet
      { data: null, error: { code: "23505" } }, // insert: the other request created it first
      { data: row, error: null }, // update succeeds
    ]);
    const result = await saveBusinessProfile(client, USER_ID, TENANT_ID, input);
    expect(result.ok).toBe(true);
    expect(opsNamed(calls[1], "insert")).toHaveLength(1);
    expect(opsNamed(calls[2], "update")).toHaveLength(1);
  });

  it("still refuses when the fallback update is not allowed", async () => {
    const { client } = fakeClient([
      { data: null, error: null },
      { data: null, error: { code: "23505" } },
      { data: null, error: null }, // RLS hides the row from this caller
    ]);
    expect(await saveBusinessProfile(client, USER_ID, TENANT_ID, input)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("does not trust the row the database returns", async () => {
    const { client } = fakeClient([
      { data: null, error: null },
      { data: { ...row, sector: "other-sector" }, error: null },
    ]);
    expect(await saveBusinessProfile(client, USER_ID, TENANT_ID, input)).toEqual({ ok: false, reason: "unavailable" });
  });
});
