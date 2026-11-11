// The provider adapters. Every one implements the same interface (types.ts) and none holds a key, a decision or a company. OpenAI, OpenRouter, Grok, DeepSeek and Mistral
// speak the same chat protocol (one class, five configurations); Anthropic, Google Gemini and Ollama each have their own. Plain HTTP, no vendor SDK (rules/ai.md 1).

import { at, count, jsonLines, parseJson, postJson, readJson, sseEvents, text } from "./http";
import { ProviderError, type AdapterCall, type Completion, type ProviderAdapter, type StreamEvent, type Usage } from "./types";

const usageOf = (input: unknown, output: unknown): Usage | null => {
  const inputTokens = count(input);
  const outputTokens = count(output);
  return inputTokens === undefined && outputTokens === undefined ? null : { inputTokens: inputTokens ?? 0, outputTokens: outputTokens ?? 0 };
};

// ---------------------------------------------------------------- the common chat protocol (OpenAI and the providers that follow it)
export type ChatConfig = { id: string; label: string; baseUrl: string; /** OpenAI\x27s newer models take `max_completion_tokens`; the compatible ones take `max_tokens`. */ tokenField: "max_completion_tokens" | "max_tokens"; headers?: Record<string, string> };

export class ChatCompletionsAdapter implements ProviderAdapter {
  readonly id: string;
  readonly label: string;
  constructor(private readonly config: ChatConfig) {
    this.id = config.id;
    this.label = config.label;
  }

  private request(call: AdapterCall, stream: boolean) {
    const base = (call.baseUrl ?? this.config.baseUrl).replace(/\/$/, "");
    return {
      url: `${base}/chat/completions`,
      headers: { authorization: `Bearer ${call.key}`, ...this.config.headers },
      body: {
        model: call.model, [this.config.tokenField]: call.maxOutputTokens, stream,
        messages: [{ role: "system", content: call.prompt.system }, { role: "user", content: call.prompt.user }],
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      },
    };
  }

  async complete(call: AdapterCall): Promise<Completion> {
    const { url, headers, body } = this.request(call, false);
    const json = await readJson(await postJson(call.fetchImpl, url, headers, body, call.signal));
    const content = at(json, "choices", 0, "message", "content");
    if (typeof content !== "string") throw new ProviderError("parse");
    const finish = text(at(json, "choices", 0, "finish_reason"));
    if (finish === "content_filter") throw new ProviderError("content");
    return { text: content, usage: usageOf(at(json, "usage", "prompt_tokens"), at(json, "usage", "completion_tokens")), finishReason: finish || null };
  }

