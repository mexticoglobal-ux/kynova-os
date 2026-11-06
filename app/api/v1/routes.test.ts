import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_DIMENSIONS } from "@/lib/contracts/audit";
import { NOVA_DRAFT_PACK as pack } from "@/lib/audit-packs/nova-draft";
import { advance, initialState, type ChatState } from "@/lib/guided-chat";

const mocks = vi.hoisted(() => ({ config: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/db/supabase-spike", () => ({
  getSupabaseSpikeConfig: mocks.config,
  createSupabaseSpikeServerClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));

import { POST as postProspect } from "./prospects/route";
import { POST as postClient, GET as getClients } from "./clients/route";
import { PATCH as patchClient } from "./clients/[id]/route";
import { POST as winLead } from "./leads/[id]/win/route";
import { POST as decide } from "./approvals/[id]/route";
import { POST as postCompany } from "./companies/route";
import { DELETE as deleteCompany } from "./companies/[id]/route";
import { POST as inbound } from "./inbound/[provider]/route";
import { POST as postAssessment } from "./assessments/route";

const ORIGIN = "https://kynova.test";
const T = "00000000-0000-4000-8000-0000000000b1";
const ID = "00000000-0000-4000-8000-0000000000c1";

const post = (path: string, body: unknown, method = "POST") =>
  new NextRequest(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) });
const none = params({});

function finished(): ChatState {
  const inputs = ["audit", "Ana", "Café Sol", "moreClients", ...AUDIT_DIMENSIONS.map(() => "none"), "high", "now", "owner", "email", "ana@cafesol.example"];
  let state = initialState("usted");
  for (const input of inputs) state = advance(state, input, pack).state;
  return state;
}

beforeEach(() => {
  mocks.config.mockReset().mockReturnValue({ url: "https://x.supabase.co", publishableKey: "k" });
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: "00000000-0000-4000-8000-0000000000a1", email: "o@example.test" } }, error: null });
  mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null });
});

describe("POST /api/v1/prospects", () => {
  it("recomputes the score on the server and stores the whole conversation in one call", async () => {
    mocks.rpc.mockResolvedValue({ data: { leadId: ID, contactId: ID, conversationId: ID, assessmentRunId: ID, approvalRequestId: ID }, error: null });
    const response = await postProspect(post("/api/v1/prospects", { tenantId: T, state: finished(), transcript: [{ direction: "out", senderKind: "nex", body: "Hola" }] }), none);
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [name, args] = mocks.rpc.mock.calls[0];
    expect(name).toBe("capture_prospect");
    expect(args.p_tenant).toBe(T);
    expect(args.p.route).toBe("hot");
    expect(args.p.audit.score).toBe(0);
    expect(args.p.meetingDraft).toContain("Hola Ana");
  });

  it("ignores any score the browser sends: only the closed answers count", async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    const state = { ...finished(), score: 100, grade: "cold" };
    await postProspect(post("/api/v1/prospects", { tenantId: T, state, transcript: [], score: 100 }), none);
    expect(mocks.rpc.mock.calls[0][1].p.audit.score).toBe(0);
  });

  it("refuses an unfinished conversation and a malformed body", async () => {
    expect((await postProspect(post("/api/v1/prospects", { tenantId: T, state: initialState("usted"), transcript: [] }), none)).status).toBe(422);
    expect((await postProspect(post("/api/v1/prospects", { tenantId: "x", state: finished(), transcript: [] }), none)).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("answers 403 when the database refuses the caller's role", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await postProspect(post("/api/v1/prospects", { tenantId: T, state: finished(), transcript: [] }), none)).status).toBe(403);
  });
});

