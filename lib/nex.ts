import type { Messages } from "@/lib/i18n/messages";
import type { Message } from "@/types";

type NexCopy = Messages["nex"];
export type NexIntent = keyof NexCopy["responses"];

const THINKING_DELAY_MS = 900;

// Most specific intents first: "draft a follow-up email" is an email request, not a leads question.
const INTENT_PRIORITY: ReadonlyArray<keyof NexCopy["keywords"]> = [
  "email",
  "campaign",
  "properties",
  "clients",
  "cashflow",
  "marketing",
  "revenue",
  "leads",
];

// Simulated assistant until NEX is connected to Workers AI through lib/ai (ADR-0002, rule ai.md).
export function detectIntent(prompt: string, keywords: NexCopy["keywords"]): NexIntent {
  const text = prompt.toLocaleLowerCase();
  const match = INTENT_PRIORITY.find((intent) => keywords[intent].some((word) => text.includes(word.toLocaleLowerCase())));
  return match ?? "fallback";
}

export function simulateNexReply(prompt: string, copy: NexCopy): string {
  return copy.responses[detectIntent(prompt, copy.keywords)];
}

export async function askNex(history: readonly Message[], copy: NexCopy): Promise<string> {
  const lastUserMessage = [...history].reverse().find((message) => message.role === "user");
  await new Promise((resolve) => setTimeout(resolve, THINKING_DELAY_MS));
  return simulateNexReply(lastUserMessage?.text ?? "", copy);
}
