"use client";

import { useCallback, useEffect, useState } from "react";
import type { Message } from "@/types";

export type Conversation = { id: string; title: string; messages: Message[]; updatedAt: number };

const STORAGE_KEY = "kynova.nex.conversations";
const MAX_CONVERSATIONS = 30;

function isConversation(value: unknown): value is Conversation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Conversation>;
  return typeof candidate.id === "string" && typeof candidate.title === "string" && Array.isArray(candidate.messages);
}

function readConversations(): Conversation[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isConversation) : [];
  } catch {
    return [];
  }
}

function writeConversations(conversations: Conversation[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)));
  } catch {
    // Storage unavailable: history lives only for this visit.
  }
}

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
}

export function useConversations() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    setConversations(readConversations());
  }, []);

  const update = useCallback((updater: (current: Conversation[]) => Conversation[]) => {
    setConversations((current) => {
      const next = updater(current);
      writeConversations(next);
      return next;
    });
  }, []);

  const appendMessage = useCallback(
    (conversationId: string, message: Message, title: string) => {
      update((current) => {
        const existing = current.find((conversation) => conversation.id === conversationId);
        const updated: Conversation = existing
          ? { ...existing, messages: [...existing.messages, message], updatedAt: Date.now() }
          : { id: conversationId, title, messages: [message], updatedAt: Date.now() };
        return [updated, ...current.filter((conversation) => conversation.id !== conversationId)];
      });
    },
    [update],
  );

  const remove = useCallback(
    (conversationId: string) => {
      update((current) => current.filter((conversation) => conversation.id !== conversationId));
      setActiveId((current) => (current === conversationId ? null : current));
    },
    [update],
  );

  const active = conversations.find((conversation) => conversation.id === activeId) ?? null;

  return { conversations, active, activeId, setActiveId, appendMessage, remove, newId };
}
