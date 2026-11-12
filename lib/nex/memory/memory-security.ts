// Memory Security: what may NEVER be remembered (secrets, prompts, whole conversations, restricted personal data, attempts to change the rules) and who may read or change a memory
// (company, person, worker, role). The company check always comes first: a memory of another company does not exist for the asker.

import { ROLE_RANK, type Memory, type MemoryType, type Principal, type Refusal, type Role } from "./memory-types";

type Reason = Extract<Refusal, "secret" | "restricted" | "prompt" | "transcript" | "rules">;
const PRIORITY: readonly Reason[] = ["secret", "restricted", "prompt", "transcript", "rules"];

const PRIVATE_KEY_HEADER = new RegExp("-----BEGIN " + "[A-Z ]*PRIVATE KEY");
const SECRETS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/, // a JWT
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/, // a payment or API key
  /\bAKIA[0-9A-Z]{16}\b/, // an AWS key id
  /\bsb_(?:secret|publishable)_/, // a Supabase key
  /\b(?:ghp|gho|ghs|xox[baprs])[-_][A-Za-z0-9-]{10,}/, // a code host or chat token
  PRIVATE_KEY_HEADER,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
  /\b(?:api[_ -]?key|secret|token|password|passwd|contraseña|credential|credentials|credencial|credenciales|cookie|authorization|client[_ ]secret|refresh[_ ]token|access[_ ]token|clave)\b\s*(?:[:=]|es|is)\s*\S{6,}/i,
  /\b(?:set-cookie|cookie)\s*:/i,
  /[?&](?:code|state|access_token|refresh_token|id_token)=[A-Za-z0-9._~-]{6,}/i, // an OAuth callback
  /\bsecret:[A-Za-z0-9_-]+/, // a reference into the vault
  /\b[A-Za-z0-9_-]{40,}\b/, // one long unbroken string looks like a key
];
const PROMPTS: readonly RegExp[] = [
  /\b(?:system prompt|prompt del sistema|developer message|mensaje del sistema|mensaje de sistema)\b/i,
  /<\|?(?:system|assistant|user|im_start|im_end)\|?>/i,
  /\b(?:ignore|ignora|olvida|disregard|forget)\b.{0,30}\b(?:previous|prior|above|anteriores|previas|instrucciones|instructions)\b/i,
  /^\s*(?:system|assistant|developer)\s*:/im,
  /\[INST\]|###\s*(?:instruction|system)/i,
  /\byou are (?:a|an|now)\b/i,
  /\beres (?:un|una) (?:asistente|ia|modelo)\b/i,
];
const RESTRICTED: readonly RegExp[] = [
  /\b\d{3}-\d{2}-\d{4}\b/, // a US social security number
  /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/, // an IBAN
  /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/, // a Mexican CURP
  /\b(?:historial médico|historial medico|medical record|expediente clínico|expediente clinico)\b/i,
];
const TRANSCRIPT_LINE = /^\s*(?:user|usuario|cliente|customer|nex|assistant|asistente|bot|human|humano|agent|agente)\s*[:>]/gim;
const RULE_CHANGES: readonly RegExp[] = [
  /\b(?:desactiva|desactivar|disable|turn off|bypass|salta|saltar|skip|omite|omitir|override|anula|anular)\b.{0,40}\b(?:regla|reglas|rule|rules|aprobaci[oó]n|approval|seguridad|security|permiso|permisos|permission|permissions|rls|tenant|límite|limite|limit)/i,
  /\bsin (?:pedir )?aprobaci[oó]n\b/i,
  /\bwithout (?:asking for )?approval\b/i,
  /\bautonom[ií]a (?:total|completa)\b/i,
  /\b(?:siempre|always) (?:env[ií]a|enviar|send|paga|pagar|pay|borra|borrar|delete)\b/i,
];

/** Digit runs of 13–19 that pass the Luhn check are card numbers. */
function hasCardNumber(text: string): boolean {
  for (const run of text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? []) {
    const digits = run.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) continue;
    let sum = 0;
    for (let index = 0; index < digits.length; index += 1) {
      let digit = Number(digits[digits.length - 1 - index]);
      if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
      sum += digit;
    }
    if (sum % 10 === 0) return true;
  }
  return false;
}

