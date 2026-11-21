// A CONSERVATIVE bound on the input tokens of a chat request to an OpenAI-compatible provider (gpt-4o-mini). It is NOT a maximum guaranteed by the provider: the provider offers no
// way to cap the input, and says that the way it counts message tokens "may change" (see the sources below). It is a bound DERIVED from two things, each with its limit:
//
//  1. The CONTENT. gpt-4o-mini uses the o200k_base encoding (OpenAI cookbook, "How to count tokens with tiktoken", table of encodings). That is a byte-level BPE: every single byte
//     is itself a token, so a text never takes more tokens than it has UTF-8 bytes. This is a property of the encoding's design; it has NOT been checked here against the encoding's
//     vocabulary file (nothing was downloaded), and it holds only for OpenAI's own encodings, not for other providers' tokenizers.
//  2. The FORMAT. The same cookbook page counts 3 tokens per message and 3 to prime the reply for gpt-4o-mini-2024-07-18 (so 3 + 3 + 3 = 9 for a system and a user message). The page
//     is archived, shows no date and calls its result "an estimate, not a timeless guarantee". We use 12 (a margin of 3), which is still a choice of ours, not a provider constant.
//
// It covers exactly what `ChatCompletionsAdapter` puts in `messages` (the system and the user text, nothing else: no tools, no functions, no name field). It does NOT cover what any
// other adapter sends (Anthropic, Gemini and Ollama build different bodies), so the guard is only meaningful for the OpenAI-compatible adapters.
//
// What really limits the cost is therefore (a) this bound, used for the reservation and as a refusal rule, and (b) the provider's own usage report after the call: the budget settles
// the REAL tokens, and a call that cost more than was reserved is recorded as overage (never hidden). The only limit the provider itself enforces is the output one
// (`max_completion_tokens`, sent by the adapter).

import type { ProviderPrompt } from "./types";

/** 3 per message x 2 messages + 3 to prime the reply = 9 (OpenAI cookbook, gpt-4o-mini-2024-07-18), plus a margin of 3 of our own. */
export const CHAT_FORMAT_OVERHEAD_TOKENS = 12;

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** The conservative bound (see the top of the file) on the input tokens of the two messages the OpenAI-compatible adapter sends. */
export function chatInputTokenBound(prompt: ProviderPrompt): number {
  return utf8Bytes(prompt.system) + utf8Bytes(prompt.user) + CHAT_FORMAT_OVERHEAD_TOKENS;
}
