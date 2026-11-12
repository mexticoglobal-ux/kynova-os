// Google Drive, through the one Google client: search and read files, create folders, upload, move and share. With the minimal scopes of the connector (read-only, plus `drive.file`) it reads
// anything but only creates, moves and shares what KYNOVA itself created: Google enforces it, and an operation outside it comes back as a scope error, never as a silent success.

import { GOOGLE_ENDPOINTS, GoogleApiError, base64Url, googleRequest, type GoogleDeps } from "./core";

const D = GOOGLE_ENDPOINTS.drive;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // the simple multipart upload; larger files need the resumable one (a later step)
export const FOLDER_MIME = "application/vnd.google-apps.folder";
const invalid = (what: string) => new GoogleApiError("invalid", `Dato no válido: ${what}.`);
const safeId = (value: string, what: string) => { if (!ID.test(value)) throw invalid(what); return value; };
/** A string literal for Drive's query language: quotes and backslashes escaped, so a name can never change the query. */
export const driveQuote = (value: string): string => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;

export type DriveFile = { id: string; name: string; mimeType: string; parents?: string[]; modifiedTime?: string; size?: string; webViewLink?: string };
const FIELDS = "id,name,mimeType,parents,modifiedTime,size,webViewLink";

export async function searchFiles(deps: GoogleDeps, tokenRef: string, input: { nameContains?: string; mimeType?: string; parentId?: string; pageSize?: number; pageToken?: string }): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const parts = ["trashed = false"];
  if (input.nameContains) { if (input.nameContains.length > 200) throw invalid("búsqueda"); parts.push(`name contains ${driveQuote(input.nameContains)}`); }
  if (input.mimeType) { if (!/^[\w.+-]+\/[\w.+-]+$/.test(input.mimeType)) throw invalid("tipo"); parts.push(`mimeType = ${driveQuote(input.mimeType)}`); }
  if (input.parentId) parts.push(`${driveQuote(safeId(input.parentId, "carpeta"))} in parents`);
  const result = await googleRequest<{ files?: DriveFile[]; nextPageToken?: string }>(deps, tokenRef, { url: `${D}/files`, query: { q: parts.join(" and "), fields: `files(${FIELDS}),nextPageToken`, pageSize: Math.min(Math.max(input.pageSize ?? 25, 1), 100), ...(input.pageToken ? { pageToken: input.pageToken } : {}), orderBy: "modifiedTime desc" } });
  return { files: result.files ?? [], ...(result.nextPageToken ? { nextPageToken: result.nextPageToken } : {}) };
}
export async function getFile(deps: GoogleDeps, tokenRef: string, input: { fileId: string }): Promise<DriveFile> {
  return googleRequest(deps, tokenRef, { url: `${D}/files/${safeId(input.fileId, "archivo")}`, query: { fields: FIELDS } });
}
export async function createFolder(deps: GoogleDeps, tokenRef: string, input: { name: string; parentId?: string }): Promise<DriveFile> {
  if (input.name.trim() === "" || input.name.length > 200) throw invalid("nombre");
  return googleRequest(deps, tokenRef, { method: "POST", url: `${D}/files`, query: { fields: FIELDS }, json: { name: input.name.trim(), mimeType: FOLDER_MIME, ...(input.parentId ? { parents: [safeId(input.parentId, "carpeta")] } : {}) } });
}
/** Uploads a file (metadata and content in one multipart request). The content is base64 so it travels as text and is never logged. */
export async function uploadFile(deps: GoogleDeps, tokenRef: string, input: { name: string; mimeType: string; dataBase64: string; parentId?: string }): Promise<DriveFile> {
  if (input.name.trim() === "" || input.name.length > 200 || !/^[\w.+-]+\/[\w.+-]+$/.test(input.mimeType) || !/^[A-Za-z0-9+/=\s]*$/.test(input.dataBase64)) throw invalid("archivo");
  const data = input.dataBase64.replace(/\s/g, "");
  if (Math.floor((data.length * 3) / 4) > MAX_UPLOAD_BYTES) throw invalid("tamaño del archivo");
  const boundary = `kynova_${base64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
  const metadata = JSON.stringify({ name: input.name.trim(), ...(input.parentId ? { parents: [safeId(input.parentId, "carpeta")] } : {}) });
  const rawBody = [`--${boundary}`, "Content-Type: application/json; charset=UTF-8", "", metadata, `--${boundary}`, `Content-Type: ${input.mimeType}`, "Content-Transfer-Encoding: base64", "", data, `--${boundary}--`].join("\r\n");
  return googleRequest(deps, tokenRef, { method: "POST", url: `${GOOGLE_ENDPOINTS.driveUpload}/files`, query: { uploadType: "multipart", fields: FIELDS }, rawBody, headers: { "content-type": `multipart/related; boundary=${boundary}` } });
}
/** Moves a file to another folder: reads its current parents and swaps them in one update. */
export async function moveFile(deps: GoogleDeps, tokenRef: string, input: { fileId: string; toFolderId: string }): Promise<DriveFile> {
  const current = await getFile(deps, tokenRef, { fileId: input.fileId });
  return googleRequest(deps, tokenRef, { method: "PATCH", url: `${D}/files/${safeId(input.fileId, "archivo")}`, query: { addParents: safeId(input.toFolderId, "carpeta"), ...(current.parents?.length ? { removeParents: current.parents.join(",") } : {}), fields: FIELDS } });
}
export type ShareRole = "reader" | "commenter" | "writer";
/** Shares with ONE person by address, never with "anyone": a public link is not something a Worker can create. The owner role cannot be given. */
export async function shareFile(deps: GoogleDeps, tokenRef: string, input: { fileId: string; email: string; role: ShareRole; notify?: boolean }): Promise<{ id: string; role: string }> {
  if (!EMAIL.test(input.email.trim()) || !(["reader", "commenter", "writer"] as const).includes(input.role)) throw invalid("permiso");
  return googleRequest(deps, tokenRef, { method: "POST", url: `${D}/files/${safeId(input.fileId, "archivo")}/permissions`, query: { sendNotificationEmail: input.notify ?? false }, json: { type: "user", role: input.role, emailAddress: input.email.trim() } });
}
/** The account's address: the identity of the connection. */
export async function driveIdentity(deps: GoogleDeps, tokenRef: string): Promise<{ user: { emailAddress: string; permissionId?: string } }> {
  return googleRequest(deps, tokenRef, { url: `${D}/about`, query: { fields: "user(emailAddress,permissionId)" } });
}
