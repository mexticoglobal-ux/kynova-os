// Copilot Actions: the Action Builder. Each recommendation brings the actions that would carry it out, by the platform's own action catalog (workers.ts), whose autonomy level is decided in code and
// fails closed (an unknown action is Level 3). The Copilot only SUGGESTS: every action is created `requiresApproval: true` and `executed: false`, and there is no code path that executes one. A person
// with the role the level asks for (1 a member, 2 a manager, 3 an administrator) can approve or reject it before it expires; approving only RECORDS the approval, so that a later layer (KOE) can act on it
// under its own gates. Pure: the clock is handed in.

import { levelForAction } from "@/lib/contracts/platform/workers";
import { ruleOf } from "./copilot-recommendations";
import { approverFor } from "./copilot-security";
import type { ActionStatus, CopilotConfig, Recommendation, SuggestedAction } from "./copilot-types";

export const actionIdFor = (recommendationId: string, actionId: string): string => `act:${recommendationId}:${actionId}`;

/** The actions a list of recommendations brings, never executed, always waiting for a person. */
export function buildActions(recommendations: readonly Recommendation[], tenantId: string, at: string, config: Pick<CopilotConfig, "actionTtlMs">): SuggestedAction[] {
  const expiresAt = new Date(Date.parse(at) + config.actionTtlMs).toISOString();
  return recommendations.flatMap((rec) =>
    (ruleOf(rec.findingId)?.actions ?? []).map((template): SuggestedAction => ({
      id: actionIdFor(rec.id, template.actionId), tenantId, recommendationId: rec.id, actionId: template.actionId, label: template.label, level: levelForAction(template.actionId),
      requiresApproval: true, approverRole: approverFor(template.actionId), executed: false, preparedBy: "nex", status: "suggested", needs: rec.needs, modules: rec.modules, suggestedAt: at, expiresAt,
    })));
}

/**
 * Adds what is new. An action already known keeps its state (a person's decision is never undone by asking again); one that expired comes back as a fresh suggestion. A company keeps at most `max`:
 * decided and expired ones go first, then the oldest.
 */
export function upsertActions(existing: readonly SuggestedAction[], incoming: readonly SuggestedAction[], tenantId: string, max: number): SuggestedAction[] {
  let next = [...existing];
  for (const action of incoming) {
    const known = next.find((row) => row.tenantId === tenantId && row.id === action.id);
    if (!known) next.push(action);
    else if (known.status === "expired") next = next.map((row) => (row === known ? action : row));
  }
  const mine = next.filter((row) => row.tenantId === tenantId);
  if (mine.length > max) {
    const order = [...mine].sort((a, b) => Number(a.status === "suggested") - Number(b.status === "suggested") || a.suggestedAt.localeCompare(b.suggestedAt) || a.id.localeCompare(b.id));
    const drop = new Set(order.slice(0, mine.length - max));
    next = next.filter((row) => !drop.has(row));
  }
  return next;
}

/** A suggestion nobody decided on in time expires: it can no longer be approved. */
export function expireActions(actions: readonly SuggestedAction[], tenantId: string, nowMs: number): { actions: SuggestedAction[]; expired: string[] } {
  const expired: string[] = [];
  const next = actions.map((action) => {
    if (action.tenantId === tenantId && action.status === "suggested" && nowMs >= Date.parse(action.expiresAt)) { expired.push(action.id); return { ...action, status: "expired" as ActionStatus }; }
    return action;
  });
  return { actions: next, expired };
}

export const decideAction = (action: SuggestedAction, status: "approved" | "rejected", by: string, at: string): SuggestedAction => ({ ...action, status, decidedBy: by, decidedAt: at });