describe("clients", () => {
  it("creates and lists with the tenant from the request, validated", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: ID, error: null });
    expect((await postClient(post("/api/v1/clients", { tenantId: T, name: "Marta", email: "M@x.co" }), none)).status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("create_client", { p_tenant: T, p_name: "Marta", p_email: "m@x.co", p_phone: null, p_organization: null, p_notes: null });
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    const list = await getClients(new NextRequest(`${ORIGIN}/api/v1/clients?tenantId=${T}&status=active&search=mar`), none);
    expect(await list.json()).toEqual({ clients: [] });
    expect(mocks.rpc).toHaveBeenLastCalledWith("list_clients", expect.objectContaining({ p_tenant: T, p_status: "active", p_search: "mar" }));
  });

  it("rejects an invalid client and maps a duplicate to 409", async () => {
    expect((await postClient(post("/api/v1/clients", { tenantId: T, name: "" }), none)).status).toBe(400);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    expect((await postClient(post("/api/v1/clients", { tenantId: T, name: "Marta" }), none)).status).toBe(409);
  });

  it("archives through a patch and never deletes", async () => {
    expect((await patchClient(post(`/api/v1/clients/${ID}`, { tenantId: T, status: "inactive" }, "PATCH"), params({ id: ID }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("update_client", { p_customer: ID, p: { status: "inactive" } });
  });
});

describe("conversion, approvals and companies", () => {
  it("converts a prospect into a customer through win_lead", async () => {
    mocks.rpc.mockResolvedValue({ data: { opportunityId: "o", customerId: "c", contactId: "k" }, error: null });
    const response = await winLead(post(`/api/v1/leads/${ID}/win`, { title: "Plan", amountMinor: 5000 }), params({ id: ID }));
    expect(response.status).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith("win_lead", { p_lead: ID, p_title: "Plan", p_amount_minor: 5000, p_currency: "USD" });
    expect((await winLead(post(`/api/v1/leads/not-a-uuid/win`, {}), params({ id: "not-a-uuid" }))).status).toBe(400);
  });

  it("decides an approval and lets the database enforce who can", async () => {
    expect((await decide(post(`/api/v1/approvals/${ID}`, { approve: true }), params({ id: ID }))).status).toBe(200);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    expect((await decide(post(`/api/v1/approvals/${ID}`, { approve: true }), params({ id: ID }))).status).toBe(403);
    expect((await decide(post(`/api/v1/approvals/${ID}`, { approve: "maybe" }), params({ id: ID }))).status).toBe(400);
  });

  it("creates a company and deletes it only with the typed name", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: T, error: null });
    const created = await postCompany(post("/api/v1/companies", { name: "Nova" }), none);
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ tenantId: T });
    expect((await deleteCompany(post(`/api/v1/companies/${T}`, {}, "DELETE"), params({ id: T }))).status).toBe(400);
    expect((await deleteCompany(post(`/api/v1/companies/${T}`, { confirmName: "Nova" }, "DELETE"), params({ id: T }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("delete_company", { p_tenant: T, p_confirm_name: "Nova" });
  });
});

describe("assessments", () => {
  it("saves an audit with the score recomputed from the answers", async () => {
    mocks.rpc.mockResolvedValue({ data: { assessmentId: ID, contactId: ID }, error: null });
    const answers = Object.fromEntries(AUDIT_DIMENSIONS.map((dimension) => [dimension, "optimized"]));
    expect((await postAssessment(post("/api/v1/assessments", { tenantId: T, answers, businessName: "Café", score: 1 }), none)).status).toBe(201);
    const args = mocks.rpc.mock.calls[0][1];
    expect(mocks.rpc.mock.calls[0][0]).toBe("save_assessment");
    expect(args.p.audit.score).toBe(100);
    expect(args.p.audit.band).toBe("advanced");
  });
});

describe("inbound integrations", () => {
  it("answers 501 for every declared provider and 404 for an unknown one: nothing is read or stored", async () => {
    for (const provider of ["whatsapp", "facebook", "instagram", "email", "stripe", "paypal", "makapay", "makawallet", "sinpe"]) {
      const response = await inbound(new NextRequest(`${ORIGIN}/api/v1/inbound/${provider}`, { method: "POST", body: "{}" }), params({ provider }));
      expect(response.status).toBe(501);
      expect(await response.json()).toMatchObject({ error: "not_implemented", provider, status: "planned" });
    }
    expect((await inbound(new NextRequest(`${ORIGIN}/api/v1/inbound/zzz`, { method: "POST", body: "{}" }), params({ provider: "zzz" }))).status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
