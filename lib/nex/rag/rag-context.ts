// RAG Context Builder: turns the ranked items into a COMPACT context, in priority order. It removes duplicates (the same knowledge twice, or two memories that say the same), keeps within a
// character budget and within Top K, and never lets a secret, a token, a credential, restricted data or an instruction disguised as knowledge through, even if one was somehow stored.

import { maskPersonal, tokenize } from "@/lib/nex/memory";
import { unsafeForContext } from "./rag-security";
import type { ContextEntry, RagContext, RankedItem } from "./rag-types";

/** A line is cut to what is left only when at least this much room remains. */
const MIN_ROOM = 60;

function lineOf(item: RankedItem, position: number): string {
  const relations = item.relations.length > 0 ? ` → ${item.relations.join(", ")}` : "";
  if (item.kind === "memory") {
    const meta = `conf ${item.confidence}, imp ${item.importance}${item.advisory ? ", consultiva" : ""}`;
    return `${position}. [memoria·${item.type}] ${maskPersonal(item.summary ?? "")} (${meta})${relations}`;
  }
  return `${position}. [nodo·${item.type}] ${item.referenceId ?? ""}${item.category ? ` · ${item.category}` : ""}${relations}`;
}
const sameness = (item: RankedItem): string => (item.kind === "memory" ? `m|${tokenize(item.summary ?? "").join(" ")}` : `n|${item.type}|${item.referenceId ?? ""}`);
const cut = (text: string, room: number): string => `${text.slice(0, Math.max(0, room - 1)).trimEnd()}…`;

export type Built = { context: RagContext; included: RankedItem[] };

/** `ranked` must already be in priority order. Returns the context and the items that made it in, in order. */
export function buildContext(ranked: readonly RankedItem[], topK: number, maxChars: number): Built {
  const entries: ContextEntry[] = [];
  const included: RankedItem[] = [];
  const dropped = { duplicate: 0, sensitive: 0, budget: 0 };
  const seen = new Set<string>();
  let text = "";
  let truncated = false;
  for (const item of ranked) {
    if (included.length >= topK) break;
    if (seen.has(item.key) || seen.has(sameness(item))) { dropped.duplicate += 1; continue; }
    const position = included.length + 1;
    let line = lineOf(item, position);
    // the line, the tags and the reference are all screened: a context line is read by a model
    if (unsafeForContext([line, item.tags.join(" "), item.referenceId ?? "", item.category ?? ""].join("\n"))) { dropped.sensitive += 1; continue; }
    const room = maxChars - text.length - (text === "" ? 0 : 1);
    if (line.length > room) {
      dropped.budget += 1;
      if (room < MIN_ROOM) { truncated = true; break; }
      line = cut(line, room);
      truncated = true;
    }
    seen.add(item.key);
    seen.add(sameness(item));
    text = text === "" ? line : `${text}\n${line}`;
    included.push(item);
    entries.push({ position, key: item.key, kind: item.kind, ...(item.memoryId ? { memoryId: item.memoryId } : {}), ...(item.nodeId ? { nodeId: item.nodeId } : {}), score: item.score, line });
    if (truncated) break;
  }
  return { context: { text, entries, chars: text.length, truncated, dropped }, included };
}
