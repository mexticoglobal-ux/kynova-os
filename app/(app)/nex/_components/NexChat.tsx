"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, m as motion } from "framer-motion";
import { Bot, Building2, ClipboardList, History, Lightbulb, Mail, Megaphone, MessageSquarePlus, Receipt, SendHorizontal, Sparkles, Trash2 } from "lucide-react";
import { askNex } from "@/lib/nex";
import type { Message } from "@/types";
import { useI18n } from "@/components/i18n/I18nProvider";
import { AssessmentFlow } from "./AssessmentFlow";
import { useConversations } from "./useConversations";

const QUICK_ACTION_ICONS = [Mail, Megaphone, Receipt, Building2];

export function NexChat() {
  const { m } = useI18n();
  const { conversations, active, activeId, setActiveId, appendMessage, remove, newId } = useConversations();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = active?.messages ?? [];

  useEffect(() => {
    // The empty state must stay scrolled to the top so its title is visible.
    if (messages.length === 0 && !busy) return;
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    // activeId: opening another conversation from the history must also land on its latest message.
  }, [activeId, messages.length, busy]);

  async function send(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    const conversationId = activeId ?? newId();
    const userMessage: Message = { role: "user", text: trimmed };
    setActiveId(conversationId);
    appendMessage(conversationId, userMessage, trimmed.slice(0, 48));
    setText("");
    setFailed(false);
    setBusy(true);
    try {
      const reply = await askNex([...messages, userMessage], m.nex);
      appendMessage(conversationId, { role: "nex", text: reply }, trimmed.slice(0, 48));
    } catch {
      // No invented answer: show an error and give the prompt back so the user can retry.
      setFailed(true);
      setText(trimmed);
    } finally {
      setBusy(false);
    }
  }

  function startNew() {
    setActiveId(null);
    setFailed(false);
    setAssessing(false);
    setShowHistory(false);
  }

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[32rem] gap-4">
      <aside
        className={clsx(
          "glass w-64 shrink-0 flex-col p-4",
          showHistory ? "fixed inset-x-4 top-20 z-40 flex max-h-[70vh] w-auto lg:static lg:max-h-none lg:w-64" : "hidden lg:flex",
        )}
      >
        <button
          type="button"
          onClick={startNew}
          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-sm font-medium transition hover:bg-primary/90"
        >
          <MessageSquarePlus aria-hidden className="h-4 w-4" />
          {m.nex.newChat}
        </button>
        <h2 className="mt-5 text-xs font-medium uppercase tracking-wide text-zinc-400">{m.nex.history}</h2>
        <ul className="mt-2 flex-1 space-y-1 overflow-y-auto text-sm">
          {conversations.length === 0 && <li className="px-2 py-2 text-zinc-400">{m.nex.noHistory}</li>}
          {conversations.map((conversation) => (
            <li key={conversation.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setActiveId(conversation.id);
                  setFailed(false);
                  setShowHistory(false);
                }}
                className={clsx(
                  "min-w-0 flex-1 truncate rounded-lg px-2 py-2 text-left transition",
                  conversation.id === activeId ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white",
                )}
              >
                {conversation.title || m.nex.untitled}
              </button>
              <button
                type="button"
                onClick={() => remove(conversation.id)}
                aria-label={m.nex.deleteChat}
                className="rounded-lg p-1.5 text-zinc-400 opacity-100 transition hover:bg-white/5 hover:text-danger lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
              >
                <Trash2 aria-hidden className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="glass flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
              <Bot aria-hidden className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate font-medium">{m.nav.nex}</h1>
              <p className="truncate text-xs text-zinc-400">{m.nex.subtitle}</p>
            </div>
          </div>
          <div className="flex gap-1 lg:hidden">
            <button
              type="button"
              onClick={() => setShowHistory((value) => !value)}
              aria-label={m.nex.history}
              aria-expanded={showHistory}
              className="rounded-xl p-2 text-zinc-300 hover:bg-white/5"
            >
              <History aria-hidden className="h-4 w-4" />
            </button>
            <button type="button" onClick={startNew} aria-label={m.nex.newChat} className="rounded-xl p-2 text-zinc-300 hover:bg-white/5">
              <MessageSquarePlus aria-hidden className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div data-nex-scroll className="flex-1 overflow-y-auto px-4 py-6" aria-live="polite">
          {messages.length === 0 && assessing ? (
            <AssessmentFlow onExit={() => setAssessing(false)} />
          ) : messages.length === 0 ? (
            <div className="mx-auto max-w-2xl">
              <h2 className="text-center text-2xl font-semibold sm:text-3xl">{m.nex.title}</h2>
              <h3 className="mt-8 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                <Sparkles aria-hidden className="h-3.5 w-3.5" />
                {m.nex.suggestions}
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {m.nex.suggestionItems.map((item) => (
                  <button key={item} type="button" onClick={() => void send(item)} className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm transition hover:bg-white/10">
                    {item}
                  </button>
                ))}
              </div>
              <h3 className="mt-8 text-xs font-medium uppercase tracking-wide text-zinc-400">{m.nex.quickActions}</h3>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <button type="button" onClick={() => setAssessing(true)} className="flex items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 p-3 text-left text-sm transition hover:bg-primary/15">
                  <ClipboardList aria-hidden className="h-4 w-4 shrink-0 text-primary" />
                  {m.nex.assessment.start}
                </button>
                {m.nex.quickActionItems.map((item, index) => {
                  const Icon = QUICK_ACTION_ICONS[index] ?? Sparkles;
                  return (
                    <button key={item} type="button" onClick={() => void send(item)} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-left text-sm transition hover:border-primary/40 hover:bg-white/5">
                      <Icon aria-hidden className="h-4 w-4 shrink-0 text-primary" />
                      {item}
                    </button>
                  );
                })}
              </div>
              <h3 className="mt-8 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                <Lightbulb aria-hidden className="h-3.5 w-3.5" />
                {m.nex.examples}
              </h3>
              <ul className="mt-3 space-y-1">
                {m.nex.exampleItems.map((item) => (
                  <li key={item}>
                    <button type="button" onClick={() => void send(item)} className="text-left text-sm text-zinc-400 underline-offset-4 hover:text-white hover:underline">
                      “{item}”
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {messages.map((message, index) => (
                <motion.div
                  key={`${index}-${message.role}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={clsx(
                    "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed",
                    message.role === "user" ? "ml-auto bg-primary" : "border border-white/10 bg-white/[0.04]",
                  )}
                >
                  <span className="sr-only">{message.role === "user" ? m.nex.you : m.nav.nex}: </span>
                  {message.role === "nex" && (
                    <span data-simulated-notice className="mb-2 flex w-fit items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-400">
                      <Sparkles aria-hidden className="h-3.5 w-3.5 text-primary" />
                      {m.nex.simulatedReply}
                      <span className="sr-only">. </span>
                    </span>
                  )}
                  {message.text}
                </motion.div>
              ))}
              <AnimatePresence>
                {busy && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-zinc-400">
                    <span className="flex gap-1" aria-hidden>
                      {[0, 1, 2].map((dot) => (
                        <motion.span key={dot} className="h-1.5 w-1.5 rounded-full bg-zinc-400" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: dot * 0.2 }} />
                      ))}
                    </span>
                    {m.nex.thinking}
                  </motion.div>
                )}
              </AnimatePresence>
              {failed && (
                <p role="alert" className="max-w-[85%] rounded-2xl border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger-soft">
                  {m.nex.error}
                </p>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(text);
          }}
          className="border-t border-white/5 p-3"
        >
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5 focus-within:border-primary/50">
            <label htmlFor="nex-input" className="sr-only">
              {m.nex.placeholder}
            </label>
            <input
              id="nex-input"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={m.nex.placeholder}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-zinc-400"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              aria-label={m.nex.send}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary transition hover:bg-primary/90 disabled:opacity-40"
            >
              <SendHorizontal aria-hidden className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-center text-xs text-zinc-400">{m.nex.disclaimer}</p>
        </form>
      </section>
    </div>
  );
}
