// A fake Google for the tests: it answers the same requests the real one would (OAuth with PKCE, Gmail, Calendar, Drive), checks what Google would check (the bearer token, its expiry, its scopes,
// the client credentials, the PKCE verifier) and records every call, so a test can prove what was sent. It never leaves the process. Not used by the application.

import { base64Url, decodeUtf8, fromBase64Url, type FetchLike } from "./core";

export type FakeScopeSet = readonly string[];
type Issued = { access: string; refresh: string; scopes: FakeScopeSet; email: string; expiresAt: number };
export type Recorded = { method: string; url: string; path: string; query: URLSearchParams; headers: Record<string, string>; body: string; json?: Record<string, unknown> };

export type FakeGoogle = {
  fetch: FetchLike; calls: Recorded[]; sent: { raw: string; threadId?: string }[]; drafts: Record<string, unknown>[]; events: Record<string, Record<string, unknown>>; files: Record<string, Record<string, unknown>>; permissions: Record<string, unknown>[];
  /** the phrase Google would show a person who authorizes: registers the code the callback will carry, with the account and the scopes granted */
  grantCode(input: { code: string; challenge: string; email: string; scopes: FakeScopeSet; omitRefresh?: boolean }): void;
  /** Google revokes everything this refresh token gave */
  revokeRefresh(email: string): void;
  failNext(pathPart: string, status: number, times?: number): void;
  throwNext(pathPart: string, times?: number): void;
  tokenRequests: { grant: string }[]; revoked: string[]; issued: () => readonly { access: string; refresh: string }[];
  setClock(now: number): void; now(): number;
  mailbox: Record<string, { id: string; threadId: string; labelIds: string[]; internalDate: string; headers: Record<string, string>; text: string; attachments?: { filename: string; mimeType: string; attachmentId: string; data: string }[] }>;
  labels: { id: string; name: string; type: string }[];
  busy: { start: string; end: string }[];
};

