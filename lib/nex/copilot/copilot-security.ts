// Copilot Security: who may ask, who may see what, and who may approve. Permissions are applied BEFORE any context is built: the RAG already hides what the asker cannot read in memory and in the graph;
// this layer hides what the asker may not see of the company's FIGURES (KOE): money for managers and above, operations for members and above. What is hidden does not exist for the asker, so no finding,
// recommendation or action can be built from it. Level 3 (ADR-0009): only a person with the role the action's level requires approves; a worker, the system and NEX prepare.

import { levelForAction } from "@/lib/contracts/platform/workers";
import { authorize, unsafeForContext, validateQuery } from "@/lib/nex/rag";
import type { AutonomyLevel, Principal, Role, SuggestedAction } from "./copilot-types";

export { authorize, validateQuery };
export const ROLE_RANK: Readonly<Record<Role, number>> = { viewer: 1, member: 2, manager: 3, admin: 4, owner: 5 };
const atLeast = (principal: Principal, role: Role): boolean => principal.kind === "person" && ROLE_RANK[principal.role] >= ROLE_RANK[role];

/** Money (ROI, costs, revenue): managers and above, and the system. */
export const canSeeFinance = (principal: Principal): boolean => principal.kind === "system" || atLeast(principal, "manager");
/** Operational figures (customers, funnel, workers, automations): members and above, active workers and the system. A viewer reads only what memory and the graph let them read. */
export const canSeeOperations = (principal: Principal): boolean => principal.kind !== "person" || atLeast(principal, "member");
/** Recording a decision in a session: a person (member or above). */
export const canDecide = (principal: Principal): boolean => atLeast(principal, "member");

/** The role each autonomy level asks for: 1 a member, 2 a manager, 3 an administrator. Even Level 1 needs a person: the Copilot never acts alone. */
export const APPROVER_BY_LEVEL: Readonly<Record<AutonomyLevel, Role>> = { 1: "member", 2: "manager", 3: "admin" };
export const approverFor = (actionId: string): Role => APPROVER_BY_LEVEL[levelForAction(actionId)];
export const canApprove = (principal: Principal, action: Pick<SuggestedAction, "approverRole">): boolean => atLeast(principal, action.approverRole);
/** Who can see a suggested action: not the figures it is built on if the asker may not see them. */
export const canSeeAction = (principal: Principal, action: Pick<SuggestedAction, "needs">): boolean => (action.needs === "finance" ? canSeeFinance(principal) : canSeeOperations(principal));

export const ownerKey = (principal: Principal): string => (principal.kind === "system" ? "system" : `${principal.kind}:${principal.id}`);

/** A short free text the Copilot keeps (an objective, a decision): short, and never a credential, restricted data or a disguised instruction. */
export function validateShortText(value: unknown, max = 120): { ok: true; text: string } | { ok: false; reason: "empty" | "tooLong" | "sensitive" } {
  if (typeof value !== "string" || value.trim() === "") return { ok: false, reason: "empty" };
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > max) return { ok: false, reason: "tooLong" };
  if (unsafeForContext(text)) return { ok: false, reason: "sensitive" };
  return { ok: true, text };
}
/** The last screen on anything that is going to be shown: if it looks unsafe it is not shown. */
export const safeToShow = (text: string): boolean => !unsafeForContext(text);
