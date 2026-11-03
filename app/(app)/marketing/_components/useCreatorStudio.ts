"use client";

import { useEffect, useRef, useState } from "react";
import { CREATOR_LIMITS, type ChannelBrief, type CreatorStudioState, type Idea, type IdeaPriority, type ProductionStage, type Video } from "@/lib/contracts/creator";
import {
  addIdea,
  emptyState,
  localToday,
  parseStudioState,
  promoteIdea,
  removeIdea,
  removeVideo,
  sampleState,
  setStage,
  updateBrief,
  updateIdea,
  updateVideo,
} from "@/lib/creator";

// The studio lives only in this browser (like the NEX history): no server, no tenant, no network. Whatever is
// read back is validated; when it does not match the expected shape it is not used, and a copy is kept under
// BACKUP_KEY before the first new save replaces it, so nothing is lost silently.
const STORAGE_KEY = "kynova.creator.youtube.v1";
const BACKUP_KEY = `${STORAGE_KEY}.backup`;

function readState(): CreatorStudioState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = parseStudioState(JSON.parse(raw));
    if (parsed) return parsed;
  } catch {
    // Unreadable: handled below like any value that is not a valid studio.
  }
  if (raw) {
    try {
      window.localStorage.setItem(BACKUP_KEY, raw);
    } catch {
      // No room for a backup: the invalid value stays where it is until the next save.
    }
  }
  return emptyState();
}

function writeState(state: CreatorStudioState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, quota): the work lives only for this visit.
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const nowIso = () => new Date().toISOString();

/** One script per idea, so its id comes from the idea: pressing the button twice still points to the same script. */
export const scriptIdOf = (ideaId: string) => `video-${ideaId}`.slice(0, CREATOR_LIMITS.id);

export function useCreatorStudio() {
  const [state, setState] = useState<CreatorStudioState>(emptyState);
  const [ready, setReady] = useState(false);
  const saved = useRef(false);

  // Storage is only readable in the browser, after hydration.
  useEffect(() => {
    setState(readState());
    setReady(true);
  }, []);

  // Persist after every change. The first run only marks what was just loaded as already saved.
  useEffect(() => {
    if (!ready) return;
    if (!saved.current) {
      saved.current = true;
      return;
    }
    writeState(state);
  }, [state, ready]);

  const actions = {
    updateBrief: (patch: Partial<ChannelBrief>) => setState((current) => updateBrief(current, patch)),
    addIdea: (input: { title: string; note?: string; priority?: IdeaPriority }) => {
      const id = newId();
      const now = nowIso();
      setState((current) => addIdea(current, input, id, now));
    },
    updateIdea: (id: string, patch: Partial<Pick<Idea, "title" | "note" | "priority" | "status">>) => setState((current) => updateIdea(current, id, patch)),
    removeIdea: (id: string) => setState((current) => removeIdea(current, id)),
    /** Returns the id of the script that exists, or will exist, for the idea. */
    createScript: (ideaId: string): string => {
      const id = scriptIdOf(ideaId);
      const now = nowIso();
      setState((current) => promoteIdea(current, ideaId, id, now));
      return id;
    },
    updateVideo: (id: string, patch: Partial<Pick<Video, "title" | "hook" | "body" | "cta">> & { plannedDate?: string | null }) => {
      const now = nowIso();
      setState((current) => updateVideo(current, id, patch, now));
    },
    setStage: (id: string, stage: ProductionStage) => {
      const now = nowIso();
      setState((current) => setStage(current, id, stage, now));
    },
    removeVideo: (id: string) => setState((current) => removeVideo(current, id)),
    loadSample: () => {
      const today = localToday();
      setState(sampleState(today));
    },
    reset: () => setState(emptyState()),
  };

  return { state, ready, actions };
}

export type CreatorStudioActions = ReturnType<typeof useCreatorStudio>["actions"];
