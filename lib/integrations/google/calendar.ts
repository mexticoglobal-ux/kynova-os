// Google Calendar, through the one Google client: read events, create, update, cancel, guests and availability. Times are RFC 3339, guests are validated addresses and every id is checked.

import { GOOGLE_ENDPOINTS, GoogleApiError, googleRequest, type GoogleDeps } from "./core";

const C = GOOGLE_ENDPOINTS.calendar;
const ID = /^[A-Za-z0-9_@.%-]{1,256}$/;
const EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;
const invalid = (what: string) => new GoogleApiError("invalid", `Dato no válido: ${what}.`);
const safeId = (value: string, what: string) => { if (!ID.test(value)) throw invalid(what); return value; };
const instant = (value: string, what: string) => { if (Number.isNaN(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T/.test(value)) throw invalid(what); return value; };
const calendarOf = (id: string | undefined) => encodeURIComponent(safeId(id ?? "primary", "calendario"));

export type EventInput = { summary: string; description?: string; location?: string; start: string; end: string; timeZone?: string; attendees?: readonly string[]; sendUpdates?: "all" | "externalOnly" | "none" };
export type CalendarEvent = { id: string; status?: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; updated?: string; attendees?: { email: string; responseStatus?: string }[]; htmlLink?: string };

function body(input: Partial<EventInput>) {
  if (input.start !== undefined && input.end !== undefined && Date.parse(input.end) <= Date.parse(input.start)) throw invalid("el evento termina antes de empezar");
  const attendees = input.attendees?.map((item) => item.trim());
  if (attendees?.some((item) => !EMAIL.test(item)) || (attendees?.length ?? 0) > 100) throw invalid("invitados");
  const tz = input.timeZone ? { timeZone: input.timeZone } : {};
  return {
    ...(input.summary !== undefined ? { summary: input.summary.slice(0, 300) } : {}), ...(input.description !== undefined ? { description: input.description.slice(0, 8_000) } : {}), ...(input.location !== undefined ? { location: input.location.slice(0, 300) } : {}),
    ...(input.start !== undefined ? { start: { dateTime: instant(input.start, "inicio"), ...tz } } : {}), ...(input.end !== undefined ? { end: { dateTime: instant(input.end, "fin"), ...tz } } : {}),
    ...(attendees ? { attendees: attendees.map((email) => ({ email })) } : {}),
  };
}

export async function listEvents(deps: GoogleDeps, tokenRef: string, input: { calendarId?: string; timeMin: string; timeMax: string; maxResults?: number; query?: string }): Promise<CalendarEvent[]> {
  const result = await googleRequest<{ items?: CalendarEvent[] }>(deps, tokenRef, { url: `${C}/calendars/${calendarOf(input.calendarId)}/events`, query: { timeMin: instant(input.timeMin, "desde"), timeMax: instant(input.timeMax, "hasta"), singleEvents: true, orderBy: "startTime", maxResults: Math.min(Math.max(input.maxResults ?? 50, 1), 250), ...(input.query ? { q: input.query.slice(0, 200) } : {}) } });
  return result.items ?? [];
}
export async function createEvent(deps: GoogleDeps, tokenRef: string, input: EventInput & { calendarId?: string }): Promise<CalendarEvent> {
  if (input.summary.trim() === "") throw invalid("título");
  return googleRequest(deps, tokenRef, { method: "POST", url: `${C}/calendars/${calendarOf(input.calendarId)}/events`, query: { sendUpdates: input.sendUpdates ?? "none" }, json: body(input) });
}
export async function updateEvent(deps: GoogleDeps, tokenRef: string, input: Partial<EventInput> & { eventId: string; calendarId?: string }): Promise<CalendarEvent> {
  return googleRequest(deps, tokenRef, { method: "PATCH", url: `${C}/calendars/${calendarOf(input.calendarId)}/events/${encodeURIComponent(safeId(input.eventId, "evento"))}`, query: { sendUpdates: input.sendUpdates ?? "none" }, json: body(input) });
}
/** Cancels (deletes) an event and, when asked, tells the guests. */
export async function cancelEvent(deps: GoogleDeps, tokenRef: string, input: { eventId: string; calendarId?: string; sendUpdates?: "all" | "externalOnly" | "none" }): Promise<{ cancelled: true }> {
  await googleRequest(deps, tokenRef, { method: "DELETE", url: `${C}/calendars/${calendarOf(input.calendarId)}/events/${encodeURIComponent(safeId(input.eventId, "evento"))}`, query: { sendUpdates: input.sendUpdates ?? "none" }, as: "none" });
  return { cancelled: true };
}
export type Busy = { start: string; end: string };
export async function freeBusy(deps: GoogleDeps, tokenRef: string, input: { timeMin: string; timeMax: string; calendars?: readonly string[] }): Promise<Record<string, Busy[]>> {
  const ids = (input.calendars?.length ? input.calendars : ["primary"]).map((item) => safeId(item, "calendario"));
  const result = await googleRequest<{ calendars?: Record<string, { busy?: Busy[] }> }>(deps, tokenRef, { method: "POST", url: `${C}/freeBusy`, json: { timeMin: instant(input.timeMin, "desde"), timeMax: instant(input.timeMax, "hasta"), items: ids.map((id) => ({ id })) } });
  return Object.fromEntries(ids.map((id) => [id, result.calendars?.[id]?.busy ?? []]));
}
export type Slot = { start: string; end: string };
/** The free slots of at least `minutes` inside a window, from the busy blocks Google reports: pure, so it is the same everywhere. */
export function findFreeSlots(busy: readonly Busy[], window: { start: string; end: string }, minutes: number): Slot[] {
  if (!(minutes > 0)) throw invalid("duración");
  const from = Date.parse(window.start);
  const to = Date.parse(window.end);
  const blocks = busy.map((item) => ({ start: Date.parse(item.start), end: Date.parse(item.end) })).filter((item) => item.end > from && item.start < to).sort((a, b) => a.start - b.start);
  const slots: Slot[] = [];
  let cursor = from;
  for (const block of blocks) {
    if (block.start - cursor >= minutes * 60_000) slots.push({ start: new Date(cursor).toISOString(), end: new Date(block.start).toISOString() });
    cursor = Math.max(cursor, block.end);
  }
  if (to - cursor >= minutes * 60_000) slots.push({ start: new Date(cursor).toISOString(), end: new Date(to).toISOString() });
  return slots;
}
/** The account's address (the primary calendar's id): the identity of the connection. */
export async function calendarIdentity(deps: GoogleDeps, tokenRef: string): Promise<{ id: string; summary?: string }> {
  return googleRequest(deps, tokenRef, { url: `${C}/calendars/primary` });
}
