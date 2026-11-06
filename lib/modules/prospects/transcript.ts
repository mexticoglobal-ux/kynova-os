import type { TranscriptEntry } from "@/lib/contracts/backend";
import type { Say } from "@/lib/guided-chat";

// What NEX said, as stored messages. The "working" lines are theatre and the handoff card is stored separately.
export function entriesFromSay(say: readonly Say[]): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const item of say) {
    if (item.kind === "text" || item.kind === "reaction") entries.push({ direction: "out", senderKind: "nex", contentType: "text", body: item.text });
    else if (item.kind === "result") entries.push({ direction: "out", senderKind: "nex", contentType: "event", body: `Business Score ${item.score} de 100. ${item.status}` });
  }
  return entries;
}
