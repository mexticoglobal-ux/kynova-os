import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { BackendError, createBackend, errorOf } from "./backend";

const T = "00000000-0000-4000-8000-0000000000b1";

function client(handler: (name: string, args: Record<string, unknown>) => { data?: unknown; error?: { code?: string } | null }) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => ({ data: null, error: null, ...handler(name, args) }));
  return { rpc, supabase: { rpc } as unknown as SupabaseClient };
}

describe("error mapping", () => {
  it.each([
    ["28000", "unauthorized"],
    ["PGRST301", "unauthorized"],
    ["42501", "forbidden"],
    ["P0002", "not_found"],
    ["23505", "conflict"],
    ["22023", "invalid"],
    ["23514", "invalid"],
    ["53400", "limit"],
    ["XX000", "unavailable"],
    [undefined, "unavailable"],
  ])("%s becomes %s", (code, expected) => {
    expect(errorOf({ code }).code).toBe(expected);
  });
});

describe("backend calls", () => {
  it("passes named arguments to the right function", async () => {
    const { rpc, supabase } = client(() => ({ data: "company-id" }));
    expect(await createBackend(supabase).createCompany("Nova")).toBe("company-id");
    expect(rpc).toHaveBeenCalledWith("create_company", { p_name: "Nova" });
  });

  it("sends optional filters as null and caps nothing itself", async () => {
    const { rpc, supabase } = client(() => ({ data: [] }));
    await createBackend(supabase).listLeads(T);
    expect(rpc).toHaveBeenCalledWith("list_leads", { p_tenant: T, p_status: null, p_limit: 50, p_after_created_at: null, p_after_id: null });
  });

  it("turns database errors into typed errors and never returns partial data", async () => {
    const { supabase } = client(() => ({ error: { code: "42501" } }));
    await expect(createBackend(supabase).listClients(T)).rejects.toMatchObject({ name: "BackendError", code: "forbidden" });
    await expect(createBackend(supabase).listClients(T)).rejects.toBeInstanceOf(BackendError);
  });

  it("returns an empty list when the database answers with something that is not a list", async () => {
    const { supabase } = client(() => ({ data: { oops: true } }));
    expect(await createBackend(supabase).listTeam(T)).toEqual([]);
  });

  it("maps a win to its function and arguments", async () => {
    const { rpc, supabase } = client(() => ({ data: { opportunityId: "o", customerId: "c", contactId: "k" } }));
    await createBackend(supabase).winLead("lead", { title: "Plan", amountMinor: 5000, currency: "USD" });
    expect(rpc).toHaveBeenCalledWith("win_lead", { p_lead: "lead", p_title: "Plan", p_amount_minor: 5000, p_currency: "USD" });
  });
});
