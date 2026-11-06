"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Message } from "@/types";
import type { ConversationDto, MessageDto } from "@/lib/contracts/backend";
import { apiFetch } from "@/lib/api/client";
import { useSession } from "@/components/session/SessionProvider";

export type Conversation = { id: string; title: string; messages: Message[]; updatedAt: number; loaded: boolean };

const STORAGE_KEY = "kynova.nex.conversations";
const MAX_CONVERSATIONS = 30;

function isConversation(value: unknown): value is Omit<Conversation, "loaded"> {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Conversation>;
  return typeof candidate.id === "string" && typeof candidate.title === "string" && Array.isArray(candidate.messages);
}

function readLocal(): Conversation[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isConversation).map((conversation) => ({ ...conversation, loaded: true })) : [];
  } catch {
    return [];
  }
}

function writeLocal(conversations: Conversation[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
  } catch {
    // Storage unavailable: history lives only for this visit.
  }
}

const newLocalId = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now()));

const toMessage = (dto: MessageDto): Message => ({ role: dto.senderKind === "user" ? "user" : "nex", text: dto.body ?? "" });

// NEX conversation history. With a signed-in company it lives in the database, private to the user, and survives
// any refresh or device; without one (demonstration) it stays in this browser as before.
export function useConversations() {
  const session = useSession();
  const tenantId = session.mode === "backend" ? session.tenantId : null;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState(false);
  // Local id -> server id, and one promise chain per conversation so messages are stored in order.
  const serverIds = useRef(new Map<string, string>());
  // Ids that came from the server list (they exist remotely under the same id).
  const remoteIds = useRef(new Set<string>());
  const chains = useRef(new Map<string, Promise<void>>());

  useEffect(() => {
    if (!tenantId) {
      setConversations(readLocal());
      return;
    }
    void apiFetch<{ conversations: ConversationDto[] }>(`/api/v1/conversations?tenantId=${tenantId}&kind=assistant`).then((result) => {
      if (!result.ok) return setSyncError(true);
      result.data.conversations.forEach((dto) => remoteIds.current.add(dto.id));
      setConversations(result.data.conversations.map((dto) => ({ id: dto.id, title: dto.title ?? "", messages: [], updatedAt: new Date(dto.lastMessageAt).getTime(), loaded: false })));
    });
  }, [tenantId]);

  // Opening a saved conversation fetches its messages once.
  useEffect(() => {
    if (!tenantId || !activeId) return;
    const target = conversations.find((conversation) => conversation.id === activeId);
    if (!target || target.loaded) return;
    void apiFetch<{ messages: MessageDto[] }>(`/api/v1/conversations/${activeId}/messages`).then((result) => {
      if (!result.ok) return setSyncError(true);
      setConversations((current) => current.map((conversation) => (conversation.id === activeId ? { ...conversation, messages: result.data.messages.map(toMessage), loaded: true } : conversation)));
    });
  }, [tenantId, activeId, conversations]);

  const enqueue = useCallback((localId: string, task: () => Promise<void>) => {
    const previous = chains.current.get(localId) ?? Promise.resolve();
    chains.current.set(localId, previous.then(task).catch(() => setSyncError(true)));
  }, []);

  const appendMessage = useCallback(
    (conversationId: string, message: Message, title: string) => {
      setConversations((current) => {
        const existing = current.find((conversation) => conversation.id === conversationId);
        const updated: Conversation = existing
          ? { ...existing, messages: [...existing.messages, message], updatedAt: Date.now() }
          : { id: conversationId, title, messages: [message], updatedAt: Date.now(), loaded: true };
        const next = [updated, ...current.filter((conversation) => conversation.id !== conversationId)];
        if (!tenantId) writeLocal(next);
        return next;
      });
      if (!tenantId) return;
      enqueue(conversationId, async () => {
        let serverId = serverIds.current.get(conversationId) ?? (remoteIds.current.has(conversationId) ? conversationId : undefined);
        if (!serverId) {
          const created = await apiFetch<{ id: string }>("/api/v1/conversations", { body: { tenantId, title } });
          if (!created.ok) throw new Error("create_failed");
          serverId = created.data.id;
          serverIds.current.set(conversationId, serverId);
        }
        const stored = await apiFetch(`/api/v1/conversations/${serverId}/messages`, {
          body: { direction: message.role === "user" ? "in" : "out", senderKind: message.role === "user" ? "user" : "nex", body: message.text },
        });
        if (!stored.ok) throw new Error("append_failed");
      });
    },
    [tenantId, enqueue],
  );

  const remove = useCallback(
    (conversationId: string) => {
      setConversations((current) => {
        const next = current.filter((conversation) => conversation.id !== conversationId);
        if (!tenantId) writeLocal(next);
        return next;
      });
      setActiveId((current) => (current === conversationId ? null : current));
      if (!tenantId) return;
      enqueue(conversationId, async () => {
        const serverId = serverIds.current.get(conversationId) ?? (remoteIds.current.has(conversationId) ? conversationId : undefined);
        if (serverId) await apiFetch(`/api/v1/conversations/${serverId}`, { method: "DELETE" });
      });
    },
    [tenantId, enqueue],
  );

  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;

  return { conversations, active, activeId, setActiveId, appendMessage, remove, newId: newLocalId, syncError };
}
