import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_DIMENSIONS } from "@/lib/contracts/audit";
import { NOVA_DRAFT_PACK as pack } from "@/lib/audit-packs/nova-draft";
import { advance, initialState, type ChatState } from "@/lib/guided-chat";
import { PipelineProvider, usePipeline } from "./PipelineProvider";

const T = "00000000-0000-4000-8000-0000000000b1";

const lead = {
  id: "l1", contactId: "c1", conversationId: null, status: "qualified", grade: "hot", points: 9, priority: "high", challenge: null, question: null,
  qualification: { reasons: ["Prospecto caliente (9 puntos)."], services: ["web"], topGaps: ["capture"], treatment: "usted" }, nextActionText: "Aprobar", nextActionAt: "2030-01-01T00:00:00Z",
  ownerUserId: null, ownerName: null, createdAt: new Date().toISOString(), convertedOpportunityId: null, contactName: "Ana", company: "Café Sol", email: "ana@x.co", phone: null,
  assessment: null, meetingApproved: false, approval: { id: "ap1", kind: "meeting_request", draft: { text: "Hola Ana" }, createdAt: new Date().toISOString() },
};
const server = {
  since: "2026-11-05T00:00:00Z", sinceVisit: { analyzed: 2, prospects: 2, hot: 1, conversations: 2, won: 0 }, leads: { open: 1, hot: 1, needFollowUp: 0, total: 1 },
  approvals: { pending: 1, items: [] }, opportunities: { open: 0, won: 0, openAmountMinor: 0, wonAmountMinor: 0 }, customers: { active: 0 }, conversations: { open: 0, messagesToday: 0 }, activity: [],
};

const calls: { path: string; method: string; body: unknown }[] = [];
function fakeFetch(extra: Record<string, unknown> = {}) {
  return vi.fn(async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const data = path.startsWith("/api/v1/leads?") ? { leads: [lead] } : path.startsWith("/api/v1/dashboard") ? server : path in extra ? extra[path] : { ok: true, leadId: "l1" };
    return { ok: true, status: 200, json: async () => data } as Response;
  });
}

function Probe({ onReady }: { onReady: (value: ReturnType<typeof usePipeline>) => void }) {
  const value = usePipeline();
  onReady(value);
  return <p>{value.loading ? "loading" : `${value.leads.length} leads`}</p>;
}

function finished(): ChatState {
  const inputs = ["audit", "Ana", "Café Sol", "moreClients", ...AUDIT_DIMENSIONS.map(() => "none"), "high", "now", "owner", "email", "ana@cafesol.example"];
  let state = initialState("usted");
  for (const input of inputs) state = advance(state, input, pack).state;
  return state;
}

beforeEach(() => {
  calls.length = 0;
  vi.stubGlobal("fetch", fakeFetch());
});
afterEach(() => vi.unstubAllGlobals());

describe("pipeline in backend mode", () => {
  it("loads leads and the dashboard from the API and keeps them after a refresh of the page", async () => {
    let value!: ReturnType<typeof usePipeline>;
    render(
      <PipelineProvider backend={{ tenantId: T }} seed={false}>
        <Probe onReady={(v) => (value = v)} />
      </PipelineProvider>,
    );
    expect(await screen.findByText("1 leads")).toBeInTheDocument();
    expect(calls.map((call) => call.path)).toEqual([`/api/v1/leads?tenantId=${T}`, `/api/v1/dashboard?tenantId=${T}`]);
    expect(value.mode).toBe("backend");
    expect(value.digest.overnight).toMatchObject({ analyzed: 2, hot: 1, awaitingApproval: 1 });
    expect(value.sorted[0].approvalId).toBe("ap1");
  });

  it("stores a finished conversation through the API and focuses the new lead", async () => {
    let value!: ReturnType<typeof usePipeline>;
    render(
      <PipelineProvider backend={{ tenantId: T }} seed={false}>
        <Probe onReady={(v) => (value = v)} />
      </PipelineProvider>,
    );
    await screen.findByText("1 leads");
    calls.length = 0;
    await act(async () => value.receiveHandoff({} as never, { state: finished(), transcript: [{ direction: "out", senderKind: "nex", contentType: "text", body: "Hola" }] }));
    const post = calls.find((call) => call.path === "/api/v1/prospects");
    expect(post?.method).toBe("POST");
    expect(post?.body).toMatchObject({ tenantId: T, transcript: [{ body: "Hola" }] });
    await waitFor(() => expect(value.focusId).toBe("l1"));
  });

  it("approves, rejects and converts through the API", async () => {
    let value!: ReturnType<typeof usePipeline>;
    render(
      <PipelineProvider backend={{ tenantId: T }} seed={false}>
        <Probe onReady={(v) => (value = v)} />
      </PipelineProvider>,
    );
    await screen.findByText("1 leads");
    calls.length = 0;
    await act(async () => value.approveMeeting("l1"));
    await act(async () => value.discardMeeting("l1"));
    await act(async () => value.winLead("l1"));
    const mutations = calls.filter((call) => call.method === "POST").map((call) => [call.path, call.body]);
    expect(mutations).toEqual([
      ["/api/v1/approvals/ap1", { approve: true }],
      ["/api/v1/approvals/ap1", { approve: false }],
      ["/api/v1/leads/l1/win", {}],
    ]);
  });

  it("shows an understandable error when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) }) as Response));
    let value!: ReturnType<typeof usePipeline>;
    render(
      <PipelineProvider backend={{ tenantId: T }} seed={false}>
        <Probe onReady={(v) => (value = v)} />
      </PipelineProvider>,
    );
    await waitFor(() => expect(value.error).toBe("Tu rol no permite hacer esto."));
  });
});

describe("pipeline in demonstration mode", () => {
  it("never touches the network", async () => {
    let value!: ReturnType<typeof usePipeline>;
    render(
      <PipelineProvider>
        <Probe onReady={(v) => (value = v)} />
      </PipelineProvider>,
    );
    await act(async () => value.winLead(value.sorted[0].id));
    expect(calls).toEqual([]);
    expect(value.mode).toBe("demo");
    expect(value.leads.some((candidate) => candidate.stage === "won")).toBe(true);
  });
});
