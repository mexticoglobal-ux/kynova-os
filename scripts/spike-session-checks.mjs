// Session checks for the Supabase spike against a deployed Preview (ADR-0006 criteria B1, B3, B4, B5 and the
// adversarial write tests). Run it locally with fictitious accounts only.
//
// Guarantees:
//   - Cookie values, tokens and response bodies live only in this process' memory: nothing is written to disk and
//     everything printed goes through a redactor. Output is limited to HTTP status, header names/attributes,
//     counts, SQLSTATE codes and PASS / FAIL / NOT RUN.
//   - The default run only sends GET requests. Writes exist only behind --fixtures, only against a tenant created
//     exclusively for this test (SPIKE_FIXTURE_TENANT_ID, trade name starting with "FIXTURE"): PUT/PATCH attempts on
//     its existing profile, restored and verified in a finally block (a failed restore is a FAIL). INSERT tests are
//     NOT RUN: without DELETE grants or service keys a successful insert could not be cleaned up. Existing A/B tenants are never written: the script refuses to run with their ids.
//   - A check that could not observe what it needs (no renewal, no valid session, no data, inconclusive error code)
//     is reported NOT RUN, never PASS.
//
// Environment (cookie headers are copied by you from DevTools into your own shell; never paste them anywhere):
//   SPIKE_BASE_URL                                  default: the kynova-os-preview Worker
//   SPIKE_COOKIE_<LABEL>                            Cookie header for A, B, C, MEMBER (read-only checks)
//   --fixtures:    SPIKE_FIXTURE_TENANT_ID, SPIKE_COOKIE_FIXTURE_OWNER (owner of the fixture tenant),
//                  SPIKE_COOKIE_FIXTURE_MEMBER (non-owner member of it), SPIKE_COOKIE_A (outsider),
//                  SPIKE_SUPABASE_URL, SPIKE_SUPABASE_PUBLISHABLE_KEY, SPIKE_TENANT_A_ID, SPIKE_TENANT_B_ID
//
//   node scripts/spike-session-checks.mjs                  read-only checks for every label with a cookie
//   node scripts/spike-session-checks.mjs revoke A         A1/B4: asks you to sign out in the browser, then re-sends
//   node scripts/spike-session-checks.mjs --fixtures       adds the write-permission tests on the fixture tenant
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";

const DEFAULT_BASE = "https://kynova-os-preview.novamarketingstudiocr.workers.dev";
const SEED_TENANTS = ["00000000-0000-0000-0000-00000000000a", "00000000-0000-0000-0000-00000000000b"];
const FIXTURE_PREFIX = "FIXTURE";
const PROFILE_KEYS = ["tradeName", "country", "locale", "sector", "teamSize", "channel", "crm", "problem", "goal"];
const LABELS = ["A", "B", "C", "MEMBER"];

function parseCookieHeader(header) {
  const jar = new Map();
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index > 0) jar.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return jar;
}

const toCookieHeader = (jar) => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");

function parseSetCookie(line) {
  const [pair, ...rest] = line.split(";").map((part) => part.trim());
  const index = pair.indexOf("=");
  const attrs = new Map(
    rest.map((attr) => {
      const at = attr.indexOf("=");
      return at < 0 ? [attr.toLowerCase(), true] : [attr.slice(0, at).toLowerCase(), attr.slice(at + 1)];
    }),
  );
  return { name: pair.slice(0, index), value: pair.slice(index + 1), attrs };
}

function applySetCookies(jar, cookies) {
  for (const cookie of cookies) {
    if (cookie.value === "" || cookie.attrs.get("max-age") === "0") jar.delete(cookie.name);
    else jar.set(cookie.name, cookie.value);
  }
}

// sb-<ref>-auth-token may be split in .0/.1 chunks and prefixed with "base64-". Returns null when absent.
function sessionOf(jar) {
  const base = [...jar.keys()].map((key) => /^(sb-.+-auth-token)(?:\.\d+)?$/.exec(key)?.[1]).find(Boolean);
  if (!base) return null;
  let raw = jar.get(base) ?? Array.from({ length: 8 }, (_, index) => jar.get(`${base}.${index}`)).filter(Boolean).join("");
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64url").toString("utf8");
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    const accessToken = parsed.access_token;
    const userId = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString("utf8")).sub;
    return { accessToken, refreshToken: parsed.refresh_token, userId, raw };
  } catch {
    return null;
  }
}

const isNoStore = (res) =>
  /no-store/i.test(res.headers.get("cache-control") ?? "") && res.headers.get("pragma") === "no-cache" && res.headers.get("expires") === "0";

