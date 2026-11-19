// The contract of NEX's first-work draft (prompt nex.nex.first-work-draft): what goes in (two short phrases of the person and the company), what a model may
// answer, and what the route returns. Shared by the route, the rules fallback and the prompt's evals. The model's answer is validated here (rules/ai.md 7): it is
// never shown or kept unless it passes, and it can only say what the person said.

import { isUuid } from "@/lib/contracts/tenancy";

export const DRAFT_PHRASE_MAX = 160;
export const DRAFT_LIMITS = { message: 700, presentation: 1_200 } as const;

export type FirstWorkDraftInput = { tenantId: string; offer: string; audience: string };
export type FirstWorkDraft = { message: string; presentation: string };

/** Who wrote the draft: the rules of KYNOVA or a model. */
export type DraftSource = "rules" | "model";
/** Why the rules wrote it when a model could have: always one of these, never silent. */
export type FallbackReason = "disabled" | "not_configured" | "budget_unavailable" | "provider_error" | "invalid_output";
export type FirstWorkDraftResult = {
  source: DraftSource;
  /** null when a model wrote it; otherwise why the rules did */ reason: FallbackReason | null;
  draft: FirstWorkDraft;
  /** what the person has not said yet: the draft leaves it as [completar: …] */ needsContext: readonly string[];
  /** the sentence the screen shows about who wrote it */ label: string;
};

const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
/** One phrase as the person typed it: no control characters, trimmed; null when it is not text or is too long. */
function phrase(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL, "").replace(/\s+/g, " ").trim();
  return text.length > DRAFT_PHRASE_MAX ? null : text;
}

/** The request body: a company id and two optional short phrases. Anything else is refused. */
export function parseDraftInput(value: unknown): FirstWorkDraftInput | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const offer = phrase(record.offer);
  const audience = phrase(record.audience);
  return isUuid(record.tenantId) && offer !== null && audience !== null ? { tenantId: record.tenantId, offer, audience } : null;
}

/** The phrase without the trailing dots and spaces the draft adds its own to (the same way the rules fallback uses it). */
export const cleanPhrase = (value: string): string => value.trim().replace(/[.\s]+$/, "");

const norm = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ");
const FOREIGN: readonly RegExp[] = [/https?:\/\/\S+|www\.\S+/gi, /[^\s@]+@[^\s@]+\.[^\s@]+/g, /\+?\d[\d\s().-]{6,}\d/g, /\d+\s?%/g];
const PROMISES = /garantiz|sin riesgo|resultados (asegurados|seguros)|100 ?%/i;

/**
 * A model's answer, or null when it must not be used. It has to be a JSON object with exactly `message` and `presentation`, within the limits, free of control
 * characters, and it may only say what the person said: each phrase they gave appears as typed in both pieces, a phrase they did not give is left as the
 * [completar: …] placeholder, and no link, address, number, percentage or promise appears that is not in their own words.
 */
export function parseDraftOutput(text: string, input: { offer: string; audience: string }): FirstWorkDraft | null {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 2 || keys[0] !== "message" || keys[1] !== "presentation") return null;
  if (typeof record.message !== "string" || typeof record.presentation !== "string") return null;
  const message = record.message.replace(CONTROL, "").replace(/\r\n/g, "\n").trim();
  const presentation = record.presentation.replace(CONTROL, "").replace(/\r\n/g, "\n").trim();
  if (message.length === 0 || message.length > DRAFT_LIMITS.message || presentation.length === 0 || presentation.length > DRAFT_LIMITS.presentation) return null;

  const given = [cleanPhrase(input.offer), cleanPhrase(input.audience)];
  const own = norm(given.join(" "));
  for (const piece of [message, presentation]) {
    const lower = norm(piece);
    // only what the person said: every phrase they gave, as typed
    if (given.some((one) => one !== "" && !lower.includes(norm(one)))) return null;
    // nothing invented: no link, address, number or percentage of their own, and no promise
    for (const pattern of FOREIGN) if ((piece.match(pattern) ?? []).some((hit) => !own.includes(norm(hit.replace(/[.,;:!?)\]]+$/, ""))))) return null;
    if (PROMISES.test(piece) && !PROMISES.test(own)) return null;
  }
  // what they did not give stays visibly open
  const needs = [given[0] === "" ? "[completar: qué ofrece su empresa" : "", given[1] === "" ? "[completar: a quién se dirige" : ""].filter(Boolean);
  if (needs.some((marker) => !message.includes(marker) || !presentation.includes(marker))) return null;
  return { message, presentation };
}