const need = (any: readonly string[], have: FakeScopeSet) => any.some((scope) => have.includes(scope));
const G = "https://www.googleapis.com/auth/";
export function fakeGoogle(options: { clientId: string; clientSecret: string; now: number }): FakeGoogle {
  let clock = options.now;
  const calls: Recorded[] = [];
  const codes = new Map<string, { challenge: string; email: string; scopes: FakeScopeSet; omitRefresh: boolean }>();
  const byAccess = new Map<string, Issued>();
  const byRefresh = new Map<string, Issued>();
  const revokedAccounts = new Set<string>();
  const failures: { part: string; status: number; times: number; throws: boolean }[] = [];
  const tokenRequests: { grant: string }[] = [];
  const revoked: string[] = [];
  const sent: FakeGoogle["sent"] = [];
  const drafts: Record<string, unknown>[] = [];
  const events: Record<string, Record<string, unknown>> = {};
  const files: Record<string, Record<string, unknown>> = {};
  const permissions: Record<string, unknown>[] = [];
  const mailbox: FakeGoogle["mailbox"] = {};
  const labels: FakeGoogle["labels"] = [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "Label_1", name: "Clientes", type: "user" }];
  const busy: FakeGoogle["busy"] = [];
  let counter = 0;
  const reply = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const err = (status: number, reason: string, google = "") => reply(status, { error: { code: status, status: google || reason, errors: [{ reason }] } });

  const issue = (email: string, scopes: FakeScopeSet, refresh?: string): Issued => {
    counter += 1;
    const row: Issued = { access: `at-${counter}-${base64Url(crypto.getRandomValues(new Uint8Array(9)))}`, refresh: refresh ?? `rt-${counter}-${base64Url(crypto.getRandomValues(new Uint8Array(9)))}`, scopes, email, expiresAt: clock + 3_600_000 };
    byAccess.set(row.access, row);
    byRefresh.set(row.refresh, row);
    return row;
  };

  const fetchImpl: FetchLike = async (input, init = {}) => {
    const url = new URL(input);
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const body = init.body ?? "";
    let json: Record<string, unknown> | undefined;
    if ((headers["content-type"] ?? "").includes("application/json") && body) json = JSON.parse(body) as Record<string, unknown>;
    const call: Recorded = { method: init.method ?? "GET", url: input, path: url.pathname, query: url.searchParams, headers, body, ...(json ? { json } : {}) };
    calls.push(call);
    const failure = failures.find((row) => url.pathname.includes(row.part) && row.times > 0);
    if (failure) { failure.times -= 1; if (failure.throws) throw new TypeError("network down"); return err(failure.status, failure.status === 403 ? "rateLimitExceeded" : "backendError"); }

    if (url.host === "oauth2.googleapis.com") {
      if (url.pathname === "/revoke") { revoked.push(new URLSearchParams(body).get("token") ?? ""); return reply(200, {}); }
      const form = new URLSearchParams(body);
      if (form.get("client_id") !== options.clientId || form.get("client_secret") !== options.clientSecret) return reply(401, { error: "invalid_client" });
      const grant = form.get("grant_type") ?? "";
      tokenRequests.push({ grant });
      if (grant === "authorization_code") {
        const code = codes.get(form.get("code") ?? "");
        if (!code) return reply(400, { error: "invalid_grant" });
        codes.delete(form.get("code") ?? "");
        const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(form.get("code_verifier") ?? ""))));
        if (challenge !== code.challenge) return reply(400, { error: "invalid_grant" });
        const row = issue(code.email, code.scopes);
        return reply(200, { access_token: row.access, expires_in: 3600, scope: code.scopes.join(" "), token_type: "Bearer", ...(code.omitRefresh ? {} : { refresh_token: row.refresh }) });
      }
      const row = byRefresh.get(form.get("refresh_token") ?? "");
      if (!row || revokedAccounts.has(row.email)) return reply(400, { error: "invalid_grant" });
      const next = issue(row.email, row.scopes, row.refresh);
      return reply(200, { access_token: next.access, expires_in: 3600, scope: row.scopes.join(" "), token_type: "Bearer" });
    }

    // every other endpoint needs a bearer token that is valid, not expired, and has the scope the endpoint needs
    const token = (headers["authorization"] ?? "").replace(/^Bearer /, "");
    const row = byAccess.get(token);
    if (!row || row.expiresAt <= clock || revokedAccounts.has(row.email)) return err(401, "authError", "UNAUTHENTICATED");
    const guard = (any: readonly string[]) => (need(any, row.scopes) ? null : err(403, "insufficientPermissions", "PERMISSION_DENIED"));
    const path = url.pathname;

    if (url.host === "gmail.googleapis.com") {
      const rest = path.replace("/gmail/v1/users/me", "");
      const READ = [`${G}gmail.readonly`, `${G}gmail.modify`];
      if (rest === "/profile") return guard(READ) ?? reply(200, { emailAddress: row.email, messagesTotal: Object.keys(mailbox).length, historyId: "1" });
      if (rest === "/messages" && call.method === "GET") { const denied = guard(READ); if (denied) return denied; const ids = Object.values(mailbox).sort((a, b) => Number(b.internalDate) - Number(a.internalDate)).slice(0, Number(url.searchParams.get("maxResults") ?? 20)); return reply(200, { messages: ids.map((item) => ({ id: item.id, threadId: item.threadId })) }); }
      if (rest === "/messages/send") {
        const denied = guard([`${G}gmail.send`, `${G}gmail.compose`, `${G}gmail.modify`]); if (denied) return denied;
        sent.push({ raw: decodeUtf8(fromBase64Url(String(json?.["raw"] ?? ""))), ...(json?.["threadId"] ? { threadId: String(json["threadId"]) } : {}) });
        return reply(200, { id: `sent-${sent.length}`, threadId: String(json?.["threadId"] ?? `thread-${sent.length}`) });
      }
      if (rest === "/drafts") { const denied = guard([`${G}gmail.compose`, `${G}gmail.modify`]); if (denied) return denied; drafts.push(json ?? {}); return reply(200, { id: `draft-${drafts.length}`, message: { id: `dm-${drafts.length}`, threadId: "t" } }); }
      if (rest === "/labels" && call.method === "GET") { const denied = guard(READ); if (denied) return denied; return reply(200, { labels }); }
      if (rest === "/labels" && call.method === "POST") { const denied = guard([`${G}gmail.modify`]); if (denied) return denied; const created = { id: `Label_${labels.length + 1}`, name: String(json?.["name"]), type: "user" }; labels.push(created); return reply(200, created); }
      const message = rest.match(/^\/messages\/([^/]+)(?:\/(modify|attachments\/([^/]+)))?$/);
      if (message) {
        const [, id, tail, attachmentId] = message;
        const item = mailbox[id ?? ""];
        if (!item) return err(404, "notFound", "NOT_FOUND");
        if (tail === "modify") { const denied = guard([`${G}gmail.modify`]); if (denied) return denied; item.labelIds = [...item.labelIds.filter((label) => !((json?.["removeLabelIds"] as string[]) ?? []).includes(label)), ...((json?.["addLabelIds"] as string[]) ?? [])]; return reply(200, { id: item.id, labelIds: item.labelIds }); }
        const denied = guard(READ); if (denied) return denied;
        if (attachmentId) { const file = item.attachments?.find((row2) => row2.attachmentId === attachmentId); return file ? reply(200, { size: file.data.length, data: base64Url(new TextEncoder().encode(file.data)) }) : err(404, "notFound", "NOT_FOUND"); }
        const parts = [{ mimeType: "text/plain", body: { data: base64Url(new TextEncoder().encode(item.text)) } }, ...(item.attachments ?? []).map((file) => ({ filename: file.filename, mimeType: file.mimeType, body: { attachmentId: file.attachmentId, size: file.data.length } }))];
        return reply(200, { id: item.id, threadId: item.threadId, labelIds: item.labelIds, internalDate: item.internalDate, payload: { headers: Object.entries(item.headers).map(([name, value]) => ({ name, value })), mimeType: "multipart/mixed", parts } });
      }
    }

    if (url.host === "www.googleapis.com" && path.startsWith("/calendar/v3")) {
      const rest = path.replace("/calendar/v3", "");
      const READ = [`${G}calendar.readonly`, `${G}calendar.events`];
      const WRITE = [`${G}calendar.events`];
      if (rest === "/calendars/primary") return guard(READ) ?? reply(200, { id: row.email, summary: "Calendario" });
      if (rest === "/freeBusy") { const denied = guard(READ); if (denied) return denied; return reply(200, { calendars: { primary: { busy } } }); }
      if (rest === "/calendars/primary/events" && call.method === "GET") { const denied = guard(READ); if (denied) return denied; return reply(200, { items: Object.values(events) }); }
      if (rest === "/calendars/primary/events" && call.method === "POST") { const denied = guard(WRITE); if (denied) return denied; const id = `ev${Object.keys(events).length + 1}`; events[id] = { id, status: "confirmed", updated: new Date(clock).toISOString(), ...(json ?? {}) }; return reply(200, events[id]); }
      const event = rest.match(/^\/calendars\/primary\/events\/([^/]+)$/);
      if (event) {
        const denied = guard(WRITE); if (denied) return denied;
        const id = decodeURIComponent(event[1] ?? "");
        if (!events[id]) return err(404, "notFound", "NOT_FOUND");
        if (call.method === "DELETE") { delete events[id]; return reply(204, null); }
        events[id] = { ...events[id], ...(json ?? {}), updated: new Date(clock).toISOString() };
        return reply(200, events[id]);
      }
    }

    if (url.host === "www.googleapis.com" && path.startsWith("/drive/v3") || path.startsWith("/upload/drive/v3")) {
      const READ = [`${G}drive.readonly`, `${G}drive`];
      const WRITE = [`${G}drive.file`, `${G}drive`];
      if (path === "/drive/v3/about") return guard([...READ, ...WRITE]) ?? reply(200, { user: { emailAddress: row.email, permissionId: "p1" } });
      if (path === "/drive/v3/files" && call.method === "GET") { const denied = guard(READ); if (denied) return denied; return reply(200, { files: Object.values(files).filter((item) => !!item["id"]).slice(0, Number(url.searchParams.get("pageSize") ?? 25)) }); }
      if (path === "/drive/v3/files" && call.method === "POST") { const denied = guard(WRITE); if (denied) return denied; const id = `f${Object.keys(files).length + 1}`; files[id] = { id, modifiedTime: new Date(clock).toISOString(), ...(json ?? {}) }; return reply(200, files[id]); }
      if (path === "/upload/drive/v3/files") {
        const denied = guard(WRITE); if (denied) return denied;
        const boundary = (headers["content-type"] ?? "").match(/boundary=(.+)$/)?.[1] ?? "";
        const parts = body.split(`--${boundary}`).filter((part) => part.trim() && part.trim() !== "--");
        const meta = JSON.parse((parts[0] ?? "").split("\r\n\r\n")[1]?.trim() ?? "{}") as Record<string, unknown>;
        const content = (parts[1] ?? "").split("\r\n\r\n")[1]?.trim() ?? "";
        const id = `f${Object.keys(files).length + 1}`;
        files[id] = { id, modifiedTime: new Date(clock).toISOString(), mimeType: (parts[1] ?? "").match(/Content-Type: ([^\r\n]+)/)?.[1] ?? "", content: decodeUtf8(fromBase64Url(content.replace(/\+/g, "-").replace(/\//g, "_"))), ...meta };
        return reply(200, files[id]);
      }
      const file = path.match(/^\/drive\/v3\/files\/([^/]+)(\/permissions)?$/);
      if (file) {
        const id = file[1] ?? "";
        const target = files[id];
        if (!target) return err(404, "notFound", "NOT_FOUND");
        if (file[2]) { const denied = guard(WRITE); if (denied) return denied; permissions.push({ fileId: id, ...(json ?? {}), notify: url.searchParams.get("sendNotificationEmail") }); return reply(200, { id: `perm-${permissions.length}`, role: String(json?.["role"]) }); }
        if (call.method === "PATCH") { const denied = guard(WRITE); if (denied) return denied; const add = url.searchParams.get("addParents"); const remove = (url.searchParams.get("removeParents") ?? "").split(",").filter(Boolean); target["parents"] = [...((target["parents"] as string[] | undefined) ?? []).filter((parent) => !remove.includes(parent)), ...(add ? [add] : [])]; return reply(200, target); }
        const denied = guard(READ); if (denied) return denied;
        return reply(200, target);
      }
    }
    return err(404, "notFound", "NOT_FOUND");
  };

  return {
    fetch: fetchImpl, calls, sent, drafts, events, files, permissions, mailbox, labels, busy, tokenRequests, revoked, issued: () => [...byAccess.values()].map((row) => ({ access: row.access, refresh: row.refresh })),
    grantCode: (input) => void codes.set(input.code, { challenge: input.challenge, email: input.email, scopes: input.scopes, omitRefresh: input.omitRefresh ?? false }),
    revokeRefresh: (email) => void revokedAccounts.add(email),
    failNext: (part, status, times = 1) => void failures.push({ part, status, times, throws: false }),
    throwNext: (part, times = 1) => void failures.push({ part, status: 0, times, throws: true }),
    setClock: (value) => { clock = value; }, now: () => clock,
  };
}