/** Looks at a text BEFORE anything is kept. Nothing is redacted and stored: a text that fails is refused whole. */
export function screenText(text: string, options: { learning?: boolean } = {}): { ok: boolean; reasons: readonly Reason[]; primary?: Reason } {
  const found = new Set<Reason>();
  if (SECRETS.some((pattern) => pattern.test(text))) found.add("secret");
  if (PROMPTS.some((pattern) => pattern.test(text))) found.add("prompt");
  if (hasCardNumber(text) || RESTRICTED.some((pattern) => pattern.test(text))) found.add("restricted");
  if ((text.match(TRANSCRIPT_LINE) ?? []).length >= 2 || (text.match(/\[\d{1,2}:\d{2}(?::\d{2})?\]/g) ?? []).length >= 2) found.add("transcript");
  if (options.learning && RULE_CHANGES.some((pattern) => pattern.test(text))) found.add("rules");
  const reasons = PRIORITY.filter((reason) => found.has(reason));
  return { ok: reasons.length === 0, reasons, ...(reasons[0] ? { primary: reasons[0] } : {}) };
}

/** What may stay in a summary: contact details are replaced by a marker (the customer is referred to by an opaque reference, not by an address). */
export function maskPersonal(text: string): string {
  return text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[correo]").replace(/\+?\d[\d\s().-]{8,}\d/g, "[teléfono]");
}

/** lower case, no accents, letters, digits and dashes only */
export const slug = (value: string, max = 32): string => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, max).replace(/-+$/g, "");

// ---------------------------------------------------------------------------------------------- who may do what
const atLeast = (principal: Principal, role: Role): boolean => principal.kind === "person" && ROLE_RANK[principal.role] >= ROLE_RANK[role];
const isOwnerOf = (principal: Principal, memory: Memory): boolean => principal.kind !== "system" ? memory.createdBy.kind === principal.kind && memory.createdBy.id === principal.id : memory.createdBy.kind === "system";

/** Reading. The company is checked first and alone decides the rest: another company's memory is simply not there. */
export function canRead(principal: Principal, memory: Memory): boolean {
  if (principal.tenantId !== memory.tenantId) return false;
  const { permissions } = memory;
  if (principal.kind === "system") return permissions.visibility !== "private" || isOwnerOf(principal, memory);
  if (permissions.visibility === "private") return isOwnerOf(principal, memory);
  if (principal.kind === "worker") {
    if (permissions.visibility === "restricted") return permissions.workerIds.includes(principal.id) || isOwnerOf(principal, memory);
    // a worker's own memories are for that worker (and the people), unless it opens them to others
    if (memory.workerId && memory.workerId !== principal.id && !permissions.workerIds.includes(principal.id)) return false;
    return true;
  }
  if (atLeast(principal, "admin")) return true;
  if (permissions.visibility === "restricted") return permissions.roles.includes(principal.role) || permissions.userIds.includes(principal.id) || isOwnerOf(principal, memory);
  return ROLE_RANK[principal.role] >= ROLE_RANK[permissions.minRole];
}

/** Creating. Only the system writes System Memory; a viewer cannot write; decisions need a manager (a worker's record of a decision is a proposal, see the engine). */
export function canCreate(principal: Principal, type: MemoryType): boolean {
  if (type === "system") return principal.kind === "system";
  if (principal.kind === "person") return ROLE_RANK[principal.role] >= (type === "decision" ? ROLE_RANK.manager : ROLE_RANK.member);
  return true;
}
/** Archiving, restoring and deleting: a manager or above, or the person who wrote it. Workers and the system never decide that. */
export const canManage = (principal: Principal, memory: Memory): boolean => principal.tenantId === memory.tenantId && principal.kind === "person" && (atLeast(principal, "manager") || isOwnerOf(principal, memory));
/** Pinning, permissions and confirming learned knowledge. */
export const canAdminister = (principal: Principal): boolean => atLeast(principal, "admin");
export const canConfirm = (principal: Principal): boolean => atLeast(principal, "manager");
export const canSweep = (principal: Principal): boolean => principal.kind === "system" || atLeast(principal, "admin");
export const canVote = (principal: Principal): boolean => principal.kind === "system" || atLeast(principal, "member");
