// The operations a Worker can ask of Google Workspace, one catalog. Each declares which connector scope covers it (so the Connectors architecture's permission and approval rules apply
// unchanged), what Google scope it truly needs, and how it runs. The scopes are the MINIMUM: an operation that Sprint 40's manifest does not authorize (drafts, label changes) is listed as
// unavailable and comes back as a scope error instead of asking for a wider scope on its own.

import { CONNECTORS, type ConnectorId } from "@/lib/contracts/platform/connectors";
import * as calendar from "./calendar";
import type { GoogleDeps } from "./core";
import * as drive from "./drive";
import * as gmail from "./gmail";

const GMAIL = "https://www.googleapis.com/auth/gmail";
const CAL = "https://www.googleapis.com/auth/calendar";
const DRV = "https://www.googleapis.com/auth/drive";
export const GOOGLE_SCOPES = {
  gmailReadonly: `${GMAIL}.readonly`, gmailSend: `${GMAIL}.send`, gmailCompose: `${GMAIL}.compose`, gmailModify: `${GMAIL}.modify`,
  calendarReadonly: `${CAL}.readonly`, calendarEvents: `${CAL}.events`, driveReadonly: `${DRV}.readonly`, driveFile: `${DRV}.file`, drive: DRV,
} as const;

export const GOOGLE_OPERATION_IDS = [
  "gmail.profile", "gmail.search", "gmail.read", "gmail.attachment", "gmail.listLabels", "gmail.send", "gmail.reply", "gmail.createDraft", "gmail.createLabel", "gmail.modifyLabels",
  "calendar.list", "calendar.freeBusy", "calendar.availability", "calendar.create", "calendar.update", "calendar.cancel",
  "drive.search", "drive.get", "drive.createFolder", "drive.upload", "drive.move", "drive.share",
] as const;
export type GoogleOperationId = (typeof GOOGLE_OPERATION_IDS)[number];
export type Params = Record<string, unknown>;
export type GoogleOperation = {
  id: GoogleOperationId; connectorId: ConnectorId; /** the connector scope id that covers it (read: automatic once granted; write: always waits for a person) */ scopeId: string; effect: "read" | "write";
  label: string; /** any ONE of these Google scopes is enough */ google: readonly string[]; run: (deps: GoogleDeps, tokenRef: string, params: Params) => Promise<unknown>;
};
const op = (id: GoogleOperationId, connectorId: ConnectorId, scopeId: string, label: string, google: readonly string[], run: GoogleOperation["run"]): GoogleOperation =>
  ({ id, connectorId, scopeId, effect: CONNECTORS[connectorId].scopes.find((row) => row.id === scopeId)?.effect ?? "write", label, google, run });
const READ_MAIL = [GOOGLE_SCOPES.gmailReadonly, GOOGLE_SCOPES.gmailModify];

