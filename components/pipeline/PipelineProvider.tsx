"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Lead } from "@/lib/contracts/pipeline";
import type { LeadDto, ServerDigest, TranscriptEntry } from "@/lib/contracts/backend";
import { NOVA_DRAFT_PACK, type ClientPack } from "@/lib/audit-packs/nova-draft";
import { apiFetch, errorMessage } from "@/lib/api/client";
import { approveMeeting, digest, discardMeeting, leadFromHandoff, seedLeads, sortLeads, type Digest } from "@/lib/pipeline";
import { digestFromServer, leadFromDto } from "@/lib/modules/leads/map";
import type { ChatState, Handoff } from "@/lib/guided-chat";
import { useSession } from "@/components/session/SessionProvider";

// The commercial pipeline shared by every screen (chat, pipeline, dashboard).
// Demonstration mode keeps it in memory with fictitious leads. Backend mode reads and writes /api/v1, so
// nothing is lost on a refresh and every action is checked by the database against the user's role.

export type HandoffContext = { state: ChatState; transcript: TranscriptEntry[] };
export type ActivityItem = ServerDigest["activity"][number];

type PipelineContextValue = {
  mode: "demo" | "backend";
  pack: ClientPack;
  leads: Lead[];
  sorted: Lead[];
  digest: Digest;
  activity: ActivityItem[];
  server: ServerDigest | null;
  loading: boolean;
  error: string | null;
  canWrite: boolean;
  canDecide: boolean;
  focusId: string | null;
  focus: (id: string | null) => void;
  // Single entry point for every conversation channel: its handoff becomes a lead.
  receiveHandoff: (handoff: Handoff, context?: HandoffContext) => Promise<void>;
  approveMeeting: (id: string) => Promise<void>;
  discardMeeting: (id: string) => Promise<void>;
  winLead: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
};

const PipelineContext = createContext<PipelineContextValue | null>(null);

type Props = { children: ReactNode; pack?: ClientPack; seed?: boolean; backend?: { tenantId: string } };

export function PipelineProvider({ children, pack = NOVA_DRAFT_PACK, seed = true, backend }: Props) {
  return backend ? (
    <BackendPipeline pack={pack} tenantId={backend.tenantId}>
      {children}
    </BackendPipeline>
  ) : (
    <DemoPipeline pack={pack} seed={seed}>
      {children}
    </DemoPipeline>
  );
}

function DemoPipeline({ children, pack, seed }: { children: ReactNode; pack: ClientPack; seed: boolean }) {
  const [leads, setLeads] = useState<Lead[]>(() => (seed ? seedLeads(pack) : []));
  const [focusId, setFocusId] = useState<string | null>(null);
  const counter = useRef(1);

  const value = useMemo<PipelineContextValue>(
    () => ({
      mode: "demo",
      pack,
      leads,
      sorted: sortLeads(leads),
      digest: digest(leads),
      activity: [],
      server: null,
      loading: false,
      error: null,
      canWrite: true,
      canDecide: true,
      focusId,
      focus: setFocusId,
      receiveHandoff: async (handoff) => {
        const lead = leadFromHandoff(handoff, pack, `chat-${counter.current++}`);
        setLeads((current) => [...current, lead]);
        setFocusId(lead.id);
      },
      approveMeeting: async (id) => setLeads((current) => approveMeeting(current, id)),
      discardMeeting: async (id) => setLeads((current) => discardMeeting(current, id)),
      winLead: async (id) => setLeads((current) => current.map((lead) => (lead.id === id ? { ...lead, stage: "won", approval: null, nextAction: "Cliente: dar la bienvenida" } : lead))),
      refresh: async () => undefined,
    }),
    [pack, leads, focusId],
  );

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

function BackendPipeline({ children, pack, tenantId }: { children: ReactNode; pack: ClientPack; tenantId: string }) {
  const session = useSession();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [server, setServer] = useState<ServerDigest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  // Leads created after the page opened are "new in this session"; everything older was waiting for the user.
  const sessionStartedAt = useRef(new Date());

  const refresh = useCallback(async () => {
    const [leadsResult, dashboardResult] = await Promise.all([
      apiFetch<{ leads: LeadDto[] }>(`/api/v1/leads?tenantId=${tenantId}`),
      apiFetch<ServerDigest>(`/api/v1/dashboard?tenantId=${tenantId}`),
    ]);
    if (!leadsResult.ok) setError(errorMessage(leadsResult.error));
    else {
      setError(null);
      setLeads(leadsResult.data.leads.map((dto) => leadFromDto(dto, pack, sessionStartedAt.current)));
    }
    // The dashboard fetch also marks the visit; keep the first answer of a visit for "while you were away".
    if (dashboardResult.ok) setServer((current) => (current ? { ...dashboardResult.data, since: current.since, sinceVisit: current.sinceVisit } : dashboardResult.data));
    setLoading(false);
  }, [tenantId, pack]);

  useEffect(() => {
    setLoading(true);
    setServer(null);
    void refresh();
  }, [refresh]);

  const act = useCallback(
    async (path: string, body: unknown, method = "POST") => {
      const result = await apiFetch(path, { method, body });
      if (!result.ok) {
        setError(errorMessage(result.error));
        return false;
      }
      await refresh();
      return true;
    },
    [refresh],
  );

  const value = useMemo<PipelineContextValue>(() => {
    const sorted = sortLeads(leads);
    return {
      mode: "backend",
      pack,
      leads,
      sorted,
      digest: server ? digestFromServer(server, leads) : { overnight: { analyzed: 0, hot: 0, awaitingApproval: 0, needFollowUp: 0, withMeeting: 0 }, session: [], approvals: [], total: 0 },
      activity: server?.activity ?? [],
      server,
      loading,
      error,
      canWrite: session.can("write"),
      canDecide: session.can("admin"),
      focusId,
      focus: setFocusId,
      receiveHandoff: async (_handoff, context) => {
        if (!context) return;
        const result = await apiFetch<{ leadId: string }>("/api/v1/prospects", { body: { tenantId, state: context.state, transcript: context.transcript } });
        if (!result.ok) {
          setError(errorMessage(result.error));
          return;
        }
        await refresh();
        setFocusId(result.data.leadId);
      },
      approveMeeting: async (id) => {
        const lead = leads.find((candidate) => candidate.id === id);
        if (lead?.approvalId) await act(`/api/v1/approvals/${lead.approvalId}`, { approve: true });
      },
      discardMeeting: async (id) => {
        const lead = leads.find((candidate) => candidate.id === id);
        if (lead?.approvalId) await act(`/api/v1/approvals/${lead.approvalId}`, { approve: false });
      },
      winLead: async (id) => void (await act(`/api/v1/leads/${id}/win`, {})),
      refresh,
    };
  }, [pack, leads, server, loading, error, session, focusId, tenantId, refresh, act]);

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipeline(): PipelineContextValue {
  const value = useContext(PipelineContext);
  if (!value) throw new Error("usePipeline must be used inside PipelineProvider");
  return value;
}
