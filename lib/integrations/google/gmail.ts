// Gmail, through the one Google client: read, search, attachments, labels, send, reply and drafts. Every function takes the connection's token reference: it never sees a token. The
// messages it builds are RFC 2822 with every header checked for line breaks (no header injection) and every address validated. Callers are Workers' operations, never an AI agent.

import { GOOGLE_ENDPOINTS, GoogleApiError, base64, base64Url, decodeUtf8, fromBase64Url, googleRequest, utf8, type GoogleDeps } from "./core";

const G = GOOGLE_ENDPOINTS.gmail;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const MAX_RECIPIENTS = 50;
export const MAX_MESSAGE_BYTES = 15 * 1024 * 1024; // Gmail sends up to 25 MB once encoded: this keeps a safe margin

const invalid = (what: string) => new GoogleApiError("invalid", `Dato no válido: ${what}.`);
const safeId = (value: string, what: string) => { if (!ID.test(value)) throw invalid(what); return value; };
const safeHeader = (value: string, what: string) => { if (/[\r\n\0]/.test(value)) throw invalid(what); return value; };
const addresses = (list: readonly string[] | undefined, what: string): string[] => {
  const out = (list ?? []).map((item) => item.trim());
  if (out.some((item) => !EMAIL.test(item))) throw invalid(what);
  return out;
};
const encodeWord = (text: string) => (/^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${base64(utf8(text))}?=`);
const fold = (encoded: string) => encoded.replace(/.{1,76}/g, "$&\r\n").trimEnd();

export type Attachment = { filename: string; mimeType: string; dataBase64: string };
export type OutgoingMessage = { to: readonly string[]; cc?: readonly string[]; bcc?: readonly string[]; subject: string; text: string; inReplyTo?: string; references?: string; attachments?: readonly Attachment[] };

/** Builds the raw message (base64url, as Gmail wants it). Plain text, or multipart with attachments. */
export function buildRawMessage(message: OutgoingMessage): string {
  const to = addresses(message.to, "destinatarios");
  if (to.length === 0 || to.length + (message.cc?.length ?? 0) + (message.bcc?.length ?? 0) > MAX_RECIPIENTS) throw invalid("destinatarios");
  const headers = [
    `To: ${to.join(", ")}`, ...(message.cc?.length ? [`Cc: ${addresses(message.cc, "copia").join(", ")}`] : []), ...(message.bcc?.length ? [`Bcc: ${addresses(message.bcc, "copia oculta").join(", ")}`] : []),
    `Subject: ${encodeWord(safeHeader(message.subject, "asunto"))}`, "MIME-Version: 1.0",
    ...(message.inReplyTo ? [`In-Reply-To: ${safeHeader(message.inReplyTo, "respuesta")}`] : []), ...(message.references ? [`References: ${safeHeader(message.references, "referencias")}`] : []),
  ];
  const text = fold(base64(utf8(message.text)));
  const attachments = message.attachments ?? [];
  let raw: string;
  if (attachments.length === 0) raw = [...headers, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", text].join("\r\n");
  else {
    const boundary = `kynova_${base64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
    const parts = [`--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", text];
    for (const file of attachments) {
      const name = safeHeader(file.filename, "nombre del adjunto").replace(/"/g, "");
      if (!/^[\w.+-]+\/[\w.+-]+$/.test(file.mimeType) || !/^[A-Za-z0-9+/=\s]*$/.test(file.dataBase64)) throw invalid("adjunto");
      parts.push(`--${boundary}`, `Content-Type: ${file.mimeType}; name="${encodeWord(name)}"`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${encodeWord(name)}"`, "", fold(file.dataBase64.replace(/\s/g, "")));
    }
    parts.push(`--${boundary}--`);
    raw = [...headers, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
  }
  if (raw.length > MAX_MESSAGE_BYTES) throw invalid("tamaño del mensaje");
  return base64Url(utf8(raw));
}

export type MessageSummary = { id: string; threadId: string; labelIds: readonly string[]; internalDate: string; from: string; to: string; subject: string; date: string; messageId: string; attachments: readonly { filename: string; mimeType: string; size: number; attachmentId: string }[]; text?: string };
type GmailPart = { filename?: string; mimeType?: string; body?: { attachmentId?: string; size?: number; data?: string }; parts?: GmailPart[]; headers?: { name: string; value: string }[] };
type GmailMessage = { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart };
const headerOf = (message: GmailMessage, name: string) => message.payload?.headers?.find((row) => row.name.toLowerCase() === name.toLowerCase())?.value ?? "";
function walk(part: GmailPart | undefined, visit: (part: GmailPart) => void) { if (!part) return; visit(part); for (const child of part.parts ?? []) walk(child, visit); }
function summarize(message: GmailMessage, withText: boolean): MessageSummary {
  const attachments: MessageSummary["attachments"][number][] = [];
  let text = "";
  walk(message.payload, (part) => {
    if (part.filename && part.body?.attachmentId) attachments.push({ filename: part.filename, mimeType: part.mimeType ?? "application/octet-stream", size: part.body.size ?? 0, attachmentId: part.body.attachmentId });
    else if (withText && part.mimeType === "text/plain" && part.body?.data && !text) text = decodeUtf8(fromBase64Url(part.body.data));
  });
  return { id: message.id, threadId: message.threadId, labelIds: message.labelIds ?? [], internalDate: message.internalDate ?? "", from: headerOf(message, "From"), to: headerOf(message, "To"), subject: headerOf(message, "Subject"), date: headerOf(message, "Date"), messageId: headerOf(message, "Message-ID"), attachments, ...(withText ? { text } : {}) };
}