export const GOOGLE_OPERATIONS: Record<GoogleOperationId, GoogleOperation> = {
  "gmail.profile": op("gmail.profile", "gmail", "readMail", "Ver la cuenta de correo", READ_MAIL, (d, r) => gmail.profile(d, r)),
  "gmail.search": op("gmail.search", "gmail", "readMail", "Buscar correos", READ_MAIL, (d, r, p) => gmail.searchMessages(d, r, p as never)),
  "gmail.read": op("gmail.read", "gmail", "readMail", "Leer un correo", READ_MAIL, (d, r, p) => gmail.readMessage(d, r, p as never)),
  "gmail.attachment": op("gmail.attachment", "gmail", "readMail", "Descargar un adjunto", READ_MAIL, (d, r, p) => gmail.getAttachment(d, r, p as never)),
  "gmail.listLabels": op("gmail.listLabels", "gmail", "readMail", "Ver las etiquetas", READ_MAIL, (d, r) => gmail.listLabels(d, r)),
  "gmail.send": op("gmail.send", "gmail", "sendMail", "Enviar un correo", [GOOGLE_SCOPES.gmailSend, GOOGLE_SCOPES.gmailCompose, GOOGLE_SCOPES.gmailModify], (d, r, p) => gmail.sendMessage(d, r, p as never)),
  "gmail.reply": op("gmail.reply", "gmail", "sendMail", "Responder un correo", [GOOGLE_SCOPES.gmailSend, GOOGLE_SCOPES.gmailCompose, GOOGLE_SCOPES.gmailModify], (d, r, p) => gmail.replyToMessage(d, r, p as never)),
  // Google needs `gmail.compose` or `gmail.modify` for these, and Sprint 40's manifest asks for neither: unavailable until that manifest is widened with approval
  "gmail.createDraft": op("gmail.createDraft", "gmail", "sendMail", "Crear un borrador", [GOOGLE_SCOPES.gmailCompose, GOOGLE_SCOPES.gmailModify], (d, r, p) => gmail.createDraft(d, r, p as never)),
  "gmail.createLabel": op("gmail.createLabel", "gmail", "sendMail", "Crear una etiqueta", [GOOGLE_SCOPES.gmailModify], (d, r, p) => gmail.createLabel(d, r, p as never)),
  "gmail.modifyLabels": op("gmail.modifyLabels", "gmail", "sendMail", "Poner o quitar etiquetas", [GOOGLE_SCOPES.gmailModify], (d, r, p) => gmail.modifyLabels(d, r, p as never)),
  "calendar.list": op("calendar.list", "googleCalendar", "readEvents", "Ver eventos", [GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents], (d, r, p) => calendar.listEvents(d, r, p as never)),
  "calendar.freeBusy": op("calendar.freeBusy", "googleCalendar", "readEvents", "Ver disponibilidad", [GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents], (d, r, p) => calendar.freeBusy(d, r, p as never)),
  "calendar.availability": op("calendar.availability", "googleCalendar", "readEvents", "Proponer horarios libres", [GOOGLE_SCOPES.calendarReadonly, GOOGLE_SCOPES.calendarEvents], async (d, r, p) => {
    const input = p as { timeMin: string; timeMax: string; minutes: number; calendars?: readonly string[] };
    const busy = await calendar.freeBusy(d, r, { timeMin: input.timeMin, timeMax: input.timeMax, ...(input.calendars ? { calendars: input.calendars } : {}) });
    return calendar.findFreeSlots(Object.values(busy).flat(), { start: input.timeMin, end: input.timeMax }, input.minutes);
  }),
  "calendar.create": op("calendar.create", "googleCalendar", "writeEvents", "Crear un evento", [GOOGLE_SCOPES.calendarEvents], (d, r, p) => calendar.createEvent(d, r, p as never)),
  "calendar.update": op("calendar.update", "googleCalendar", "writeEvents", "Cambiar un evento", [GOOGLE_SCOPES.calendarEvents], (d, r, p) => calendar.updateEvent(d, r, p as never)),
  "calendar.cancel": op("calendar.cancel", "googleCalendar", "writeEvents", "Cancelar un evento", [GOOGLE_SCOPES.calendarEvents], (d, r, p) => calendar.cancelEvent(d, r, p as never)),
  "drive.search": op("drive.search", "googleDrive", "readFiles", "Buscar archivos", [GOOGLE_SCOPES.driveReadonly, GOOGLE_SCOPES.drive], (d, r, p) => drive.searchFiles(d, r, p as never)),
  "drive.get": op("drive.get", "googleDrive", "readFiles", "Ver un archivo", [GOOGLE_SCOPES.driveReadonly, GOOGLE_SCOPES.drive], (d, r, p) => drive.getFile(d, r, p as never)),
  "drive.createFolder": op("drive.createFolder", "googleDrive", "writeFiles", "Crear una carpeta", [GOOGLE_SCOPES.driveFile, GOOGLE_SCOPES.drive], (d, r, p) => drive.createFolder(d, r, p as never)),
  "drive.upload": op("drive.upload", "googleDrive", "writeFiles", "Subir un archivo", [GOOGLE_SCOPES.driveFile, GOOGLE_SCOPES.drive], (d, r, p) => drive.uploadFile(d, r, p as never)),
  "drive.move": op("drive.move", "googleDrive", "writeFiles", "Mover un archivo", [GOOGLE_SCOPES.driveFile, GOOGLE_SCOPES.drive], (d, r, p) => drive.moveFile(d, r, p as never)),
  "drive.share": op("drive.share", "googleDrive", "writeFiles", "Compartir un archivo", [GOOGLE_SCOPES.driveFile, GOOGLE_SCOPES.drive], (d, r, p) => drive.shareFile(d, r, p as never)),
};
export const operationById = (id: string): GoogleOperation | undefined => (GOOGLE_OPERATION_IDS as readonly string[]).includes(id) ? GOOGLE_OPERATIONS[id as GoogleOperationId] : undefined;

/** The Google scopes a connector's manifest asks for, in Google's own words. */
export const manifestGoogleScopes = (connectorId: ConnectorId): string[] => CONNECTORS[connectorId].scopes.map((scope) => scope.oauth);
/** Which operations the manifest (Sprint 40) can authorize at all, and which need a wider Google scope than it requests. */
export function authorizableOperations(): { available: GoogleOperationId[]; needsWiderScope: GoogleOperationId[] } {
  const available: GoogleOperationId[] = [];
  const needsWiderScope: GoogleOperationId[] = [];
  for (const id of GOOGLE_OPERATION_IDS) {
    const operation = GOOGLE_OPERATIONS[id];
    (operation.google.some((scope) => manifestGoogleScopes(operation.connectorId).includes(scope)) ? available : needsWiderScope).push(id);
  }
  return { available, needsWiderScope };
}
/** The least connector scopes that cover a set of operations: asking for more than a company needs is never done by default. */
export function minimalScopeIds(operations: readonly GoogleOperationId[]): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const id of operations) { const operation = GOOGLE_OPERATIONS[id]; (out[operation.connectorId] ??= new Set()).add(operation.scopeId); }
  return Object.fromEntries(Object.entries(out).map(([connector, scopes]) => [connector, [...scopes]]));
}
