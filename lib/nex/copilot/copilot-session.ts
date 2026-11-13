// Copilot Session: the context of a conversation, WITHOUT the conversation. A session remembers the topic, the objective, the company, the person or worker, the last decisions and the last
// recommendations (ids and fixed titles), plus the few meaningful words of the last question so that a short follow-up keeps its topic. It never keeps a question, an answer or the context that
// was retrieved. A session belongs to the one who opened it, is idle-limited, and each company keeps a bounded number. Pure: the clock is handed in.

import type { Intent, Session, SessionDecision } from "./copilot-types";

export const sessionIdFor = (n: number): string => `s_${String(n).padStart(6, "0")}`;
export const SESSION_ID = /^s_\d{6}$/;
export const MAX_FOCUS = 5;

export function newSession(tenantId: string, owner: string, id: string, at: string): Session {
  return { id, tenantId, owner, startedAt: at, lastAt: at, turns: 0, focus: [], decisions: [], recommendations: [] };
}
/** A session of this company that belongs to this asker: nobody else's. */
export const findSession = (sessions: readonly Session[], tenantId: string, id: string, owner: string): Session | undefined => sessions.find((session) => session.tenantId === tenantId && session.id === id && session.owner === owner);
export const latestSessionOf = (sessions: readonly Session[], tenantId: string, owner: string): Session | undefined =>
  [...sessions].filter((session) => session.tenantId === tenantId && session.owner === owner).sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.id.localeCompare(a.id))[0];
export const replaceSession = (sessions: readonly Session[], next: Session): Session[] => sessions.map((session) => (session.tenantId === next.tenantId && session.id === next.id ? next : session));

/** A session idle for longer than the TTL is over and forgotten. */
export function sweepSessions(sessions: readonly Session[], tenantId: string, nowMs: number, ttlMs: number): { sessions: Session[]; ended: number } {
  const kept = sessions.filter((session) => !(session.tenantId === tenantId && nowMs - Date.parse(session.lastAt) >= ttlMs));
  return { sessions: kept, ended: sessions.length - kept.length };
}
/** Adds a session, keeping at most `max` per company: the least recently used go first. */
export function addSession(sessions: readonly Session[], session: Session, max: number): Session[] {
  const next = [...sessions, session];
  const mine = next.filter((row) => row.tenantId === session.tenantId);
  if (mine.length <= max) return next;
  const drop = new Set([...mine].sort((a, b) => a.lastAt.localeCompare(b.lastAt) || a.id.localeCompare(b.id)).slice(0, mine.length - max));
  return next.filter((row) => !drop.has(row));
}
export const removeSession = (sessions: readonly Session[], tenantId: string, id: string): Session[] => sessions.filter((session) => !(session.tenantId === tenantId && session.id === id));

export function recordTurn(session: Session, input: { at: string; topic: Intent; terms: readonly string[]; objective?: string; recommendations: Session["recommendations"] }): Session {
  return {
    ...session, lastAt: input.at, turns: session.turns + 1,
    // "information" says nothing about the topic: a general question keeps the one the session already had
    topic: input.topic === "information" && session.topic ? session.topic : input.topic,
    ...(input.objective !== undefined ? { objective: input.objective } : {}),
    // a short follow-up keeps the focus of the last real question
    focus: input.terms.length >= 2 ? input.terms.slice(0, MAX_FOCUS) : session.focus, recommendations: input.recommendations,
  };
}
export function addDecision(session: Session, decision: SessionDecision, max: number): Session {
  return { ...session, decisions: [...session.decisions, decision].slice(-max) };
}
