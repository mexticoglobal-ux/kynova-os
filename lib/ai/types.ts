// The one interface every AI provider implements. An adapter turns a provider-neutral prompt into that provider's request, and its answer into a provider-neutral
// completion or stream, with errors reduced to a small set of kinds. It holds no secret (the key arrives with each call and is never stored), makes no decision
// (which provider, which model, retry and fallback belong to the AI Gateway) and knows nothing of companies, Workers or policies. Only lib/ai calls a provider.

/** What the model is asked. The system instructions stay apart from everything else (rules/ai.md 5). */
export type ProviderPrompt = { system: string; user: string };

export type Usage = { inputTokens: number; outputTokens: number };
export type Completion = { text: string; usage: Usage | null; finishReason: string | null };

/** A stream is deltas of text, the usage when the provider reports it, and a final marker. */
export type StreamEvent = { type: "delta"; text: string } | { type: "usage"; inputTokens?: number; outputTokens?: number } | { type: "done" };

export type AdapterCall = {
  /** The provider key for THIS call only. */
  key: string;
  /** The provider's own model name. */
  model: string;
  prompt: ProviderPrompt;
  maxOutputTokens: number;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
  /** Only for a provider that runs where we choose (a local one). */
  baseUrl?: string;
};

export interface ProviderAdapter {
  readonly id: string;
  readonly label: string;
  complete(call: AdapterCall): Promise<Completion>;
  stream(call: AdapterCall): AsyncGenerator<StreamEvent, void>;
}

/** What went wrong, reduced to what the Gateway needs to decide: retry, fall back, or stop. */
export const PROVIDER_ERROR_KINDS = ["notConfigured", "auth", "rateLimited", "timeout", "server", "network", "badRequest", "content", "parse"] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

/** The message never carries what the provider answered or what was asked: only the kind and the HTTP status. */
export class ProviderError extends Error {
  constructor(readonly kind: ProviderErrorKind, readonly status?: number) {
    super(status ? `${kind} (${status})` : kind);
    this.name = "ProviderError";
  }
}

/** The kinds a retry can fix. Everything else goes to the next provider. */
export const RETRYABLE_KINDS: readonly ProviderErrorKind[] = ["rateLimited", "timeout"];
