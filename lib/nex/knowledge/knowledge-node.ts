// Knowledge Node: what a node is, how it is identified, and how a node input is checked. A node carries a REFERENCE, never the thing: no text, no name, no address.

import { looksSensitive, slug } from "./knowledge-security";
import { NODE_TYPES, ROLES, type KnowledgeNode, type KnowledgePermissions, type NodeInput, type NodeType } from "./knowledge-types";

/** The same (type, reference) is always the same node: duplicates cannot exist. */
export const nodeId = (type: NodeType, referenceId: string): string => `n:${type}:${referenceId}`;
export const REFERENCE = /^[\w.:/-]{1,64}$/;
const ID = /^[\w.:-]{1,64}$/;
export const NODE_DEFAULTS = { confidence: 60, importance: 50 } as const;
export const MAX_TAGS = 8;

export const defaultPermissions = (type: NodeType): KnowledgePermissions => ({ visibility: "tenant", minRole: type === "customer" || type === "lead" ? "member" : "viewer", roles: [], workerIds: [], userIds: [] });
export const mergePermissions = (base: KnowledgePermissions, input: Partial<KnowledgePermissions> | undefined): KnowledgePermissions => ({
  visibility: input?.visibility ?? base.visibility, minRole: input?.minRole ?? base.minRole, roles: input?.roles ?? base.roles, workerIds: input?.workerIds ?? base.workerIds, userIds: input?.userIds ?? base.userIds,
});
export function validatePermissions(input: Partial<KnowledgePermissions> | undefined): string[] {
  if (!input) return [];
  const issues: string[] = [];
  if (input.visibility !== undefined && !["tenant", "restricted", "private"].includes(input.visibility)) issues.push("permissions:visibility");
  if (input.minRole !== undefined && !ROLES.includes(input.minRole)) issues.push("permissions:minRole");
  if (input.roles !== undefined && (!Array.isArray(input.roles) || input.roles.length > 5 || input.roles.some((role) => !ROLES.includes(role)))) issues.push("permissions:roles");
  for (const key of ["workerIds", "userIds"] as const) {
    const list = input[key];
    if (list !== undefined && (!Array.isArray(list) || list.length > 20 || list.some((id) => typeof id !== "string" || !ID.test(id)))) issues.push(`permissions:${key}`);
  }
  return issues;
}
export const normalizeTags = (tags: readonly string[]): string[] => [...new Set(tags.map((tag) => slug(tag)).filter(Boolean))];

/** What is wrong with a node input (empty when nothing). `sensitive` marks a reference, category or tag that looks like a credential or a contact detail. */
export function validateNodeInput(input: NodeInput): { issues: string[]; sensitive: boolean } {
  const issues: string[] = [];
  if (!NODE_TYPES.includes(input.type)) issues.push("type");
  if (typeof input.referenceId !== "string" || !REFERENCE.test(input.referenceId)) issues.push("referenceId");
  for (const key of ["confidence", "importance"] as const) {
    const value = input[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 100)) issues.push(key);
  }
  if (input.workerId !== undefined && !ID.test(input.workerId)) issues.push("workerId");
  if (input.category !== undefined && slug(input.category, 40) === "") issues.push("category");
  if (input.tags !== undefined && normalizeTags(input.tags).length > MAX_TAGS) issues.push("tags");
  issues.push(...validatePermissions(input.permissions));
  const texts = [input.referenceId, input.category ?? "", ...(input.tags ?? [])].filter((value): value is string => typeof value === "string");
  return { issues, sensitive: texts.some((text) => looksSensitive(text)) };
}

export type NodeUpsert = { node: KnowledgeNode; created: boolean; changed: boolean };
const withoutStamp = (node: KnowledgeNode): string => JSON.stringify({ ...node, updatedAt: "" });

/** The node an input describes, merged over what exists. `updatedAt` moves only when something really changed, so applying the same facts twice changes nothing. */
export function mergeNode(existing: KnowledgeNode | undefined, tenantId: string, at: string, source: KnowledgeNode["source"], input: NodeInput): NodeUpsert {
  const base: KnowledgeNode = existing ?? {
    id: nodeId(input.type, input.referenceId), tenantId, type: input.type, referenceId: input.referenceId, createdAt: at, updatedAt: at, confidence: NODE_DEFAULTS.confidence, importance: NODE_DEFAULTS.importance,
    permissions: defaultPermissions(input.type), source, tags: [], uses: 0,
  };
  const workerId = input.workerId ?? base.workerId;
  const category = input.category !== undefined ? slug(input.category, 40) : base.category;
  const candidate: KnowledgeNode = {
    ...base, confidence: input.confidence ?? base.confidence, importance: input.importance ?? base.importance,
    permissions: input.permissions ? mergePermissions(base.permissions, input.permissions) : base.permissions, tags: input.tags ? normalizeTags(input.tags) : base.tags,
    ...(workerId !== undefined ? { workerId } : {}), ...(category !== undefined ? { category } : {}),
  };
  if (!existing) return { node: candidate, created: true, changed: true };
  if (withoutStamp(candidate) === withoutStamp(existing)) return { node: existing, created: false, changed: false };
  return { node: { ...candidate, updatedAt: at }, created: false, changed: true };
}
