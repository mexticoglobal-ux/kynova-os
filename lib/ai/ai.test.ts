/* eslint-disable @typescript-eslint/no-non-null-assertion -- test fixtures: a missing record must fail the test loudly */
import { describe, expect, it } from "vitest";
import { BRIDGES } from "@/lib/backend/integration/bridges";
import { MemorySecretsProvider, SecretsManager } from "@/lib/backend/secrets";
import { MODEL_REGISTRY } from "@/lib/contracts/platform/ai-model-registry";
import { GATEWAY_LIMIT_DEFAULTS } from "@/lib/contracts/platform/ai-limits";
import { GATEWAY_PROVIDERS, MODEL_PROVIDER } from "@/lib/contracts/platform/gateway-catalog";
import { newGatewayState, reduceGateway } from "@/lib/contracts/platform/gateway-center";
import type { BreakerRecord, GatewayRequest } from "@/lib/contracts/platform/gateway-engine";
import { newAiState, reduceAi, type AiEvent, type AiState } from "@/lib/contracts/platform/koe-ai-center";
import {
  ANTHROPIC_VERSION, anthropicAdapter, deepseekAdapter, googleAdapter, grokAdapter, mistralAdapter, ollamaAdapter, openaiAdapter, openrouterAdapter,
} from "./adapters";
import { executeChain, executeStream, outcomeOfKind, sanitizeAnswer, type ExecutorDeps } from "./executor";
import { AI_CONFIG_NAMES, AI_SECRET_NAMES, aiSecrets, providerReadiness } from "./secrets";
import { askAi, askAiStream, providerPrompt, type AskEvent } from "./service";
import { CONNECTED_PROVIDERS, NATIVE_MODELS, PREPARED_PROVIDERS, PROVIDER_REGISTRY, costOfNative, type ProviderConfig } from "./providers";
import { ProviderError, type AdapterCall, type Completion, type ProviderAdapter, type StreamEvent } from "./types";

// Keys are built here, at run time, so no credential is ever a literal in the code.
const key = (name: string) => `${name.toLowerCase()}-${"k".repeat(24)}`;
const KEYS: Record<string, string> = Object.fromEntries(AI_SECRET_NAMES.map((name) => [name, key(name)]));
const NOVA = "tenant-nova";
const AT = "2026-11-10T12:00:00.000Z";

// ---------------------------------------------------------------- a fetch that never leaves the process
type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const events = (items: string[]) => new Response(items.join(""), { status: 200, headers: { "content-type": "text/event-stream" } });
function mockFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = { url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fn, calls };
}
const adapterCall = (fetchImpl: typeof fetch, over: Partial<AdapterCall> = {}): AdapterCall => ({
  key: "the-key-of-this-call", model: "native-model", prompt: { system: "SYSTEM RULES", user: "USER WORDS" }, maxOutputTokens: 50, signal: new AbortController().signal, fetchImpl, ...over,
});
const drain = async (stream: AsyncGenerator<StreamEvent, void>): Promise<StreamEvent[]> => { const out: StreamEvent[] = []; for await (const item of stream) out.push(item); return out; };

const chatReply = (text: string, usage = { prompt_tokens: 12, completion_tokens: 7 }) => ({ choices: [{ message: { content: text }, finish_reason: "stop" }], usage });
const chatSse = (...deltas: string[]) => events([...deltas.map((delta) => `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`), `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } })}\n\n`, "data: [DONE]\n\n"]);

