import { describe, expect, it } from "vitest";
import { runChecks, type CheckResult } from "./spike-session-checks.mjs";

// The script talks to a deployed Worker; these tests drive it against an in-memory fake so they can prove what it
// prints and which requests it sends. Every value below is fictitious.

const BASE = "https://preview.example.test";
const SUPABASE = "https://project.example.test";
const FIXTURE = "00000000-0000-0000-0000-0000000000f1";
const TENANT_A = "00000000-0000-0000-0000-00000000000a";
const TENANT_B = "00000000-0000-0000-0000-00000000000b";
const BODY_MARKER = "BODY-MARKER-Empresa-Secreta";

const uuid = (n: number) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;
const jwt = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.SIGNATURE-VALUE-${sub}`;
const ACCESS = (name: string) => jwt(uuid([...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 100));

function cookieFor(name: string, extra = "") {
  const session = { access_token: ACCESS(name), refresh_token: `REFRESH-VALUE-${name}` };
  return `sb-ref-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}${extra}`;
}

type Identity = { name: string; tenant: string | null; role: "owner" | "member"; hasProfile: boolean };
const IDENTITIES: Identity[] = [
  { name: "A", tenant: TENANT_A, role: "owner", hasProfile: true },
  { name: "FIXOWNER", tenant: FIXTURE, role: "owner", hasProfile: true },
  { name: "FIXMEMBER", tenant: FIXTURE, role: "member", hasProfile: true },
  { name: "C", tenant: null, role: "owner", hasProfile: false },
];
const identityOf = (headers: Headers) => {
  const match = /base64-([^;]+)/.exec(headers.get("cookie") ?? "");
  const token = match && (JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")).access_token as string);
  return IDENTITIES.find((identity) => ACCESS(identity.name) === token);
};

const PROFILE = { tradeName: `${"FIXTURE"} ${BODY_MARKER}`, country: "CR", locale: "es", sector: "software", teamSize: "small", channel: "web", crm: "basicTool", problem: "leads", goal: "moreSales" };

type Options = {
  setCookies?: string[];
  profileStatusFor?: (identity: Identity | undefined) => number | null;
  memberPutStatus?: number;
  memberPutMutates?: boolean;
  patchMutates?: boolean;
  ownerPutFails?: boolean;
  visibleRows?: number;
};

function fakeServer(options: Options = {}) {
  const state = { profile: { ...PROFILE } };
  const requests: { method: string; url: string }[] = [];
  const headers = (extra: Record<string, string> = {}) => new Headers({ "cache-control": "private, no-store, max-age=0", pragma: "no-cache", expires: "0", ...extra });
  const respond = (body: unknown, status: number, setCookies: string[] = []) => {
    const res = new Response(JSON.stringify(body), { status, headers: headers() });
    (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie = () => setCookies;
    return res;
  };

  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const requestHeaders = new Headers(init?.headers);
    requests.push({ method, url });

    if (url.startsWith(SUPABASE)) {
      if (method === "GET") return respond(Array.from({ length: options.visibleRows ?? 0 }, () => ({ tenant_id: FIXTURE })), 200);
      if (method === "PATCH" && options.patchMutates) {
        state.profile = { ...state.profile, tradeName: `${"FIXTURE"} parcheado` };
        return respond([{}], 200);
      }
      if (method === "PATCH") return respond([], 200);
      throw new Error(`unexpected ${method} ${url}: the script must never insert or delete`);
    }

    const identity = identityOf(requestHeaders);
    const forced = options.profileStatusFor?.(identity);
    if (forced === 401 || !identity) return respond({ error: "unauthorized" }, 401);
    if (url.endsWith("/api/spike/items")) return respond({ items: [{ title: BODY_MARKER }] }, 200, options.setCookies);
    if (!identity.tenant) return respond({ error: "no_tenant" }, 404, options.setCookies);

    if (method === "PUT") {
      if (options.ownerPutFails && identity.role === "owner") return respond({ error: "unavailable" }, 503);
      const body = JSON.parse(String(init?.body));
      if (identity.role === "member" && !options.memberPutMutates) return respond({ error: "forbidden" }, options.memberPutStatus ?? 403);
      state.profile = { ...state.profile, ...body };
      return respond({ tenant: { id: identity.tenant, name: BODY_MARKER, role: identity.role }, profile: state.profile }, 200);
    }
    return respond({ tenant: { id: identity.tenant, name: BODY_MARKER, role: identity.role }, profile: state.profile }, 200, options.setCookies);
  }) as typeof fetch;

  return { fetchImpl, requests, state };
}

const statusOf = (results: CheckResult[], fragment: string) => results.find((result) => result.name.includes(fragment))?.status;
const SB_ATTRS = "Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600";
const ROTATED_REFRESH = "ROTATED-REFRESH-9999";
// A renewed cookie for the same fictitious user: new refresh token, same access identity.
const rotated = (name: string, attrs = SB_ATTRS) =>
  `sb-ref-auth-token=base64-${Buffer.from(JSON.stringify({ access_token: ACCESS(name), refresh_token: ROTATED_REFRESH })).toString("base64url")}; ${attrs}`;

async function run(options: Options, env: Record<string, string>, args: string[] = [], ask?: () => Promise<string>) {
  const server = fakeServer(options);
  const lines: string[] = [];
  const outcome = await runChecks({ env: { SPIKE_BASE_URL: BASE, ...env }, args, fetchImpl: server.fetchImpl, out: (line) => lines.push(line), ask });
  return { ...outcome, server, output: lines.join("\n") };
}

describe("spike-session-checks · output", () => {
  it("never prints cookie values, tokens or response bodies", async () => {
    const cookie = cookieFor("A");
    const refreshed = rotated("A");
    const { output } = await run({ setCookies: [refreshed] }, { SPIKE_COOKIE_A: cookie });

    const forbidden = [cookie.split("=").slice(1).join("="), ACCESS("A"), "REFRESH-VALUE-A", ROTATED_REFRESH, BODY_MARKER, "SIGNATURE-VALUE"];
    for (const secret of forbidden) expect(output).not.toContain(secret);
    expect(output).toContain("PASS");
  });

  it("masks a secret even if it ends up inside a message", async () => {
    // A server that echoes the token in a header the script prints must still be redacted.
    const cookie = cookieFor("A");
    const lines: string[] = [];
    const fetchImpl = (async () => {
      const res = new Response(JSON.stringify({ items: [{ a: 1 }] }), { status: 200, headers: { "cache-control": `private, no-store, ${ACCESS("A")}`, pragma: "no-cache", expires: "0" } });
      (res.headers as Headers & { getSetCookie: () => string[] }).getSetCookie = () => [];
      return res;
    }) as typeof fetch;
    await runChecks({ env: { SPIKE_BASE_URL: BASE, SPIKE_COOKIE_A: cookie }, fetchImpl, out: (line) => lines.push(line) });
    expect(lines.join("\n")).not.toContain(ACCESS("A"));
  });
});

describe("spike-session-checks · read-only run", () => {
  it("sends only GET requests", async () => {
    const { server } = await run({ setCookies: [rotated("A")] }, { SPIKE_COOKIE_A: cookieFor("A"), SPIKE_COOKIE_C: cookieFor("C") });
    expect(server.requests.length).toBeGreaterThan(0);
    expect(server.requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("is NOT RUN, not PASS, when no renewal or sb-* cookie was observed", async () => {
    const { results } = await run({}, { SPIKE_COOKIE_A: cookieFor("A") });
    expect(statusOf(results, "atributos de las cookies sb-*")).toBe("NOT RUN");
    expect(statusOf(results, "renovación")).toBe("NOT RUN");
    expect(statusOf(results, "/api/profile con datos")).toBe("PASS");
  });

  it("does not count a 404 without data as an authenticated-cache PASS", async () => {
    const { results } = await run({}, { SPIKE_COOKIE_C: cookieFor("C") });
    expect(statusOf(results, "GET /api/profile con datos")).toBe("NOT RUN");
  });

  it("is NOT RUN when the session is not valid", async () => {
    const { results } = await run({ profileStatusFor: () => 401 }, { SPIKE_COOKIE_A: cookieFor("A") });
    expect(results.every((result) => result.status === "NOT RUN")).toBe(true);
  });

  it("passes cookie attributes and renewal only when a renewed sb-* cookie was seen and still works", async () => {
    const { results } = await run({ setCookies: [rotated("A")] }, { SPIKE_COOKIE_A: cookieFor("A") });
    expect(statusOf(results, "atributos de las cookies sb-*")).toBe("PASS");
    expect(statusOf(results, "renovación")).toBe("PASS");
  });

  it("fails the attribute check when HttpOnly is missing", async () => {
    const { results } = await run({ setCookies: [rotated("A", "Path=/; Secure; SameSite=Lax; Max-Age=3600")] }, { SPIKE_COOKIE_A: cookieFor("A") });
    expect(statusOf(results, "atributos de las cookies sb-*")).toBe("FAIL");
  });

  it("only observes a clean-up cookie as no renewal", async () => {
    const { results } = await run({ setCookies: ["sb-ref-auth-token=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"] }, { SPIKE_COOKIE_A: cookieFor("A") });
    expect(statusOf(results, "renovación")).toBe("NOT RUN");
  });
});

describe("spike-session-checks · revoke", () => {
  const env = { SPIKE_COOKIE_A: cookieFor("A") };

  it("is NOT RUN when the session was not valid before signing out", async () => {
    const { results } = await run({ profileStatusFor: () => 401 }, env, ["revoke", "A"], async () => "");
    expect(statusOf(results, "reutilización")).toBe("NOT RUN");
  });

  it("is NOT RUN without an interactive prompt", async () => {
    const { results } = await run({}, env, ["revoke", "A"]);
    expect(statusOf(results, "reutilización")).toBe("NOT RUN");
  });

  it("passes on 401 after sign-out and fails when the old session is still accepted", async () => {
    let calls = 0;
    const rejected = await run({ profileStatusFor: () => (++calls > 1 ? 401 : null) }, env, ["revoke", "A"], async () => "");
    expect(statusOf(rejected.results, "reutilización")).toBe("PASS");
    const accepted = await run({}, env, ["revoke", "A"], async () => "");
    expect(statusOf(accepted.results, "reutilización")).toBe("FAIL");
  });
});

describe("spike-session-checks · fixtures", () => {
  const baseEnv = {
    SPIKE_FIXTURE_TENANT_ID: FIXTURE,
    SPIKE_COOKIE_FIXTURE_OWNER: cookieFor("FIXOWNER"),
    SPIKE_COOKIE_FIXTURE_MEMBER: cookieFor("FIXMEMBER"),
    SPIKE_COOKIE_A: cookieFor("A"),
    SPIKE_SUPABASE_URL: SUPABASE,
    SPIKE_SUPABASE_PUBLISHABLE_KEY: "publishable-key-value",
    SPIKE_TENANT_A_ID: TENANT_A,
    SPIKE_TENANT_B_ID: TENANT_B,
  };
  const rejecting = {};
  const mutating = (server: { requests: { method: string }[] }) => server.requests.filter((request) => request.method !== "GET");

  it("refuses to write when the fixture is tenant A or B, and sends no write", async () => {
    for (const id of [TENANT_A, TENANT_B, "00000000-0000-0000-0000-00000000000A"]) {
      const { results, server } = await run(rejecting, { ...baseEnv, SPIKE_FIXTURE_TENANT_ID: id }, ["--fixtures"]);
      expect(statusOf(results, "tenant fixture")).toBe("NOT RUN");
      expect(mutating(server)).toHaveLength(0);
    }
  });

  it("refuses a tenant whose profile is not recognisably a fixture", async () => {
    const server = fakeServer(rejecting);
    server.state.profile.tradeName = "Empresa real";
    const results = (await runChecks({ env: { SPIKE_BASE_URL: BASE, ...baseEnv }, args: ["--fixtures"], fetchImpl: server.fetchImpl, out: () => {} })).results;
    expect(statusOf(results, "tenant fixture")).toBe("NOT RUN");
    expect(server.requests.filter((request) => request.method !== "GET")).toHaveLength(0);
  });

  it("proves every authorization denial and only ever writes toward the fixture tenant", async () => {
    const { results, server, sent } = await run(rejecting, baseEnv, ["--fixtures"]);
    expect(results.filter((result) => result.name.includes("fixture") || result.name.startsWith("A no puede") || result.name.startsWith("miembro")).map((result) => result.status)).not.toContain("FAIL");
    expect(statusOf(results, "miembro no propietario")).toBe("PASS");
    expect(statusOf(results, "PATCH directo")).toBe("PASS");
    expect(mutating(server).length).toBeGreaterThan(0);
    for (const request of sent.filter((item) => item.method !== "GET")) {
      // The API derives the tenant from the session, so API writes must come from fixture accounts only.
      if (request.url.startsWith(BASE)) {
        expect(["FIXTURE_OWNER", "FIXTURE_MEMBER"]).toContain(request.as);
        continue;
      }
      const target = `${request.url} ${request.body ?? ""}`.toLowerCase();
      expect(target).toContain(FIXTURE);
      expect(target).not.toContain(TENANT_A);
      expect(target).not.toContain(TENANT_B);
    }
  });

  it("does not turn a zero-row PATCH into PASS when the fixture row was not verified", async () => {
    const { results } = await run({ ...rejecting, visibleRows: 1 }, baseEnv, ["--fixtures"]);
    expect(statusOf(results, "PATCH directo")).toBe("FAIL");
  });

  it("never inserts or deletes: insert tests are NOT RUN and no POST/DELETE is sent", async () => {
    const { results, server } = await run(rejecting, baseEnv, ["--fixtures"]);
    expect(statusOf(results, "insertar un perfil")).toBe("NOT RUN");
    expect(statusOf(results, "autopromoverse")).toBe("NOT RUN");
    expect(server.requests.filter((request) => ["POST", "DELETE"].includes(request.method))).toHaveLength(0);
  });

  it("fails and restores the profile when the direct PATCH is unexpectedly accepted", async () => {
    const { results, server } = await run({ ...rejecting, patchMutates: true }, baseEnv, ["--fixtures"]);
    expect(statusOf(results, "PATCH directo")).toBe("FAIL");
    expect(statusOf(results, "restauración")).toBe("PASS");
    expect(server.state.profile.tradeName).toBe(PROFILE.tradeName);
  });

  it("ends in FAIL when the profile cannot be restored and verified", async () => {
    const { results, server } = await run({ ...rejecting, memberPutMutates: true, ownerPutFails: true }, baseEnv, ["--fixtures"]);
    expect(statusOf(results, "miembro no propietario")).toBe("FAIL");
    expect(statusOf(results, "restauración")).toBe("FAIL");
    expect(server.state.profile.tradeName).not.toBe(PROFILE.tradeName);
  });

  it("restores the fixture in finally when a write unexpectedly succeeds", async () => {
    const { results, server } = await run({ ...rejecting, memberPutMutates: true }, baseEnv, ["--fixtures"]);
    expect(statusOf(results, "miembro no propietario")).toBe("FAIL");
    expect(server.state.profile.tradeName).toBe(PROFILE.tradeName);
    const puts = server.requests.filter((request) => request.method === "PUT");
    expect(puts.length).toBeGreaterThanOrEqual(2); // the attempt and the restore
  });

  it("is NOT RUN for the member test when there is no non-owner member session", async () => {
    const { results } = await run(rejecting, { ...baseEnv, SPIKE_COOKIE_FIXTURE_MEMBER: "" }, ["--fixtures"]);
    expect(statusOf(results, "miembro no propietario")).toBe("NOT RUN");
  });
});
