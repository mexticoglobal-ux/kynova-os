import { NextRequest, type NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSessionCookie, isVerifierCookie, keepPendingSignIn } from "@/lib/db/supabase-auth-cookies";
import { middleware } from "@/middleware";
import { GET as callback } from "./callback/route";
import { POST as requestLink } from "./request/route";

// Regression (Preview, 2026-11-25): a browser that kept an OLD session which can no longer be renewed lost the PKCE verifier of the NEW sign-in attempt, so the emailed link could never be
// exchanged. These tests run the REAL libraries, the real middleware and the real routes; only the network is simulated. No real address, code or token.
const ORIGIN = "https://kynova-os-preview.novamarketingstudiocr.workers.dev";
const SESSION = "sb-abcdefghijklmnop-auth-token";
const VERIFIER = `${SESSION}-code-verifier`;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);
const jwt = (exp: number, sub = "00000000-0000-4000-8000-000000000000") => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, exp, role: "authenticated" })}.firmaFalsa`;
const staleSession = () => `base64-${b64({ access_token: jwt(now() - 86_400), refresh_token: "refresco-falso-vencido", token_type: "bearer", expires_in: 3600, expires_at: now() - 86_400, user: { id: "00000000-0000-4000-8000-000000000000" } })}`;
const newSession = () => ({ access_token: jwt(now() + 3600), refresh_token: "refresco-nuevo-falso", token_type: "bearer", expires_in: 3600, expires_at: now() + 3600, user: { id: "00000000-0000-4000-8000-000000000000", email: "persona@example.test" } });
const verifierCookie = () => `base64-${b64("verificador-falso-del-intento-nuevo-0000000000000000")}`;

let calls: { path: string; body: Record<string, unknown> }[] = [];
let exchangeStatus = 200;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  calls = []; exchangeStatus = 200;
  vi.stubEnv("SUPABASE_URL", "https://abcdefghijklmnop.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_valorFalsoDePrueba0123");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const grant = url.searchParams.get("grant_type");
    calls.push({ path: `${url.pathname}${grant ? `?grant_type=${grant}` : ""}`, body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : {} });
    if (grant === "refresh_token") return json({ code: "refresh_token_not_found", message: "Invalid Refresh Token" }, 400);
    if (grant === "pkce") return exchangeStatus === 200 ? json(newSession(), 200) : json({ code: "flow_state_not_found", message: "simulated" }, exchangeStatus);
    if (url.pathname.endsWith("/otp")) return json({}, 200);
    return json({ code: "bad_jwt", message: "simulated" }, 403);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const withCookies = (path: string, cookies: Record<string, string>, init: ConstructorParameters<typeof NextRequest>[1] = {}) =>
  new NextRequest(`${ORIGIN}${path}`, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), cookie: Object.entries(cookies).map(([name, value]) => `${name}=${value}`).join("; ") } });
/** What the browser would hold after a response: the same rule a cookie jar applies. */
function apply(jar: Record<string, string>, response: NextResponse) {
  const next = { ...jar };
  for (const cookie of response.cookies.getAll()) { if (cookie.value) next[cookie.name] = cookie.value; else delete next[cookie.name]; }
  return next;
}
const refreshes = () => calls.filter((call) => call.path.includes("refresh_token")).length;
const exchanges = () => calls.filter((call) => call.path.includes("grant_type=pkce"));

describe("an old, unrenewable session does not break a new sign-in", () => {
  it("keeps the new verifier through the whole link flow and replaces the old session", async () => {
    let jar: Record<string, string> = { [SESSION]: staleSession() };
    // 1. ask for the link: middleware, then the route
    const form = "email=persona%40example.test";
    const post = () => withCookies("/api/spike/auth/request", jar, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", "content-length": String(form.length) }, body: form });
    const gate = post();
    jar = apply(jar, await middleware(gate));
    const sent = await requestLink(post());
    expect(sent.headers.get("location")).toContain("status=sent");
    jar = apply(jar, sent);
    expect(jar[VERIFIER], "the verifier of the new attempt is stored").toBeTruthy();
    // 2. the page that follows goes through the middleware too, even if the old session were still there
    jar = apply({ ...jar, [SESSION]: staleSession() }, await middleware(withCookies("/spike/login?status=sent", { ...jar, [SESSION]: staleSession() })));
    expect(jar[VERIFIER], "the middleware did not delete the new verifier").toBeTruthy();
    expect(jar[SESSION], "the unrenewable session is still removed").toBeUndefined();
    // 3. the click: a stale session is present again (another tab), middleware first, then the callback with the request the middleware leaves
    jar = { ...jar, [SESSION]: staleSession() };
    const click = withCookies("/api/spike/auth/callback?code=codigo-falso-0001", jar);
    const through = await middleware(click);
    jar = apply(jar, through);
    expect(jar[VERIFIER]).toBeTruthy();
    const done = await callback(withCookies("/api/spike/auth/callback?code=codigo-falso-0001", jar));
    expect(done.headers.get("location")).toBe(`${ORIGIN}/spike`);
    expect(exchanges()).toHaveLength(1);
    expect(exchanges()[0]?.body.code_verifier, "the exchange carried the verifier").toBeTruthy();
    jar = apply(jar, done);
    expect(jar[SESSION] ?? jar[`${SESSION}.0`], "a new session is stored").toBeTruthy();
    expect(jar[VERIFIER], "a used verifier is removed").toBeUndefined();
  });

  it("the callback alone (no middleware before it) also exchanges, without ever trying to renew the old session", async () => {
    const jar = { [SESSION]: staleSession(), [VERIFIER]: verifierCookie() };
    const done = await callback(withCookies("/api/spike/auth/callback?code=codigo-falso-0002", jar));
    expect(done.headers.get("location")).toBe(`${ORIGIN}/spike`);
    expect(refreshes()).toBe(0);
    expect(exchanges()).toHaveLength(1);
  });

  it("removes what is left of an old session split in several cookies, so it cannot shadow the new one", async () => {
    const jar = { [`${SESSION}.0`]: "base64-trozo-viejo-0", [`${SESSION}.1`]: "trozo-viejo-1", [VERIFIER]: verifierCookie() };
    const done = await callback(withCookies("/api/spike/auth/callback?code=codigo-falso-0003", jar));
    const after = apply(jar, done);
    expect(Object.values(after).join(" ")).not.toContain("trozo-viejo");
    expect(after[SESSION] ?? after[`${SESSION}.0`]).toBeTruthy();
  });
});

describe("authentication is not weakened", () => {
  it("an old session still opens nothing: a protected page redirects to sign in and the session cookie is removed", async () => {
    const response = await middleware(withCookies("/dashboard", { [SESSION]: staleSession(), [VERIFIER]: verifierCookie() }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login?next=%2Fdashboard");
    const after = apply({ [SESSION]: "x", [VERIFIER]: "y" }, response);
    expect(after[SESSION]).toBeUndefined();
  });

  it("a verifier alone opens nothing", async () => {
    const response = await middleware(withCookies("/platform/connected-apps", { [VERIFIER]: verifierCookie() }));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/login");
    expect(calls).toHaveLength(0);
  });

  it("without the verifier the link is refused and no session is created, whatever old session the browser holds", async () => {
    const done = await callback(withCookies("/api/spike/auth/callback?code=codigo-falso-0004", { [SESSION]: staleSession() }));
    expect(done.headers.get("location")).toContain("status=error");
    expect(exchanges()).toHaveLength(0);
    expect(done.cookies.getAll().filter((cookie) => cookie.name.startsWith(SESSION) && !cookie.name.includes("verifier") && cookie.value)).toEqual([]);
  });

  it("a code Supabase rejects creates no session and revives nothing", async () => {
    exchangeStatus = 404;
    const done = await callback(withCookies("/api/spike/auth/callback?code=codigo-falso-0005", { [SESSION]: staleSession(), [VERIFIER]: verifierCookie() }));
    expect(done.headers.get("location")).toContain("status=error");
    expect(done.cookies.getAll().filter((cookie) => cookie.name === SESSION && cookie.value)).toEqual([]);
  });
});

describe("the rule about which cookie is which", () => {
  it("tells a session (whole or chunked) from every form of verifier, and only protects verifiers from removal", () => {
    for (const name of [SESSION, `${SESSION}.0`, `${SESSION}.12`]) { expect(isSessionCookie(name), name).toBe(true); expect(isVerifierCookie(name), name).toBe(false); }
    for (const name of [VERIFIER, `${VERIFIER}.0`, `${SESSION}-flows-code-verifier`, `${SESSION}-flow-67bf3a1bebd31afc-code-verifier`]) { expect(isVerifierCookie(name), name).toBe(true); expect(isSessionCookie(name), name).toBe(false); }
    for (const name of ["kynova_spike_email_v2", "tenant", "sb-otra-cosa"]) { expect(isSessionCookie(name)).toBe(false); expect(isVerifierCookie(name)).toBe(false); }
    const batch = [{ name: SESSION, value: "" }, { name: VERIFIER, value: "" }, { name: VERIFIER, value: "nuevo" }, { name: "tenant", value: "" }];
    expect(keepPendingSignIn(batch)).toEqual([batch[0], batch[2], batch[3]]); // the session is still removed
  });

  it("only the sign-in routes ignore the old session: signing out still reads it", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["app/api/spike/auth/callback/route.ts", "app/api/spike/auth/request/route.ts", "app/api/spike/auth/verify/route.ts", "app/api/auth/request/route.ts", "app/api/auth/verify/route.ts"]) expect(readFileSync(file, "utf8"), file).toContain("{ signingIn: true }");
    for (const file of ["app/api/spike/auth/sign-out/route.ts", "app/api/auth/sign-out/route.ts"]) expect(readFileSync(file, "utf8"), file).not.toContain("signingIn");
  });
});