/** The account's address: the identity of the connection, which belongs to ONE company. */
export async function profile(deps: GoogleDeps, tokenRef: string): Promise<{ emailAddress: string; messagesTotal: number; historyId: string }> {
  return googleRequest(deps, tokenRef, { url: `${G}/users/me/profile` });
}
/** Searches with Gmail's own query language (`from:`, `is:unread`, `has:attachment`...). Returns ids only; reading each message is a separate, explicit operation. */
export async function searchMessages(deps: GoogleDeps, tokenRef: string, input: { query: string; maxResults?: number; labelIds?: readonly string[] }): Promise<{ messages: { id: string; threadId: string }[]; nextPageToken?: string }> {
  if (input.query.length > 500) throw invalid("búsqueda");
  const max = Math.min(Math.max(input.maxResults ?? 20, 1), 100);
  const result = await googleRequest<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(deps, tokenRef, { url: `${G}/users/me/messages`, query: { q: input.query, maxResults: max, ...(input.labelIds?.length ? { labelIds: input.labelIds.join(",") } : {}) } });
  return { messages: result.messages ?? [], ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}) };
}
/** Reads one message: headers, attachment list and, when asked, the plain-text body. The content goes back to the caller and is kept nowhere. */
export async function readMessage(deps: GoogleDeps, tokenRef: string, input: { id: string; withText?: boolean }): Promise<MessageSummary> {
  const message = await googleRequest<GmailMessage>(deps, tokenRef, { url: `${G}/users/me/messages/${safeId(input.id, "mensaje")}`, query: { format: "full" } });
  return summarize(message, input.withText ?? false);
}
export async function getAttachment(deps: GoogleDeps, tokenRef: string, input: { messageId: string; attachmentId: string }): Promise<{ size: number; dataBase64: string }> {
  const result = await googleRequest<{ size: number; data: string }>(deps, tokenRef, { url: `${G}/users/me/messages/${safeId(input.messageId, "mensaje")}/attachments/${safeId(input.attachmentId, "adjunto")}` });
  return { size: result.size, dataBase64: base64(fromBase64Url(result.data)) };
}
export async function listLabels(deps: GoogleDeps, tokenRef: string): Promise<{ id: string; name: string; type: string }[]> {
  return (await googleRequest<{ labels?: { id: string; name: string; type: string }[] }>(deps, tokenRef, { url: `${G}/users/me/labels` })).labels ?? [];
}
export async function sendMessage(deps: GoogleDeps, tokenRef: string, message: OutgoingMessage & { threadId?: string }): Promise<{ id: string; threadId: string }> {
  return googleRequest(deps, tokenRef, { method: "POST", url: `${G}/users/me/messages/send`, json: { raw: buildRawMessage(message), ...(message.threadId ? { threadId: safeId(message.threadId, "hilo") } : {}) } });
}
/** Replies inside the thread of an existing message: it reads the original's headers (Message-ID, References, Subject) so the reply threads correctly in every client. */
export async function replyToMessage(deps: GoogleDeps, tokenRef: string, input: { messageId: string; text: string; cc?: readonly string[]; attachments?: readonly Attachment[] }): Promise<{ id: string; threadId: string }> {
  const original = await googleRequest<GmailMessage>(deps, tokenRef, { url: `${G}/users/me/messages/${safeId(input.messageId, "mensaje")}`, query: { format: "metadata", metadataHeaders: "Message-ID,References,Subject,From,Reply-To" } });
  const replyTo = (headerOf(original, "Reply-To") || headerOf(original, "From")).match(/<([^>]+)>|([^\s<>]+@[^\s<>]+)/);
  const to = replyTo?.[1] ?? replyTo?.[2];
  if (!to) throw invalid("remitente original");
  const subject = headerOf(original, "Subject");
  const messageId = headerOf(original, "Message-ID");
  return sendMessage(deps, tokenRef, {
    to: [to], ...(input.cc ? { cc: input.cc } : {}), subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`, text: input.text, ...(messageId ? { inReplyTo: messageId, references: `${headerOf(original, "References")} ${messageId}`.trim() } : {}),
    ...(input.attachments ? { attachments: input.attachments } : {}), threadId: original.threadId,
  });
}
export async function createDraft(deps: GoogleDeps, tokenRef: string, message: OutgoingMessage & { threadId?: string }): Promise<{ id: string; message: { id: string; threadId: string } }> {
  return googleRequest(deps, tokenRef, { method: "POST", url: `${G}/users/me/drafts`, json: { message: { raw: buildRawMessage(message), ...(message.threadId ? { threadId: safeId(message.threadId, "hilo") } : {}) } } });
}
export async function createLabel(deps: GoogleDeps, tokenRef: string, input: { name: string }): Promise<{ id: string; name: string }> {
  if (input.name.trim().length < 1 || input.name.length > 100) throw invalid("etiqueta");
  return googleRequest(deps, tokenRef, { method: "POST", url: `${G}/users/me/labels`, json: { name: input.name.trim(), labelListVisibility: "labelShow", messageListVisibility: "show" } });
}
export async function modifyLabels(deps: GoogleDeps, tokenRef: string, input: { messageId: string; add?: readonly string[]; remove?: readonly string[] }): Promise<{ id: string; labelIds: string[] }> {
  return googleRequest(deps, tokenRef, { method: "POST", url: `${G}/users/me/messages/${safeId(input.messageId, "mensaje")}/modify`, json: { addLabelIds: (input.add ?? []).map((item) => safeId(item, "etiqueta")), removeLabelIds: (input.remove ?? []).map((item) => safeId(item, "etiqueta")) } });
}
