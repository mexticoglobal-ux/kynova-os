// RAG Security: permissions are applied BEFORE anything is retrieved (the Memory Engine and the Knowledge Graph already filter by company and by what the asker may read, so what the asker
// cannot see is never even a candidate: it does not exist for them). This layer adds the checks of its own: who may ask, what may not be asked, a last guard that nothing of another company
// slips through, and a screen that keeps secrets, credentials and prompts out of the context.

import { screenText, type Principal } from "@/lib/nex/memory";
import { MAX_QUERY_CHARS, type Refusal, type RagEnv } from "./rag-types";

/** Who may ask: any person of the company, an ACTIVE worker, or the system, always of the company they claim. */
export function authorize(principal: Principal, claimedTenantId: string, env: RagEnv): Refusal | undefined {
  if (principal.tenantId !== claimedTenantId) return "tenant";
  if (principal.kind === "worker" && !env.isWorkerActive(principal.tenantId, principal.id)) return "workerInactive";
  return undefined;
}
/** Only a person (member or above) or the system says whether retrieved knowledge was useful: a worker does not grade its own sources. */
export const canGiveFeedback = (principal: Principal): boolean => principal.kind === "system" || (principal.kind === "person" && principal.role !== "viewer");
export const canInvalidate = (principal: Principal): boolean => principal.kind === "system" || (principal.kind === "person" && (principal.role === "admin" || principal.role === "owner"));

/** A question must be text, short, and not carry a credential or restricted personal data: those are refused and never cached, logged or analyzed. */
export function validateQuery(query: unknown): { ok: true; text: string } | { ok: false; refusal: Refusal; reasons: readonly string[] } {
  if (typeof query !== "string" || query.trim() === "") return { ok: false, refusal: "invalid", reasons: ["empty"] };
  if (query.length > MAX_QUERY_CHARS) return { ok: false, refusal: "invalid", reasons: ["tooLong"] };
  const screened = screenText(query);
  if (screened.reasons.includes("secret") || screened.reasons.includes("restricted")) return { ok: false, refusal: "sensitive", reasons: screened.reasons.filter((reason) => reason === "secret" || reason === "restricted") };
  return { ok: true, text: query.trim() };
}

/** The last guard: whatever is retrieved belongs to the asker's company. Nothing should ever be dropped here; if something is, it is counted. */
export function onlyTenant<T extends { tenantId: string }>(items: readonly T[], tenantId: string): { kept: T[]; leaked: number } {
  const kept = items.filter((item) => item.tenantId === tenantId);
  return { kept, leaked: items.length - kept.length };
}

/** Text that must never reach a context: credentials, restricted data, and instructions disguised as knowledge. */
export function unsafeForContext(text: string): boolean {
  const screened = screenText(text);
  return screened.reasons.includes("secret") || screened.reasons.includes("restricted") || screened.reasons.includes("prompt");
}
