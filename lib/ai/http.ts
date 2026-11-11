// The only place in the product that makes a network call to an AI provider. It turns HTTP into what the adapters need (a parsed body, or events of a stream) and every
// failure into a ProviderError of one of a few kinds, without ever putting a key, a prompt or an answer into an error. The fetch function is injected, so tests and the
// Workers runtime use the same code.

import { ProviderError, type ProviderErrorKind } from "./types";

export function kindOfStatus(status: number): ProviderErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 408) return "timeout";
  if (status === 429) return "rateLimited";
  if (status >= 500) return "server";
  return "badRequest";
}

/** Sends a JSON POST. A failed status, a network failure and an abort all become a ProviderError. */
export async function postJson(fetchImpl: typeof fetch, url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw new ProviderError("timeout");
    throw new ProviderError("network");
  }
  if (!response.ok) {
    // the body is not read into the error: it can echo the prompt
    await response.body?.cancel().catch(() => undefined);
    throw new ProviderError(kindOfStatus(response.status), response.status);
  }
  return response;
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new ProviderError("parse");
  }
}

/** The lines of a response body, as they arrive. */
async function* lines(response: Response): AsyncGenerator<string, void> {
  if (!response.body) throw new ProviderError("parse");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        yield buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode();
    if (buffer !== "") yield buffer.replace(/\r$/, "");
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError("network");
  } finally {
    reader.releaseLock();
  }
}

/** Server-sent events: the `data:` payload of each event (and its `event:` name when there is one). */
export async function* sseEvents(response: Response): AsyncGenerator<{ event: string | null; data: string }, void> {
  let event: string | null = null;
  const data: string[] = [];
  for await (const line of lines(response)) {
    if (line === "") {
      if (data.length > 0) yield { event, data: data.join("\n") };
      event = null;
      data.length = 0;
    } else if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  if (data.length > 0) yield { event, data: data.join("\n") };
}

/** Newline-delimited JSON: one object per line. */
export async function* jsonLines(response: Response): AsyncGenerator<unknown, void> {
  for await (const line of lines(response)) {
    if (line.trim() === "") continue;
    try {
      yield JSON.parse(line) as unknown;
    } catch {
      throw new ProviderError("parse");
    }
  }
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ProviderError("parse");
  }
}

/** Reads a nested value from parsed JSON without trusting its shape. */
export function at(value: unknown, ...path: (string | number)[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}
export const text = (value: unknown): string => (typeof value === "string" ? value : "");
export const count = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined);