const cacheSummary = (res) => ["cache-control", "pragma", "expires"].map((name) => `${name}=${res.headers.get(name) ?? "(none)"}`).join("; ");

const pickProfile = (profile) => (profile ? Object.fromEntries(PROFILE_KEYS.map((key) => [key, profile[key]])) : null);

export async function runChecks({ env = process.env, args = [], fetchImpl = fetch, out = (text) => process.stdout.write(`${text}
`), ask } = {}) {
  const base = (env.SPIKE_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "");
  const results = [];
  const sent = [];
  const secrets = new Set();

  // Everything printed passes through here, so a value that slipped into a message is still masked.
  const print = (text) => {
    let clean = String(text);
    for (const secret of secrets) clean = clean.split(secret).join("[redacted]");
    out(clean);
  };
  const add = (name, status, detail) => {
    results.push({ name, status, detail });
    print(`${status.padEnd(7)} ${name} — ${detail}`);
  };
  const remember = (jar) => {
    for (const value of jar.values()) if (value.length >= 8) secrets.add(value);
    const session = sessionOf(jar);
    if (session) [session.accessToken, session.refreshToken, session.raw].forEach((value) => value && secrets.add(value));
  };

  const accountFor = (label, header) => {
    if (!header) return null;
    const jar = parseCookieHeader(header);
    remember(jar);
    return { label, jar };
  };

  // Calls the Preview with the account's in-memory cookies. The response body is parsed here and never exposed.
  async function call(account, method, path, json) {
    const headers = { cookie: toCookieHeader(account.jar), origin: base };
    if (json !== undefined) headers["content-type"] = "application/json";
    const body = json === undefined ? undefined : JSON.stringify(json);
    sent.push({ method, url: `${base}${path}`, body, as: account.label });
    const res = await fetchImpl(`${base}${path}`, { method, headers, body, redirect: "manual" });
    const setCookies = res.headers.getSetCookie().map(parseSetCookie);
    applySetCookies(account.jar, setCookies);
    remember(account.jar);
    setCookies.forEach((cookie) => cookie.value && secrets.add(cookie.value));
    let data = null;
    try { data = await res.json(); } catch { /* no JSON body */ }
    return { res, status: res.status, setCookies, data };
  }

  async function identify(account) {
    const { status, data } = await call(account, "GET", "/api/profile");
    return { status, tenantId: data?.tenant?.id ?? null, role: data?.tenant?.role ?? null, profile: pickProfile(data?.profile) };
  }

  const authenticated = (status) => status === 200 || status === 404;

  async function checkAccount(account) {
    const { label } = account;
    print(`\n== ${label}: cookies enviadas (solo nombres): ${[...account.jar.keys()].join(", ")}`);
    const observed = [];

    for (const path of ["/api/profile", "/api/spike/items"]) {
      const { res, status, data, setCookies } = await call(account, "GET", path);
      if (!authenticated(status)) {
        add(`${label} GET ${path} con datos y no-store`, "NOT RUN", `HTTP ${status}: no hay una sesión adecuada`);
        continue;
      }
      observed.push(...setCookies);
      const hasData = path === "/api/profile" ? status === 200 && Boolean(data?.profile) : Array.isArray(data?.items) && data.items.length > 0;
      if (!hasData) add(`${label} GET ${path} con datos y no-store`, "NOT RUN", `HTTP ${status} sin datos que proteger; ${cacheSummary(res)}`);
      else add(`${label} GET ${path} con datos y no-store`, isNoStore(res) ? "PASS" : "FAIL", `HTTP ${status}; ${cacheSummary(res)}`);
    }

    const sbCookies = observed.filter((cookie) => cookie.name.startsWith("sb-"));
    if (sbCookies.length === 0) {
      add(`${label} atributos de las cookies sb-*`, "NOT RUN", "ninguna respuesta estableció cookies sb-*; revisa HttpOnly/Secure/SameSite/Path en DevTools");
      add(`${label} renovación de la sesión (B3)`, "NOT RUN", "no se observó renovación; repite con el access token cerca de caducar");
      return;
    }
    const flags = (cookie) => ({
      httpOnly: cookie.attrs.has("httponly"),
      secure: cookie.attrs.has("secure"),
      sameSite: String(cookie.attrs.get("samesite") ?? "").toLowerCase() === "lax",
      path: cookie.attrs.get("path") === "/",
    });
    const good = sbCookies.every((cookie) => Object.values(flags(cookie)).every(Boolean));
    add(`${label} atributos de las cookies sb-*`, good ? "PASS" : "FAIL", sbCookies.map((cookie) => `${cookie.name} ${JSON.stringify(flags(cookie))}`).join(" | "));

    const renewed = sbCookies.filter((cookie) => cookie.value !== "" && cookie.attrs.get("max-age") !== "0");
    if (renewed.length === 0) return add(`${label} renovación de la sesión (B3)`, "NOT RUN", "solo se observaron cookies de limpieza, no una renovación");
    const { status } = await call(account, "GET", "/api/profile");
    add(`${label} renovación de la sesión (B3)`, authenticated(status) ? "PASS" : "FAIL", `renovada (${renewed.length} cookies); la sesión renovada respondió HTTP ${status}`);
  }

  // A1/B4: the same cookies must stop working after the sign-out done in the browser.
  async function checkRevocation(account) {
    const before = await call(account, "GET", "/api/profile");
    if (!authenticated(before.status)) return add(`${account.label} reutilización tras cerrar sesión (B4)`, "NOT RUN", `la sesión no era válida antes de cerrar sesión (HTTP ${before.status})`);
    if (!ask) return add(`${account.label} reutilización tras cerrar sesión (B4)`, "NOT RUN", "modo no interactivo");
    // Snapshot of the pre-sign-out cookies: the browser sign-out revokes them, a refresh in between must not mask it.
    const saved = new Map(parseCookieHeader(toCookieHeader(account.jar)));
    await ask("La sesión es válida. Cierra sesión en el navegador y pulsa Enter para reenviar la sesión anterior…");
    const after = await call({ label: account.label, jar: saved }, "GET", "/api/profile");
    if (after.status === 401) return add(`${account.label} reutilización tras cerrar sesión (B4)`, "PASS", `HTTP 401; ${cacheSummary(after.res)}`);
    if (authenticated(after.status)) return add(`${account.label} reutilización tras cerrar sesión (B4)`, "FAIL", `HTTP ${after.status}: la sesión anterior sigue aceptada (A1 confirmado hasta que caduque el JWT)`);
    add(`${account.label} reutilización tras cerrar sesión (B4)`, "NOT RUN", `respuesta inesperada HTTP ${after.status}`);
  }

  // Write tests: only against the fixture tenant and only after it has been verified as one.
  async function runFixtures() {
    const fixtureId = (env.SPIKE_FIXTURE_TENANT_ID ?? "").toLowerCase();
    const protectedIds = new Set([...SEED_TENANTS, env.SPIKE_TENANT_A_ID, env.SPIKE_TENANT_B_ID].filter(Boolean).map((id) => id.toLowerCase()));
    const skip = (reason) => add("pruebas de escritura en el tenant fixture", "NOT RUN", reason);
    if (!fixtureId) return skip("falta SPIKE_FIXTURE_TENANT_ID");
    if (protectedIds.has(fixtureId)) return skip("el fixture coincide con el tenant A o B: no se escribe en datos existentes");
    const owner = accountFor("FIXTURE_OWNER", env.SPIKE_COOKIE_FIXTURE_OWNER);
    if (!owner) return skip("falta SPIKE_COOKIE_FIXTURE_OWNER");

    const before = await identify(owner);
    if (before.tenantId?.toLowerCase() !== fixtureId || before.role !== "owner" || !before.profile?.tradeName?.startsWith(FIXTURE_PREFIX)) {
      return skip(`el tenant no es un fixture reconocible (HTTP ${before.status}; el perfil debe empezar por "${FIXTURE_PREFIX}")`);
    }
    const snapshot = before.profile;
    const unchanged = async () => JSON.stringify((await identify(owner)).profile) === JSON.stringify(snapshot);
    const attempt = { ...snapshot, tradeName: `${FIXTURE_PREFIX} intento de escritura` };

    try {
      const member = accountFor("FIXTURE_MEMBER", env.SPIKE_COOKIE_FIXTURE_MEMBER);
      const memberId = member && (await identify(member));
      if (!memberId || memberId.tenantId?.toLowerCase() !== fixtureId || memberId.role !== "member") {
        add("miembro no propietario no puede escribir (PUT /api/profile)", "NOT RUN", "falta una sesión de miembro no propietario del fixture");
      } else {
        const { status } = await call(member, "PUT", "/api/profile", attempt);
        const intact = await unchanged();
        if (status === 403 && intact) add("miembro no propietario no puede escribir (PUT /api/profile)", "PASS", "HTTP 403 y el perfil fixture sigue igual");
        else if (status === 401) add("miembro no propietario no puede escribir (PUT /api/profile)", "NOT RUN", "HTTP 401: sesión caducada");
        else add("miembro no propietario no puede escribir (PUT /api/profile)", "FAIL", `HTTP ${status}; perfil fixture ${intact ? "sin cambios" : "modificado"}`);
      }

      const outsider = accountFor("OUTSIDER", env.SPIKE_COOKIE_A);
      const url = env.SPIKE_SUPABASE_URL?.replace(/\/$/, "");
      const key = env.SPIKE_SUPABASE_PUBLISHABLE_KEY;
      const outsiderId = outsider && (await identify(outsider));
      const session = outsider && sessionOf(outsider.jar);
      if (!url || !key || !session || !outsiderId?.tenantId || outsiderId.tenantId.toLowerCase() === fixtureId) {
        return skip("escrituras directas omitidas: falta URL/clave de Supabase o una sesión de A que no sea del fixture");
      }
      const rest = async (method, path, json) => {
        sent.push({ method, url: `${url}/rest/v1/${path}`, body: json === undefined ? undefined : JSON.stringify(json), as: "OUTSIDER" });
        const res = await fetchImpl(`${url}/rest/v1/${path}`, {
          method,
          headers: { apikey: key, authorization: `Bearer ${session.accessToken}`, "content-type": "application/json", prefer: "return=representation" },
          body: json === undefined ? undefined : JSON.stringify(json),
        });
        let data = null;
        try { data = await res.json(); } catch { /* no JSON body */ }
        return { status: res.status, rows: Array.isArray(data) ? data.length : null, code: typeof data?.code === "string" ? data.code : null };
      };
      const visible = await rest("GET", `business_profiles?select=tenant_id&tenant_id=eq.${fixtureId}`);
      if (visible.rows !== 0) {
        add("A no puede leer ni modificar el perfil fixture (PATCH directo)", visible.rows > 0 ? "FAIL" : "NOT RUN", `lectura previa de A: ${visible.rows ?? `HTTP ${visible.status}`} filas`);
      } else {
        const patch = await rest("PATCH", `business_profiles?tenant_id=eq.${fixtureId}`, { trade_name: attempt.tradeName });
        const intact = await unchanged();
        const rejected = patch.status >= 400 || patch.rows === 0;
        add("A no puede leer ni modificar el perfil fixture (PATCH directo)", rejected && intact ? "PASS" : "FAIL", `fila verificada como existente; A la ve en 0 filas; PATCH HTTP ${patch.status}, filas ${patch.rows ?? "n/d"}; fixture ${intact ? "sin cambios" : "modificado"}`);
      }

      // No INSERT is attempted: users have no DELETE grant and service keys are never used, so a successful insert
      // (a profile row or a self-promoting membership) could not be cleaned up safely.
      for (const name of ["A no puede insertar un perfil en el fixture", "A no puede autopromoverse a propietario del fixture"]) {
        add(name, "NOT RUN", "sin limpieza segura: no hay DELETE para usuarios ni se usan claves de servicio");
      }
    } finally {
      if (await unchanged()) print("fixture: perfil intacto");
      else {
        const restored = await call(owner, "PUT", "/api/profile", snapshot);
        const ok = restored.status === 200 && (await unchanged());
        add("restauración del perfil fixture", ok ? "PASS" : "FAIL", ok ? "el perfil fixture se restauró y se verificó" : `no se pudo restaurar ni verificar (HTTP ${restored.status}); revisa el tenant fixture a mano`);
      }
    }
  }

  const [first, second] = args.filter((arg) => !arg.startsWith("--"));
  if (first === "revoke") {
    const label = (second ?? "A").toUpperCase();
    const account = accountFor(label, env[`SPIKE_COOKIE_${label}`]);
    if (account) await checkRevocation(account);
    else add(`${label} reutilización tras cerrar sesión (B4)`, "NOT RUN", `falta SPIKE_COOKIE_${label}`);
  } else {
    const accounts = LABELS.map((label) => accountFor(label, env[`SPIKE_COOKIE_${label}`])).filter(Boolean);
    if (accounts.length === 0) {
      const res = await fetchImpl(`${base}/api/profile`);
      add("sin sesión GET /api/profile", res.status === 401 && isNoStore(res) ? "PASS" : "FAIL", `HTTP ${res.status}; ${cacheSummary(res)}`);
    }
    for (const account of accounts) await checkAccount(account);
    if (args.includes("--fixtures")) await runFixtures();
  }

  const count = (status) => results.filter((result) => result.status === status).length;
  print(`\n${count("PASS")} PASS · ${count("FAIL")} FAIL · ${count("NOT RUN")} NOT RUN`);
  return { results, sent };
}

async function main() {
  const rl = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  try {
    const { results } = await runChecks({ args: process.argv.slice(2), ask: rl ? (question) => rl.question(question) : undefined });
    process.exitCode = results.some((result) => result.status === "FAIL") ? 1 : 0;
  } finally {
    rl?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
