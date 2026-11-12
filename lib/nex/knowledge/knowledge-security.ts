// Knowledge Security: who may see and change what. The company is checked FIRST and alone: another company's node or edge does not exist for the asker. An edge is visible only if BOTH of its
// ends are, so a restricted node never leaks through a relation. Level 3 (ADR-0009): a worker or the system prepares; only a person approves or rejects.

import { ROLE_RANK, type KnowledgeEdge, type KnowledgeNode, type NodeType, type Principal, type Relation, type Role } from "./knowledge-types";

const PRIVATE_KEY_HEADER = new RegExp("-----BEGIN " + "[A-Z ]*PRIVATE KEY");
const SENSITIVE: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\b(?:ghp|gho|ghs|xox[baprs])[-_][A-Za-z0-9-]{10,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /\bsecret:[A-Za-z0-9_-]+/,
  PRIVATE_KEY_HEADER,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, // an address: a node refers to someone by an opaque id, never by their address
  /\b(?:password|passwd|token|secret|api[_ -]?key|cookie|authorization)\b\s*[:=]/i,
];
/** A reference, a category or a tag must be an identifier, never a credential or a contact detail. */
export const looksSensitive = (text: string): boolean => SENSITIVE.some((pattern) => pattern.test(text));

/** lower case, no accents, letters, digits and dashes only */
export const slug = (value: string, max = 32): string => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");

const atLeast = (principal: Principal, role: Role): boolean => principal.kind === "person" && ROLE_RANK[principal.role] >= ROLE_RANK[role];
const isOwnerOf = (principal: Principal, node: KnowledgeNode): boolean => principal.kind === "worker" && node.workerId === principal.id;

/** Reading a node. The company first; then visibility, role, worker and user. */
export function canReadNode(principal: Principal, node: KnowledgeNode): boolean {
  if (principal.tenantId !== node.tenantId) return false;
  const { permissions } = node;
  if (principal.kind === "system") return permissions.visibility !== "private";
  if (permissions.visibility === "private") return principal.kind === "person" && permissions.userIds.includes(principal.id);
  if (principal.kind === "worker") {
    if (permissions.visibility === "restricted") return permissions.workerIds.includes(principal.id) || isOwnerOf(principal, node);
    if (node.workerId && node.workerId !== principal.id && !permissions.workerIds.includes(principal.id)) return false; // a worker's own knowledge is that worker's
    return true;
  }
  if (atLeast(principal, "admin")) return true; // administrators see everything that is not private
  if (permissions.visibility === "restricted") return permissions.roles.includes(principal.role) || permissions.userIds.includes(principal.id);
  return ROLE_RANK[principal.role] >= ROLE_RANK[permissions.minRole];
}
/** An edge is visible when it is of this company and both ends are visible. */
export const canReadEdge = (principal: Principal, edge: KnowledgeEdge, from: KnowledgeNode | undefined, to: KnowledgeNode | undefined): boolean =>
  principal.tenantId === edge.tenantId && from !== undefined && to !== undefined && canReadNode(principal, from) && canReadNode(principal, to);

/** Creating or changing nodes. Only administrators and the system touch the company node. */
export function canWriteNode(principal: Principal, type: NodeType): boolean {
  if (type === "company") return principal.kind === "system" || atLeast(principal, "admin");
  if (principal.kind === "person") return ROLE_RANK[principal.role] >= ROLE_RANK.member;
  return true;
}
/** Linking. Approving and rejecting are decisions, and only people decide. */
export function canLink(principal: Principal, relation: Relation): boolean {
  if (relation === "approved" || relation === "rejected") return atLeast(principal, "member");
  if (principal.kind === "person") return ROLE_RANK[principal.role] >= ROLE_RANK.member;
  return true;
}
export const canRemove = (principal: Principal): boolean => principal.kind === "system" || atLeast(principal, "manager");
export const canBuild = (principal: Principal): boolean => principal.kind === "system" || atLeast(principal, "admin");
