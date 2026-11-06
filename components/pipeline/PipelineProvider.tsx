"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Lead } from "@/lib/contracts/pipeline";
import { NOVA_DRAFT_PACK, type ClientPack } from "@/lib/audit-packs/nova-draft";
import { approveMeeting, digest, discardMeeting, leadFromHandoff, seedLeads, sortLeads, type Digest } from "@/lib/pipeline";
import type { Handoff } from "@/lib/guided-chat";

// The commercial pipeline shared by every screen (chat, pipeline, dashboard). It lives in memory while the app is open:
// no storage, no network. Reloading the page restores the demo data. Persistence comes with the conversations ADR.

type PipelineContextValue = {
  pack: ClientPack;
  leads: Lead[];
  sorted: Lead[];
  digest: Digest;
  focusId: string | null;
  focus: (id: string | null) => void;
  // Single entry point for every conversation channel: its handoff becomes a lead.
  receiveHandoff: (handoff: Handoff) => Lead;
  approveMeeting: (id: string) => void;
  discardMeeting: (id: string) => void;
};

const PipelineContext = createContext<PipelineContextValue | null>(null);

export function PipelineProvider({ children, pack = NOVA_DRAFT_PACK, seed = true }: { children: ReactNode; pack?: ClientPack; seed?: boolean }) {
  const [leads, setLeads] = useState<Lead[]>(() => (seed ? seedLeads(pack) : []));
  const [focusId, setFocusId] = useState<string | null>(null);
  const [counter, setCounter] = useState(1);

  const receiveHandoff = useCallback(
    (handoff: Handoff) => {
      const lead = leadFromHandoff(handoff, pack, `chat-${counter}`);
      setCounter((value) => value + 1);
      setLeads((current) => [...current, lead]);
      setFocusId(lead.id);
      return lead;
    },
    [pack, counter],
  );

  const value = useMemo<PipelineContextValue>(
    () => ({
      pack,
      leads,
      sorted: sortLeads(leads),
      digest: digest(leads),
      focusId,
      focus: setFocusId,
      receiveHandoff,
      approveMeeting: (id) => setLeads((current) => approveMeeting(current, id)),
      discardMeeting: (id) => setLeads((current) => discardMeeting(current, id)),
    }),
    [pack, leads, focusId, receiveHandoff],
  );

  return <PipelineContext.Provider value={value}>{children}</PipelineContext.Provider>;
}

export function usePipeline(): PipelineContextValue {
  const value = useContext(PipelineContext);
  if (!value) throw new Error("usePipeline must be used inside PipelineProvider");
  return value;
}