  async *stream(call: AdapterCall): AsyncGenerator<StreamEvent, void> {
    const { url, headers, body } = this.request(call, true);
    for await (const { data } of sseEvents(await postJson(call.fetchImpl, url, headers, body, call.signal))) {
      if (data.trim() === "[DONE]") break;
      const json = parseJson(data);
      const delta = at(json, "choices", 0, "delta", "content");
      if (typeof delta === "string" && delta !== "") yield { type: "delta", text: delta };
      if (text(at(json, "choices", 0, "finish_reason")) === "content_filter") throw new ProviderError("content");
      const usage = usageOf(at(json, "usage", "prompt_tokens"), at(json, "usage", "completion_tokens"));
      if (usage) yield { type: "usage", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    }
    yield { type: "done" };
  }
}

export const openaiAdapter = new ChatCompletionsAdapter({ id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", tokenField: "max_completion_tokens" });
export const openrouterAdapter = new ChatCompletionsAdapter({ id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", tokenField: "max_tokens", headers: { "x-title": "KYNOVA" } });
// prepared, not connected (providers.ts):
export const grokAdapter = new ChatCompletionsAdapter({ id: "grok", label: "Grok", baseUrl: "https://api.x.ai/v1", tokenField: "max_tokens" });
export const deepseekAdapter = new ChatCompletionsAdapter({ id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", tokenField: "max_tokens" });
export const mistralAdapter = new ChatCompletionsAdapter({ id: "mistral", label: "Mistral", baseUrl: "https://api.mistral.ai/v1", tokenField: "max_tokens" });

// ---------------------------------------------------------------- Anthropic
export const ANTHROPIC_VERSION = "2023-06-01";
export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "Anthropic",
  async complete(call) {
    const json = await readJson(await postJson(call.fetchImpl, "https://api.anthropic.com/v1/messages", { "x-api-key": call.key, "anthropic-version": ANTHROPIC_VERSION }, body(call, false), call.signal));
    const blocks = at(json, "content");
    if (!Array.isArray(blocks)) throw new ProviderError("parse");
    const reason = text(at(json, "stop_reason"));
    if (reason === "refusal") throw new ProviderError("content");
    return { text: blocks.map((block) => text(at(block, "text"))).join(""), usage: usageOf(at(json, "usage", "input_tokens"), at(json, "usage", "output_tokens")), finishReason: reason || null };
  },
  async *stream(call) {
    for await (const { data } of sseEvents(await postJson(call.fetchImpl, "https://api.anthropic.com/v1/messages", { "x-api-key": call.key, "anthropic-version": ANTHROPIC_VERSION }, body(call, true), call.signal))) {
      const json = parseJson(data);
      const type = text(at(json, "type"));
      if (type === "content_block_delta") {
        const delta = text(at(json, "delta", "text"));
        if (delta !== "") yield { type: "delta", text: delta };
      } else if (type === "message_start") {
        const input = count(at(json, "message", "usage", "input_tokens"));
        if (input !== undefined) yield { type: "usage", inputTokens: input };
      } else if (type === "message_delta") {
        const output = count(at(json, "usage", "output_tokens"));
        if (output !== undefined) yield { type: "usage", outputTokens: output };
        if (text(at(json, "delta", "stop_reason")) === "refusal") throw new ProviderError("content");
      } else if (type === "error") throw new ProviderError(text(at(json, "error", "type")) === "rate_limit_error" ? "rateLimited" : "server");
    }
    yield { type: "done" };
  },
};
function body(call: AdapterCall, stream: boolean) {
  return { model: call.model, max_tokens: call.maxOutputTokens, system: call.prompt.system, messages: [{ role: "user", content: call.prompt.user }], stream };
}

// ---------------------------------------------------------------- Google Gemini (the key travels in a header, never in the address)
const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";
const geminiBody = (call: AdapterCall) => ({
  systemInstruction: { parts: [{ text: call.prompt.system }] }, contents: [{ role: "user", parts: [{ text: call.prompt.user }] }], generationConfig: { maxOutputTokens: call.maxOutputTokens },
});
const geminiText = (json: unknown): string => {
  const parts = at(json, "candidates", 0, "content", "parts");
  return Array.isArray(parts) ? parts.map((part) => text(at(part, "text"))).join("") : "";
};
export const googleAdapter: ProviderAdapter = {
  id: "google",
  label: "Google Gemini",
  async complete(call) {
    const json = await readJson(await postJson(call.fetchImpl, `${GEMINI}/${encodeURIComponent(call.model)}:generateContent`, { "x-goog-api-key": call.key }, geminiBody(call), call.signal));
    if (text(at(json, "promptFeedback", "blockReason")) !== "" || text(at(json, "candidates", 0, "finishReason")) === "SAFETY") throw new ProviderError("content");
    if (!Array.isArray(at(json, "candidates"))) throw new ProviderError("parse");
    return { text: geminiText(json), usage: usageOf(at(json, "usageMetadata", "promptTokenCount"), at(json, "usageMetadata", "candidatesTokenCount")), finishReason: text(at(json, "candidates", 0, "finishReason")) || null };
  },
  async *stream(call) {
    const url = `${GEMINI}/${encodeURIComponent(call.model)}:streamGenerateContent?alt=sse`;
    for await (const { data } of sseEvents(await postJson(call.fetchImpl, url, { "x-goog-api-key": call.key }, geminiBody(call), call.signal))) {
      const json = parseJson(data);
      if (text(at(json, "candidates", 0, "finishReason")) === "SAFETY") throw new ProviderError("content");
      const delta = geminiText(json);
      if (delta !== "") yield { type: "delta", text: delta };
      const usage = usageOf(at(json, "usageMetadata", "promptTokenCount"), at(json, "usageMetadata", "candidatesTokenCount"));
      if (usage) yield { type: "usage", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    }
    yield { type: "done" };
  },
};

// ---------------------------------------------------------------- Ollama (a model that runs where we choose; there is no key, only a base address)
export const ollamaAdapter: ProviderAdapter = {
  id: "local",
  label: "Ollama",
  async complete(call) {
    const json = await readJson(await postJson(call.fetchImpl, `${ollamaBase(call)}/api/chat`, {}, ollamaBody(call, false), call.signal));
    const content = at(json, "message", "content");
    if (typeof content !== "string") throw new ProviderError("parse");
    return { text: content, usage: usageOf(at(json, "prompt_eval_count"), at(json, "eval_count")), finishReason: text(at(json, "done_reason")) || null };
  },
  async *stream(call) {
    for await (const item of jsonLines(await postJson(call.fetchImpl, `${ollamaBase(call)}/api/chat`, {}, ollamaBody(call, true), call.signal))) {
      const delta = text(at(item, "message", "content"));
      if (delta !== "") yield { type: "delta", text: delta };
      if (at(item, "done") === true) {
        const usage = usageOf(at(item, "prompt_eval_count"), at(item, "eval_count"));
        if (usage) yield { type: "usage", inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
      }
    }
    yield { type: "done" };
  },
};
const ollamaBase = (call: AdapterCall) => (call.baseUrl ?? "http://127.0.0.1:11434").replace(/\/$/, "");
const ollamaBody = (call: AdapterCall, stream: boolean) => ({
  model: call.model, stream, options: { num_predict: call.maxOutputTokens }, messages: [{ role: "system", content: call.prompt.system }, { role: "user", content: call.prompt.user }],
});