// ================================================================ the adapters
describe("every provider adapter implements the same interface", () => {
  const ALL: ProviderAdapter[] = [openaiAdapter, anthropicAdapter, googleAdapter, openrouterAdapter, grokAdapter, deepseekAdapter, mistralAdapter, ollamaAdapter];

  it("has an id, a label, a completion and a stream, and its id is one the Gateway knows", () => {
    for (const adapter of ALL) {
      expect(typeof adapter.id, adapter.id).toBe("string");
      expect(adapter.label.length).toBeGreaterThan(2);
      expect(typeof adapter.complete).toBe("function");
      expect(typeof adapter.stream).toBe("function");
      expect(GATEWAY_PROVIDERS.some((provider) => provider.id === adapter.id), adapter.id).toBe(true);
    }
    expect(new Set(ALL.map((adapter) => adapter.id)).size).toBe(ALL.length);
  });

  it("OpenAI: sends the key as a bearer token, never in the address, and reads the text and the provider's own token count", async () => {
    const { fn, calls } = mockFetch(() => reply(chatReply("hola")));
    const completion = await openaiAdapter.complete(adapterCall(fn));
    expect(completion).toEqual({ text: "hola", usage: { inputTokens: 12, outputTokens: 7 }, finishReason: "stop" });
    const call = calls[0]!;
    expect(call.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call.headers["authorization"]).toBe("Bearer the-key-of-this-call");
    expect(call.url).not.toContain("the-key-of-this-call");
    expect(call.body).toMatchObject({ model: "native-model", max_completion_tokens: 50, stream: false, messages: [{ role: "system", content: "SYSTEM RULES" }, { role: "user", content: "USER WORDS" }] });
    expect(JSON.stringify(call.body)).not.toContain("the-key-of-this-call");
  });

  it("OpenAI and the providers that follow its protocol: the stream gives deltas, then the usage, then the end", async () => {
    const { fn, calls } = mockFetch(() => chatSse("Ho", "la"));
    const parts = await drain(openaiAdapter.stream(adapterCall(fn)));
    expect(parts).toEqual([{ type: "delta", text: "Ho" }, { type: "delta", text: "la" }, { type: "usage", inputTokens: 12, outputTokens: 7 }, { type: "done" }]);
    expect(calls[0]!.body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it("OpenRouter, Grok, DeepSeek and Mistral use the same protocol with their own address and token field", async () => {
    const seen: Record<string, Call> = {};
    for (const adapter of [openrouterAdapter, grokAdapter, deepseekAdapter, mistralAdapter]) {
      const { fn, calls } = mockFetch(() => reply(chatReply("ok")));
      await adapter.complete(adapterCall(fn));
      seen[adapter.id] = calls[0]!;
    }
    expect(seen["openrouter"]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(seen["grok"]!.url).toBe("https://api.x.ai/v1/chat/completions");
    expect(seen["deepseek"]!.url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(seen["mistral"]!.url).toBe("https://api.mistral.ai/v1/chat/completions");
    for (const call of Object.values(seen)) { expect(call.body).toMatchObject({ max_tokens: 50 }); expect(call.body).not.toHaveProperty("max_completion_tokens"); }
    expect(seen["openrouter"]!.headers["x-title"]).toBe("KYNOVA");
  });

  it("Anthropic: the key in its own header, the instructions apart from the user's words, the text and the usage", async () => {
    const { fn, calls } = mockFetch(() => reply({ content: [{ type: "text", text: "hola " }, { type: "text", text: "mundo" }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 4 } }));
    expect(await anthropicAdapter.complete(adapterCall(fn))).toEqual({ text: "hola mundo", usage: { inputTokens: 20, outputTokens: 4 }, finishReason: "end_turn" });
    const call = calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.headers).toMatchObject({ "x-api-key": "the-key-of-this-call", "anthropic-version": ANTHROPIC_VERSION });
    expect(call.body).toMatchObject({ model: "native-model", max_tokens: 50, system: "SYSTEM RULES", messages: [{ role: "user", content: "USER WORDS" }] });
  });

  it("Anthropic: streams the text and reports the input and output tokens as they arrive", async () => {
    const sse = events([
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 21 } } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Ho" } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "la" } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`,
    ]);
    const parts = await drain(anthropicAdapter.stream(adapterCall(mockFetch(() => sse).fn)));
    expect(parts.filter((item) => item.type === "delta").map((item) => (item as { text: string }).text).join("")).toBe("Hola");
    expect(parts).toContainEqual({ type: "usage", inputTokens: 21 });
    expect(parts).toContainEqual({ type: "usage", outputTokens: 9 });
    expect(parts.at(-1)).toEqual({ type: "done" });
  });

  it("Google Gemini: the key in a header and not in the address, the system instruction apart, the text and the usage", async () => {
    const { fn, calls } = mockFetch(() => reply({ candidates: [{ content: { parts: [{ text: "hola" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 8 } }));
    expect(await googleAdapter.complete(adapterCall(fn, { model: "gemini-test/model" }))).toEqual({ text: "hola", usage: { inputTokens: 30, outputTokens: 8 }, finishReason: "STOP" });
    const call = calls[0]!;
    expect(call.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test%2Fmodel:generateContent");
    expect(call.headers["x-goog-api-key"]).toBe("the-key-of-this-call");
    expect(call.url).not.toContain("the-key-of-this-call");
    expect(call.body).toMatchObject({ systemInstruction: { parts: [{ text: "SYSTEM RULES" }] }, contents: [{ role: "user", parts: [{ text: "USER WORDS" }] }], generationConfig: { maxOutputTokens: 50 } });
  });

  it("Google Gemini: streams with ?alt=sse and refuses a safety block as a content error", async () => {
    const chunk = (text: string, usage?: boolean) => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], ...(usage ? { usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } } : {}) })}\n\n`;
    const { fn, calls } = mockFetch(() => events([chunk("Ho"), chunk("la", true)]));
    const parts = await drain(googleAdapter.stream(adapterCall(fn)));
    expect(calls[0]!.url).toContain(":streamGenerateContent?alt=sse");
    expect(parts).toEqual([{ type: "delta", text: "Ho" }, { type: "delta", text: "la" }, { type: "usage", inputTokens: 5, outputTokens: 2 }, { type: "done" }]);
    const blocked = mockFetch(() => reply({ candidates: [{ finishReason: "SAFETY" }] }));
    await expect(googleAdapter.complete(adapterCall(blocked.fn))).rejects.toMatchObject({ kind: "content" });
  });

  it("Ollama: needs no key, goes to the address it is given, and streams newline-delimited JSON", async () => {
    const { fn, calls } = mockFetch(() => reply({ message: { content: "hola" }, prompt_eval_count: 9, eval_count: 3, done_reason: "stop" }));
    expect(await ollamaAdapter.complete(adapterCall(fn, { baseUrl: "http://gpu.local:11434/" }))).toEqual({ text: "hola", usage: { inputTokens: 9, outputTokens: 3 }, finishReason: "stop" });
    expect(calls[0]!.url).toBe("http://gpu.local:11434/api/chat");
    expect(calls[0]!.headers["authorization"]).toBeUndefined();
    const lines = new Response([JSON.stringify({ message: { content: "Ho" }, done: false }), JSON.stringify({ message: { content: "la" }, done: false }), JSON.stringify({ message: { content: "" }, done: true, prompt_eval_count: 4, eval_count: 2 })].join("\n"));
    expect(await drain(ollamaAdapter.stream(adapterCall(mockFetch(() => lines).fn)))).toEqual([{ type: "delta", text: "Ho" }, { type: "delta", text: "la" }, { type: "usage", inputTokens: 4, outputTokens: 2 }, { type: "done" }]);
    expect((await mockFetch(() => reply({}))).calls.length).toBe(0);
  });

  it("reduces every failure to a kind and never puts the key, the prompt or the provider's words into the error", async () => {
    const kind = async (status: number) => (await openaiAdapter.complete(adapterCall(mockFetch(() => reply({ error: { message: "the-key-of-this-call and USER WORDS" } }, status)).fn)).catch((error: unknown) => error)) as ProviderError;
    expect(await kind(429)).toMatchObject({ kind: "rateLimited", status: 429 });
    expect(await kind(401)).toMatchObject({ kind: "auth" });
    expect(await kind(403)).toMatchObject({ kind: "auth" });
    expect(await kind(408)).toMatchObject({ kind: "timeout" });
    expect(await kind(500)).toMatchObject({ kind: "server" });
    expect(await kind(503)).toMatchObject({ kind: "server" });
    expect(await kind(400)).toMatchObject({ kind: "badRequest" });
    for (const status of [400, 401, 429, 500]) expect((await kind(status)).message).not.toMatch(/the-key|USER WORDS/);
    const down = (await openaiAdapter.complete(adapterCall((async () => { throw new TypeError("fetch failed: the-key-of-this-call"); }) as typeof fetch)).catch((error: unknown) => error)) as ProviderError;
    expect(down).toMatchObject({ kind: "network" });
    expect(down.message).not.toContain("the-key");
    const controller = new AbortController();
    controller.abort();
    const aborted = (await openaiAdapter.complete(adapterCall((async () => { throw new DOMException("aborted", "AbortError"); }) as typeof fetch, { signal: controller.signal })).catch((error: unknown) => error)) as ProviderError;
    expect(aborted.kind).toBe("timeout");
    await expect(openaiAdapter.complete(adapterCall(mockFetch(() => new Response("not json", { status: 200 })).fn))).rejects.toMatchObject({ kind: "parse" });
    await expect(openaiAdapter.complete(adapterCall(mockFetch(() => reply({ choices: [{ message: { content: "x" }, finish_reason: "content_filter" }] })).fn))).rejects.toMatchObject({ kind: "content" });
    expect(outcomeOfKind("rateLimited")).toBe("rateLimited");
    expect(outcomeOfKind("timeout")).toBe("timeout");
    expect(outcomeOfKind("auth")).toBe("down");
  });
});

// ================================================================ the configuration of lib/ai
describe("the provider registry", () => {
  it("connects OpenAI, Anthropic, Google Gemini and OpenRouter, and only prepares Grok, DeepSeek, Mistral and Ollama", () => {
    expect([...CONNECTED_PROVIDERS].sort()).toEqual(["anthropic", "google", "openai", "openrouter"]);
    expect([...PREPARED_PROVIDERS].sort()).toEqual(["deepseek", "grok", "local", "mistral"]);
    for (const [id, config] of Object.entries(PROVIDER_REGISTRY)) expect(config.adapter.id, id).toBe(id);
  });

  it("serves every internal model of the registry with a provider-native model, through the provider the Gateway maps it to, with a price", () => {
    for (const model of MODEL_REGISTRY) {
      const native = NATIVE_MODELS[model.id]!;
      expect(native, model.id).toBeDefined();
      expect(native.provider, model.id).toBe(MODEL_PROVIDER[model.id]);
      expect(PROVIDER_REGISTRY[native.provider], model.id).toBeDefined();
      expect(native.inputMicrosPerM).toBeGreaterThanOrEqual(0);
    }
    expect(NATIVE_MODELS["gw-embed-1"]!.chat).toBe(false);
    for (const provider of GATEWAY_PROVIDERS) expect(PROVIDER_REGISTRY[provider.id], provider.id).toBeDefined();
  });

  it("works out the cost from the tokens the provider counted", () => {
    const model = NATIVE_MODELS["gw-fast-1"]!;
    expect(costOfNative(model, 1_000_000, 0)).toBe(model.inputMicrosPerM);
    expect(costOfNative(model, 0, 1_000_000)).toBe(model.outputMicrosPerM);
    expect(costOfNative(model, 120, 33)).toBe(Math.ceil((120 * model.inputMicrosPerM + 33 * model.outputMicrosPerM) / 1_000_000));
    expect(costOfNative(NATIVE_MODELS["gw-local-1"]!, 5_000, 5_000)).toBe(0);
  });
});

describe("the secrets of the providers", () => {
  it("name one secret per provider that needs one, and the address of the local model apart", () => {
    expect([...AI_SECRET_NAMES].sort()).toEqual(["ANTHROPIC_API_KEY", "DEEPSEEK_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "XAI_API_KEY"]);
    expect([...AI_CONFIG_NAMES]).toEqual(["OLLAMA_BASE_URL"]);
  });

  it("are read only through the Secrets Manager's allow-list, and the readiness names them without showing a value", () => {
    const secrets = aiSecrets({ ...KEYS, UNRELATED_SECRET: "x".repeat(30), OLLAMA_BASE_URL: "http://127.0.0.1:11434" });
    expect(secrets.has("OPENAI_API_KEY")).toBe(true);
    expect(secrets.has("UNRELATED_SECRET")).toBe(false);
    const readiness = providerReadiness(secrets);
    expect(readiness.find((item) => item.providerId === "openai")).toMatchObject({ connected: true, configured: true, usable: true, needs: "OPENAI_API_KEY" });
    expect(readiness.find((item) => item.providerId === "grok")).toMatchObject({ connected: false, configured: true, usable: false });
    expect(readiness.find((item) => item.providerId === "local")).toMatchObject({ connected: false, usable: false });
    expect(JSON.stringify(readiness)).not.toContain("k".repeat(24));
    expect(providerReadiness(aiSecrets({})).filter((item) => item.usable)).toEqual([]);
  });
});

// ================================================================ the executor
function fakeAdapter(id: string, script: (string | { kind: string })[] = [], text = "respuesta") {
  const state = { calls: 0, keys: [] as string[], bases: [] as (string | undefined)[] };
  const next = (): string => { const item = script.shift() ?? "ok"; return typeof item === "string" ? item : item.kind; };
  const adapter: ProviderAdapter = {
    id, label: id,
    async complete(call): Promise<Completion> {
      state.calls += 1; state.keys.push(call.key); state.bases.push(call.baseUrl);
      const behavior = next();
      if (behavior === "hang") return new Promise<Completion>((_, reject) => call.signal.addEventListener("abort", () => reject(new ProviderError("timeout"))));
      if (behavior === "deaf") return new Promise<Completion>(() => undefined);
      if (behavior === "nousage") return { text, usage: null, finishReason: "stop" };
      if (behavior !== "ok") throw new ProviderError(behavior as never);
      return { text, usage: { inputTokens: 100, outputTokens: 40 }, finishReason: "stop" };
    },
    async *stream(call): AsyncGenerator<StreamEvent, void> {
      state.calls += 1; state.keys.push(call.key);
      const behavior = next();
      if (behavior === "midway") { yield { type: "delta", text: "Ho" }; throw new ProviderError("server"); }
      if (behavior !== "ok") throw new ProviderError(behavior as never);
      yield { type: "delta", text: "Ho" }; yield { type: "delta", text: "la" }; yield { type: "usage", inputTokens: 100, outputTokens: 40 }; yield { type: "done" };
    },
  };
  return { adapter, state };
}
const registryOf = (adapters: Record<string, ProviderAdapter>, over: Record<string, Partial<ProviderConfig>> = {}): Record<string, ProviderConfig> =>
  Object.fromEntries(Object.entries(PROVIDER_REGISTRY).map(([id, config]) => [id, { ...config, adapter: adapters[id] ?? config.adapter, ...over[id] }]));
const deps = (registry: Record<string, ProviderConfig>, over: Partial<ExecutorDeps> = {}) => {
  const slept: number[] = [];
  const secrets = new SecretsManager(new MemorySecretsProvider({ ...KEYS, OLLAMA_BASE_URL: "http://127.0.0.1:11434" }));
  let clock = Date.parse(AT);
  const value: ExecutorDeps = { secrets, registry, sleep: async (ms) => { slept.push(ms); }, clock: () => new Date(clock).toISOString(), now: () => (clock += 3), ...over };
  return { deps: value, slept, secrets, advance: (ms: number) => { clock += ms; } };
};
const request = (over: Partial<GatewayRequest> = {}): GatewayRequest => ({
  requestId: "dec-1", tenantId: NOVA, at: AT, models: ["gw-fast-1", "gw-reason-1", "gw-balanced-1"], priority: "normal", maxTimeMs: 1_000, inputTokens: 80, maxOutputTokens: 200, limits: GATEWAY_LIMIT_DEFAULTS, promptHash: "h", ...over,
});
const PROMPT = { system: "reglas", user: "palabras" };
const shape = (attempts: { modelId: string; outcome: string }[]) => attempts.map((item) => `${item.modelId}:${item.outcome}`);

describe("the real executor of the AI Gateway", () => {
  it("answers with the first model, counts the tokens the provider counted, works out the real cost, and keeps the key out of everything it returns", async () => {
    const a = fakeAdapter("openai");
    const { deps: d, secrets } = deps(registryOf({ openai: a.adapter }));
    const { outcome, text } = await executeChain(request(), PROMPT, d);
    expect(text).toBe("respuesta");
    expect(outcome).toMatchObject({ status: "ok", modelId: "gw-fast-1", providerId: "openai", fallbackUsed: false, inputTokens: 100, outputTokens: 40, tokenSource: "provider" });
    expect(outcome.estimatedCostMicros).toBe(costOfNative(NATIVE_MODELS["gw-fast-1"]!, 100, 40));
    expect(outcome.attempts).toHaveLength(1);
    expect(a.state.keys).toEqual([KEYS["OPENAI_API_KEY"]]);
    expect(JSON.stringify(outcome)).not.toContain(KEYS["OPENAI_API_KEY"]!);
    expect(secrets.accessLog().map((item) => [item.name, item.purpose])).toEqual([["OPENAI_API_KEY", "ai:openai"]]);
  });

  it("estimates the tokens from the text, and says so, when a provider does not report them", async () => {
    const a = fakeAdapter("openai", ["nousage"], "x".repeat(400));
    const { outcome } = await executeChain(request(), PROMPT, deps(registryOf({ openai: a.adapter })).deps);
    expect(outcome).toMatchObject({ status: "ok", tokenSource: "estimated", inputTokens: 80, outputTokens: 100 });
  });

  it("falls back to ANOTHER provider when one is down, and records why", async () => {
    const a = fakeAdapter("openai", ["server"]);
    const b = fakeAdapter("anthropic");
    const { outcome } = await executeChain(request(), PROMPT, deps(registryOf({ openai: a.adapter, anthropic: b.adapter })).deps);
    expect(outcome).toMatchObject({ status: "ok", modelId: "gw-reason-1", providerId: "anthropic", fallbackUsed: true });
    expect(shape(outcome.attempts)).toEqual(["gw-fast-1:down", "gw-reason-1:ok"]);
    expect(outcome.fallbackReasons.join()).toContain("gw-fast-1: server");
    expect(a.state.calls).toBe(1);
  });

  it("retries a rate limit and a timeout with the company's backoff before it falls back, and not an outage", async () => {
    const a = fakeAdapter("openai", ["rateLimited", "rateLimited"]);
    const setup = deps(registryOf({ openai: a.adapter, anthropic: fakeAdapter("anthropic").adapter }));
    const { outcome } = await executeChain(request(), PROMPT, setup.deps);
    expect(shape(outcome.attempts)).toEqual(["gw-fast-1:rateLimited", "gw-fast-1:rateLimited", "gw-reason-1:ok"]);
    expect(setup.slept).toEqual([GATEWAY_LIMIT_DEFAULTS.retry.backoffMs[0]]);
    expect(outcome.attempts[0]!.backoffMs).toBe(GATEWAY_LIMIT_DEFAULTS.retry.backoffMs[0]);
    const recovers = fakeAdapter("openai", ["rateLimited"]);
    expect(shape((await executeChain(request(), PROMPT, deps(registryOf({ openai: recovers.adapter })).deps)).outcome.attempts)).toEqual(["gw-fast-1:rateLimited", "gw-fast-1:ok"]);
    const outage = fakeAdapter("openai", ["server", "server"]);
    const { outcome: down } = await executeChain(request(), PROMPT, deps(registryOf({ openai: outage.adapter, anthropic: fakeAdapter("anthropic").adapter })).deps);
    expect(outage.state.calls).toBe(1);
    expect(shape(down.attempts)).toEqual(["gw-fast-1:down", "gw-reason-1:ok"]);
  });

  it("gives a critical request one more attempt and a low one a single attempt", async () => {
    const run = async (priority: "low" | "critical") => {
      const a = fakeAdapter("openai", ["rateLimited", "rateLimited", "rateLimited", "rateLimited"]);
      await executeChain(request({ priority, models: ["gw-fast-1"] }), PROMPT, deps(registryOf({ openai: a.adapter })).deps);
      return a.state.calls;
    };
    expect(await run("critical")).toBe(3);
    expect(await run("low")).toBe(1);
  });

  it("applies the time limit: a call that does not answer in time is a timeout, even from an adapter that ignores the signal", async () => {
    const hang = fakeAdapter("openai", ["hang", "hang"]);
    const deaf = fakeAdapter("anthropic", ["deaf", "deaf"]);
    const ok = fakeAdapter("google");
    const { outcome } = await executeChain(request({ maxTimeMs: 25 }), PROMPT, { ...deps(registryOf({ openai: hang.adapter, anthropic: deaf.adapter, google: ok.adapter })).deps, now: Date.now });
    expect(shape(outcome.attempts)).toEqual(["gw-fast-1:timeout", "gw-fast-1:timeout", "gw-reason-1:timeout", "gw-reason-1:timeout", "gw-balanced-1:ok"]);
    expect(outcome.attempts.filter((item) => item.outcome === "timeout").every((item) => item.latencyMs >= 20)).toBe(true);
    expect(outcome.providerId).toBe("google");
  });

  it("opens the circuit after repeated failures, skips that provider while it is open, and tries it once when it half opens", async () => {
    const limits = { ...GATEWAY_LIMIT_DEFAULTS, breaker: { failureThreshold: 2, cooldownMs: 60_000 }, retry: { maxAttempts: 1, backoffMs: [1] } };
    const bad = fakeAdapter("openai", ["server", "server", "server", "ok"]);
    const setup = deps(registryOf({ openai: bad.adapter, anthropic: fakeAdapter("anthropic").adapter }));
    let breakers: BreakerRecord[] = [];
    for (let index = 0; index < 2; index += 1) breakers = (await executeChain(request({ limits }), PROMPT, { ...setup.deps, breakers })).outcome.breakers;
    expect(breakers.find((item) => item.providerId === "openai")).toMatchObject({ failures: 2 });
    expect(bad.state.calls).toBe(2);
    const open = await executeChain(request({ limits }), PROMPT, { ...setup.deps, breakers });
    expect(open.outcome.attempts[0]).toMatchObject({ modelId: "gw-fast-1", outcome: "skipped", providerId: "openai" });
    expect(open.outcome.attempts[0]!.note).toMatch(/cortacircuitos/);
    expect(bad.state.calls).toBe(2);
    setup.advance(61_000);
    const trial = await executeChain(request({ limits }), PROMPT, { ...setup.deps, breakers: open.outcome.breakers });
    expect(bad.state.calls).toBe(3);
    expect(trial.outcome.breakers.find((item) => item.providerId === "openai")?.openedAt).toBeDefined();
    const healed = await executeChain(request({ limits }), PROMPT, { ...setup.deps, breakers: trial.outcome.breakers });
    expect(healed.outcome.attempts[0]!.outcome).toBe("skipped");
    setup.advance(61_000);
    const closed = await executeChain(request({ limits }), PROMPT, { ...setup.deps, breakers: healed.outcome.breakers });
    expect(closed.outcome).toMatchObject({ status: "ok", providerId: "openai" });
    expect(closed.outcome.breakers.find((item) => item.providerId === "openai")).toMatchObject({ failures: 0 });
  });

  it("never calls a provider that is only prepared, even with its secret set, and skips one with no secret, saying why", async () => {
    const prepared = fakeAdapter("mistral");
    const grok = fakeAdapter("grok");
    const local = fakeAdapter("local");
    const registry = registryOf({ mistral: prepared.adapter, grok: grok.adapter, local: local.adapter });
    const { outcome } = await executeChain(request({ models: ["gw-eu-1", "gw-live-1", "gw-local-1", "gw-embed-1"] }), PROMPT, deps(registry).deps);
    expect(outcome.status).toBe("failed");
    expect([prepared, grok, local].map((item) => item.state.calls)).toEqual([0, 0, 0]);
    expect(outcome.attempts.map((item) => item.note)).toEqual(["preparado, sin conectar", "preparado, sin conectar", "preparado, sin conectar", expect.stringMatching(/provider|proveedor|sin adaptador|preparado/)]);
    const noKey = new SecretsManager(new MemorySecretsProvider({}));
    const open = fakeAdapter("openai");
    const skipped = await executeChain(request({ models: ["gw-fast-1"] }), PROMPT, { ...deps(registryOf({ openai: open.adapter })).deps, secrets: noKey });
    expect(skipped.outcome.attempts[0]).toMatchObject({ outcome: "skipped", note: "sin configurar" });
    expect(open.state.calls).toBe(0);
  });

  it("fails with every reason recorded, and costs nothing, when no provider can answer", async () => {
    const a = fakeAdapter("openai", ["server"]);
    const b = fakeAdapter("anthropic", ["auth"]);
    const c = fakeAdapter("google", ["network"]);
    const { outcome, text } = await executeChain(request(), PROMPT, deps(registryOf({ openai: a.adapter, anthropic: b.adapter, google: c.adapter })).deps);
    expect(text).toBeNull();
    expect(outcome).toMatchObject({ status: "failed", estimatedCostMicros: 0, outputTokens: 0, fallbackUsed: false });
    expect(outcome.fallbackReasons).toEqual(["gw-fast-1: server", "gw-reason-1: auth", "gw-balanced-1: network"]);
    expect(outcome.modelId).toBeUndefined();
  });

  it("reports every attempt to an observer without a key or a word of the text", async () => {
    const seen: string[] = [];
    const a = fakeAdapter("openai", ["server"]);
    await executeChain(request(), PROMPT, { ...deps(registryOf({ openai: a.adapter, anthropic: fakeAdapter("anthropic").adapter })).deps, onAttempt: (event) => seen.push(JSON.stringify(event)) });
    expect(seen).toHaveLength(2);
    expect(JSON.stringify(seen)).not.toMatch(/palabras|reglas|respuesta|k{24}/);
    expect(JSON.parse(seen[0]!)).toMatchObject({ providerId: "openai", outcome: "down", errorKind: "server" });
  });

  it("removes control characters from what a model answers and keeps the line breaks", () => {
    expect(sanitizeAnswer(`hola${String.fromCharCode(0)}\n${String.fromCharCode(7)}mundo\t!${String.fromCharCode(127)}`)).toBe("hola\nmundo\t!" + String.fromCharCode(127));
  });
});

describe("streaming", () => {
  it("gives the answer as it is written, then the outcome with the provider's own count", async () => {
    const a = fakeAdapter("openai");
    const parts = [];
    for await (const part of executeStream(request(), PROMPT, deps(registryOf({ openai: a.adapter })).deps)) parts.push(part);
    expect(parts.filter((part) => part.type === "delta").map((part) => (part as { text: string }).text)).toEqual(["Ho", "la"]);
    const done = parts.at(-1)!;
    expect(done.type).toBe("done");
    if (done.type !== "done") return;
    expect(done.execution.text).toBe("Hola");
    expect(done.execution.outcome).toMatchObject({ status: "ok", modelId: "gw-fast-1", inputTokens: 100, outputTokens: 40, tokenSource: "provider" });
  });

  it("falls back until the first piece arrives, and ends as failed (never mixing two models) when the stream breaks in the middle", async () => {
    const early = fakeAdapter("openai", ["server"]);
    const second = fakeAdapter("anthropic");
    const first = [];
    for await (const part of executeStream(request(), PROMPT, deps(registryOf({ openai: early.adapter, anthropic: second.adapter })).deps)) first.push(part);
    const done = first.at(-1)!;
    expect(done.type === "done" && done.execution.outcome).toMatchObject({ status: "ok", modelId: "gw-reason-1", fallbackUsed: true });
    const broken = fakeAdapter("openai", ["midway"]);
    const spare = fakeAdapter("anthropic");
    const second2 = [];
    for await (const part of executeStream(request(), PROMPT, deps(registryOf({ openai: broken.adapter, anthropic: spare.adapter })).deps)) second2.push(part);
    expect(second2.filter((part) => part.type === "delta")).toHaveLength(1);
    const end = second2.at(-1)!;
    expect(end.type === "done" && end.execution.outcome.status).toBe("failed");
    expect(end.type === "done" && end.execution.text).toBeNull();
    expect(spare.state.calls).toBe(0);
  });
});

// ================================================================ the same rules as the simulation
describe("the real executor and the Gateway's simulation follow the same rules", () => {
  const scenarios: [string, "down" | "rateLimited", string][] = [["an outage", "down", "server"], ["a rate limit", "rateLimited", "rateLimited"]];
  it.each(scenarios)("%s: the same attempts, the same fallback and the same winner", async (_name, mode, kind) => {
    const first = MODEL_PROVIDER["gw-fast-1"]!;
    let simulated = newGatewayState();
    simulated = reduceGateway(simulated, { type: "provider.incident", at: AT, tenantId: "platform", actor: "system", providerId: first, mode }).state;
    const sim = reduceGateway(simulated, { type: "gateway.execute", at: AT, tenantId: NOVA, actor: "koe", request: request({ models: ["gw-fast-1", "gw-reason-1"], maxTimeMs: 60_000 }) }).call!;
    const real = await executeChain(request({ models: ["gw-fast-1", "gw-reason-1"], maxTimeMs: 60_000 }), PROMPT, deps(registryOf({ openai: fakeAdapter("openai", [kind, kind, kind]).adapter, anthropic: fakeAdapter("anthropic").adapter })).deps);
    expect(shape(real.outcome.attempts)).toEqual(shape(sim.attempts));
    expect(real.outcome).toMatchObject({ status: sim.status, modelId: sim.modelId, providerId: sim.providerId, fallbackUsed: sim.fallbackUsed });
    expect(real.outcome.fallbackReasons.map((item) => item.split(":").slice(0, 2).join(":"))).toEqual(sim.fallbackReasons.map((item) => item.split(":").slice(0, 2).join(":")));
  });
});

// ================================================================ the whole path: Module -> KOE -> Optimizer -> Gateway -> provider
const ask = (over: Partial<AskEvent> = {}): AskEvent => ({ type: "ai.request", at: AT, tenantId: NOVA, actor: "worker:nex", caller: "nex", purposeId: "faq.answer", input: { user: "¿Cuál es el horario de atención?" }, ...over });
const configured = (over: Partial<Extract<AiEvent, { type: "ai.configure" }>> = {}): AiState => reduceAi(newAiState(), { type: "ai.configure", at: AT, tenantId: NOVA, actor: "ana", ...over }).state;
/** A world where each provider answers in its own protocol. */
const world = (over: { fail?: string[] } = {}) => mockFetch((call) => {
  const host = new URL(call.url).host;
  if (over.fail?.includes(host)) return reply({ error: "down" }, 500);
  if (host === "api.openai.com") return reply(chatReply("Atendemos de 9 a 5.", { prompt_tokens: 120, completion_tokens: 33 }));
  if (host === "generativelanguage.googleapis.com") return reply({ candidates: [{ content: { parts: [{ text: "Abrimos de 9 a 5." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 20 } });
  if (host === "api.anthropic.com") return reply({ content: [{ type: "text", text: "De 9 a 5." }], stop_reason: "end_turn", usage: { input_tokens: 95, output_tokens: 12 } });
  return reply({ error: "unexpected" }, 404);
});
const real = (fetchImpl: typeof fetch, over: Partial<ExecutorDeps> = {}): ExecutorDeps => ({ secrets: aiSecrets(KEYS), fetchImpl, sleep: async () => undefined, ...over });

describe("a request through KOE, the Optimizer and the Gateway to a real provider", () => {
  it("is decided by KOE and the Optimizer, run by the provider the Gateway picked, and recorded with the real tokens and cost", async () => {
    const { fn, calls } = world();
    const answer = await askAi(newAiState(), ask(), real(fn));
    expect(answer.text).toBe("Atendemos de 9 a 5.");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    const record = answer.result.record!;
    const call = answer.result.state.gateway.calls[0]!;
    expect(record).toMatchObject({ status: "ok", workerId: "sales", specialty: "conversation", policyId: "balanced", gatewayCallId: call.id });
    expect(call).toMatchObject({ status: "ok", modelId: "gw-fast-1", providerId: "openai", inputTokens: 120, outputTokens: 33, tokenSource: "provider", fallbackUsed: false });
    expect(call.estimatedCostMicros).toBe(costOfNative(NATIVE_MODELS["gw-fast-1"]!, 120, 33));
    expect(record.estimatedCostMicros).toBe(call.estimatedCostMicros);
    expect(answer.result.decision).toEqual(reduceAi(newAiState(), ask()).decision);
  });

  it("sends the provider the prompt KOE assembled: the instructions apart, the user's words and the context labelled, personal data replaced", async () => {
    const { fn, calls } = world();
    await askAi(newAiState(), ask({ input: { business: "Somos Nova.", context: ["Plan Pro."], user: "Escribe a ana@nova.com" } }), real(fn));
    const messages = calls[0]!.body["messages"] as { role: string; content: string }[];
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[0]!.content).toContain("Somos Nova.");
    expect(messages[1]!.role).toBe("user");
    expect(messages[1]!.content).toContain("[context]\nPlan Pro.");
    expect(messages[1]!.content).toContain("[correo]");
    expect(JSON.stringify(calls[0]!.body)).not.toContain("ana@nova.com");
    expect(calls[0]!.body["max_completion_tokens"]).toBe(400);
    expect(providerPrompt({ parts: [{ layer: "user", text: "x", tokens: 1 }, { layer: "system", text: "s", tokens: 1 }], inputTokens: 2, pii: [], moderation: [], trimmed: [], overLimit: false, hash: "h" })).toEqual({ system: "s", user: "[user]\nx" });
  });

  it("falls back to another real provider when the first is down, and KOE's record shows it", async () => {
    const { fn, calls } = world({ fail: ["api.openai.com"] });
    const answer = await askAi(newAiState(), ask(), real(fn));
    expect(answer.text).toBe("Abrimos de 9 a 5.");
    expect(calls.map((call) => new URL(call.url).host)).toEqual(["api.openai.com", "generativelanguage.googleapis.com"]);
    const call = answer.result.state.gateway.calls[0]!;
    expect(call).toMatchObject({ status: "ok", providerId: "google", modelId: "gw-balanced-1", fallbackUsed: true, inputTokens: 90, outputTokens: 20 });
    expect(call.fallbackReasons.join()).toContain("gw-fast-1: server");
    expect(call.attempts.filter((item) => item.outcome !== "skipped").map((item) => `${item.providerId}:${item.outcome}`)).toEqual(["openai:down", "google:ok"]);
  });

  it("fails cleanly when no connected provider can answer, and costs nothing", async () => {
    const { fn, calls } = world({ fail: ["api.openai.com", "generativelanguage.googleapis.com", "api.anthropic.com", "openrouter.ai"] });
    const answer = await askAi(newAiState(), ask(), real(fn));
    expect(answer.text).toBeNull();
    expect(answer.result.errorCode).toBe("allFailed");
    expect(answer.result.record).toMatchObject({ status: "failed", estimatedCostMicros: 0 });
    expect(calls.length).toBeGreaterThan(1);
  });

  it("keeps the policies: each company's policy changes which model, and so which provider, the Gateway tries first", async () => {
    const first = async (policy: "costFirst" | "qualityFirst" | "speedFirst" | "balanced") => {
      const { fn, calls } = world();
      await askAi(configured({ policy }), ask(), real(fn));
      return calls[0]?.url ?? "none";
    };
    expect(await first("balanced")).toContain("api.openai.com");
    expect(await first("speedFirst")).toContain("api.openai.com");
    expect(await first("qualityFirst")).toContain("generativelanguage.googleapis.com");
    // cost first picks the local model, which is only prepared: it is skipped and the next connected provider answers
    expect(await first("costFirst")).toMatch(/api\.openai\.com|generativelanguage|anthropic|openrouter/);
  });

  it("never sends personal data to a cloud provider: Privacy First keeps it on a local model, which is not connected yet, so the request fails and no call is made", async () => {
    const { fn, calls } = world();
    const answer = await askAi(configured({ policy: "privacyFirst" }), ask({ purposeId: "chat.reply", input: { user: "Dame el teléfono de Ana" } }), real(fn));
    expect(calls).toEqual([]);
    expect(answer.text).toBeNull();
    expect(answer.result.errorCode).toBe("allFailed");
    expect(answer.result.state.gateway.calls[0]!.attempts.map((item) => item.note)).toEqual(["preparado, sin conectar"]);
  });

  it("calls no provider for what KOE refuses: content, limits, a company's allow-list and its budget", async () => {
    const { fn, calls } = world();
    expect((await askAi(newAiState(), ask({ input: { user: "quiero morir" } }), real(fn))).result.errorCode).toBe("moderated");
    expect((await askAi(configured({ limits: { maxInputTokens: 60 } }), ask({ input: { user: "z".repeat(900) } }), real(fn))).result.errorCode).toBe("tooLong");
    expect((await askAi(configured({ allowedModels: ["gw-econ-1"] }), ask(), real(fn))).result.errorCode).toBe("noModel");
    expect((await askAi(configured({ budgetMicros: 1 }), ask(), real(fn))).result.errorCode).toBe("overBudget");
    expect((await askAi(newAiState(), ask({ caller: "someone" }), real(fn))).result.errorCode).toBe("unknownCaller");
    expect(calls).toEqual([]);
  });

  it("keeps no key, no prompt and no answer in any state or record, only the decision, the counts and the cost", async () => {
    const { fn } = world();
    const answer = await askAi(newAiState(), ask({ input: { user: "La clave secreta de la frase ZETA-QUASAR-77" } }), real(fn));
    const dump = JSON.stringify(answer.result.state);
    for (const secret of Object.values(KEYS)) expect(dump).not.toContain(secret);
    expect(dump).not.toMatch(/ZETA-QUASAR|Atendemos de 9 a 5|reglas/i);
    expect(answer.text).toContain("9 a 5");
  });

  it("lets the Backend Core observe the real call: one event, the real tokens and cost, and a span with the real latency", async () => {
    const { fn } = world();
    const before = newAiState();
    const answer = await askAi(before, ask(), real(fn, { now: (() => { let t = 1_000; return () => (t += 40); })() }));
    const observations = BRIDGES.ai.observe!(before, answer.result.state);
    const call = answer.result.state.gateway.calls[0]!;
    expect(observations.find((item) => item.kind === "event")).toMatchObject({ name: "ai.call.recorded", payload: { status: "ok", latencyMs: call.latencyMs, costMicros: call.estimatedCostMicros } });
    expect(observations.find((item) => item.kind === "span")).toMatchObject({ name: "ai.gateway.call", durationMs: call.latencyMs });
    expect(call.latencyMs).toBeGreaterThan(0);
  });

  it("streams the answer through the same path and records the same real outcome at the end", async () => {
    const { fn } = mockFetch(() => chatSse("Aten", "demos."));
    const parts = [];
    for await (const part of askAiStream(newAiState(), ask(), real(fn))) parts.push(part);
    expect(parts.filter((part) => part.type === "delta").map((part) => (part as { text: string }).text)).toEqual(["Aten", "demos."]);
    const done = parts.at(-1)!;
    if (done.type !== "done") throw new Error("the stream did not end");
    expect(done.answer.text).toBe("Atendemos.");
    expect(done.answer.result.state.gateway.calls[0]).toMatchObject({ status: "ok", providerId: "openai", inputTokens: 12, outputTokens: 7, tokenSource: "provider" });
    const refused = [];
    for await (const part of askAiStream(newAiState(), ask({ input: { user: "quiero morir" } }), real(fn))) refused.push(part);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.type === "done" && refused[0]!.answer.result.errorCode).toBe("moderated");
  });

  it("leaves the Gateway simulating, exactly as before, when no provider layer is involved", () => {
    const simulated = reduceAi(newAiState(), ask());
    expect(simulated.state.gateway.calls[0]).toMatchObject({ status: "ok" });
    expect(simulated.state.gateway.calls[0]!.tokenSource).not.toBe("provider");
    expect(simulated.output).toMatch(/^\[simulado\]/);
  });
});
