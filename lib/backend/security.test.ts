import { describe, expect, it } from "vitest";
import { decrypt, encrypt, fromBase64, fromHex, generateEncryptionKey, hashToken, hmacSha256Hex, pbkdf2Hex, randomBytes, randomToken, sha256Hex, timingSafeEqual, toHex, verifyToken } from "./crypto";
import { ENVIRONMENTS, ENVIRONMENT_POLICIES, ENV_SPEC, SECRET_NAMES, detectEnvironment, loadConfig, validateEnvironment } from "./env";
import { EnvSecretsProvider, MemorySecretsProvider, SecretMissingError, SecretsManager, looksLikeSecret, maskSecret, redactSecrets, secretsDue } from "./secrets";

// Secrets are built here at run time, so this file never contains a literal that looks like one.
const fake = (...parts: string[]) => parts.join("");
const JWT = fake("eyJ", "hbGciOiJIUzI1NiJ9", ".", "eyJzdWIiOiIxMjM0NTY3ODkwIn0", ".", "c2lnbmF0dXJlLXZhbHVlLXRlc3Q");
const PAYMENT_KEY = fake("sk", "_live_", "A1b2C3d4E5f6G7h8I9j0");

describe("Environment Manager", () => {
  it("knows Development, Preview and Production, and deduces the environment safely", () => {
    expect([...ENVIRONMENTS]).toEqual(["development", "preview", "production"]);
    expect(detectEnvironment({})).toBe("development");
    expect(detectEnvironment({ KYNOVA_ENV: "preview" })).toBe("preview");
    expect(detectEnvironment({ NODE_ENV: "production" })).toBe("production"); // a production build with no explicit environment is the strictest
    expect(detectEnvironment({ KYNOVA_ENV: "staging", NODE_ENV: "development" })).toBe("development"); // an unknown value is ignored
    expect(detectEnvironment({ KYNOVA_ENV: "development", NODE_ENV: "production" })).toBe("development");
  });

  it("asks for different things in each environment", () => {
    expect(validateEnvironment({}, "development")).toMatchObject({ ok: true, missing: [] });
    expect(validateEnvironment({}, "preview").missing).toEqual(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
    expect(validateEnvironment({}, "production").missing).toEqual(["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "KYNOVA_ENCRYPTION_KEY", "KYNOVA_HASH_PEPPER"]);
  });

  it("reports names and reasons, never a value", () => {
    const pepper = "x".repeat(8); // too short: invalid
    const url = "http://insecure.example"; // not https
    const report = validateEnvironment({ SUPABASE_URL: url, KYNOVA_HASH_PEPPER: pepper, KYNOVA_LOG_LEVEL: "loud" }, "production");
    expect(report.ok).toBe(false);
    expect(report.invalid).toEqual(expect.arrayContaining(["SUPABASE_URL", "KYNOVA_HASH_PEPPER", "KYNOVA_LOG_LEVEL"]));
    const text = JSON.stringify(report);
    expect(text).not.toContain(url);
    expect(text).not.toContain(pepper);
  });

  it("refuses a secret that would travel to the browser", () => {
    const report = validateEnvironment({ NEXT_PUBLIC_SERVICE_ROLE_KEY: "whatever", NEXT_PUBLIC_SITE_NAME: "KYNOVA" }, "development");
    expect(report.ok).toBe(false);
    expect(report.invalid).toEqual(["NEXT_PUBLIC_SERVICE_ROLE_KEY (un secreto no puede ir al navegador)"]);
  });

  it("warns when the key that skips Row Level Security is set in production", () => {
    const key = fake("a", "b".repeat(30));
    const report = validateEnvironment({ KYNOVA_ENV: "production", SUPABASE_SERVICE_ROLE_KEY: key }, "production");
    expect(report.warnings.some((item) => item.includes("SUPABASE_SERVICE_ROLE_KEY"))).toBe(true);
    expect(JSON.stringify(report)).not.toContain(key);
  });

  it("allows sample data only outside production, and real data nowhere yet", () => {
    expect(ENVIRONMENT_POLICIES.development.demoData).toBe(true);
    expect(ENVIRONMENT_POLICIES.preview.demoData).toBe(true);
    expect(ENVIRONMENT_POLICIES.production.demoData).toBe(false);
    for (const environment of ENVIRONMENTS) {
      expect(ENVIRONMENT_POLICIES[environment].realData).toBe(false); // gated by ADR-0006 and the production approval
      expect(ENVIRONMENT_POLICIES[environment].rlsEnforced).toBe(false); // prepared, not activated
    }
    expect(ENVIRONMENT_POLICIES.development.verboseErrors).toBe(true);
    expect(ENVIRONMENT_POLICIES.production.verboseErrors).toBe(false);
  });

  it("builds a configuration that never throws and never holds a secret", () => {
    const empty = loadConfig({});
    expect(empty).toMatchObject({ environment: "development", supabase: null, serviceKeyConfigured: false, logLevel: "debug", traceSample: 1 });
    const service = fake("svc", "z".repeat(30));
    const full = loadConfig({ KYNOVA_ENV: "preview", SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "p".repeat(30), SUPABASE_SERVICE_ROLE_KEY: service, KYNOVA_LOG_LEVEL: "warn", KYNOVA_TRACE_SAMPLE: "0.25" });
    expect(full).toMatchObject({ environment: "preview", supabase: { url: "https://project.supabase.co" }, serviceKeyConfigured: true, logLevel: "warn", traceSample: 0.25 });
    expect(JSON.stringify(full)).not.toContain(service); // only whether a service key exists
    expect(loadConfig({ SUPABASE_URL: "nope", SUPABASE_PUBLISHABLE_KEY: "p".repeat(30) }).supabase).toBeNull();
    expect(loadConfig({ KYNOVA_TRACE_SAMPLE: "7" }).traceSample).toBe(1);
  });

  it("declares which variables are secrets, and the Secrets Manager hands out only those", () => {
    expect([...SECRET_NAMES].sort()).toEqual(["KYNOVA_ENCRYPTION_KEY", "KYNOVA_HASH_PEPPER", "SUPABASE_SERVICE_ROLE_KEY"]);
    expect(ENV_SPEC.every((item) => item.description.length > 10)).toBe(true);
    expect(ENV_SPEC.filter((item) => item.scope === "public").map((item) => item.name)).toEqual(["SUPABASE_PUBLISHABLE_KEY"]);
  });
});

describe("Secrets Manager", () => {
  it("reads only the allow-listed secrets, and nothing else from the environment", () => {
    const provider = new EnvSecretsProvider({ KYNOVA_HASH_PEPPER: "p".repeat(40), PATH: "/usr/bin", HOME: "/root", KYNOVA_ENCRYPTION_KEY: "" });
    expect(provider.get("KYNOVA_HASH_PEPPER")).toBe("p".repeat(40));
    expect(provider.get("PATH")).toBeUndefined();
    expect(provider.get("KYNOVA_ENCRYPTION_KEY")).toBeUndefined(); // empty counts as missing
    expect(provider.names()).toEqual(["KYNOVA_HASH_PEPPER"]);
  });

  it("hands a secret to a task for the moment it is used, and records the use by name and purpose only", async () => {
    const value = "q".repeat(40);
    const manager = new SecretsManager(new MemorySecretsProvider({ KYNOVA_HASH_PEPPER: value }), () => "2026-11-07T00:00:00.000Z");
    expect(await manager.use("KYNOVA_HASH_PEPPER", "hash de un token", (secret) => secret.length)).toBe(40);
    expect(manager.accessLog()).toEqual([{ name: "KYNOVA_HASH_PEPPER", at: "2026-11-07T00:00:00.000Z", purpose: "hash de un token" }]);
    expect(JSON.stringify(manager.accessLog())).not.toContain(value);
    expect(manager.has("KYNOVA_HASH_PEPPER")).toBe(true);
    expect(manager.configured()).toEqual(["KYNOVA_HASH_PEPPER"]);
  });

  it("fails clearly, without a value, when a secret is missing", async () => {
    const manager = new SecretsManager(new MemorySecretsProvider({}));
    await expect(manager.use("KYNOVA_ENCRYPTION_KEY", "cifrar", () => 1)).rejects.toBeInstanceOf(SecretMissingError);
    await expect(manager.use("KYNOVA_ENCRYPTION_KEY", "cifrar", () => 1)).rejects.toThrow(/nunca en el código/);
    expect(manager.accessLog()).toEqual([]);
  });

  it("flags a secret that has not been rotated in time", () => {
    const metas = [{ name: "KYNOVA_HASH_PEPPER", rotatedAt: "2026-01-01T00:00:00Z", maxAgeDays: 90 }, { name: "KYNOVA_ENCRYPTION_KEY", rotatedAt: "2026-10-01T00:00:00Z", maxAgeDays: 90 }];
    expect(secretsDue(metas, "2026-11-07T00:00:00Z")).toEqual(["KYNOVA_HASH_PEPPER"]);
  });

  it("recognizes and hides anything that looks like a secret", () => {
    for (const text of [JWT, PAYMENT_KEY, fake("Bearer ", "abcdefghijklmnopqrstuvwxyz0123456789"), fake("API_", "KEY=", "abcdefghijklmnopqrstuvwxyz012345"), fake("AK", "IA", "ABCDEFGHIJKLMNOP"), fake("-----BEGIN ", "PRIVATE KEY-----")]) {
      expect(looksLikeSecret(text), text.slice(0, 12)).toBe(true);
      expect(redactSecrets(`antes ${text} después`)).not.toContain(text.slice(0, 20));
    }
    expect(looksLikeSecret("una frase normal sobre la clave de acceso")).toBe(false);
    expect(redactSecrets("sin secretos aquí")).toBe("sin secretos aquí");
    expect(redactSecrets(fake("SECRET_", "TOKEN=", "abcdefghijklmnopqrstuvwxyz0123456789"))).toBe("SECRET_TOKEN=[secreto]");
  });

  it("shows a value to a person without giving it away", () => {
    expect(maskSecret("abcdefghijklmnopqrstuvwxyz")).toBe("ab••••yz");
    expect(maskSecret("corto")).toBe("••••");
  });
});

describe("encryption and hash helpers", () => {
  it("computes standard SHA-256 and HMAC-SHA256 values", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await hmacSha256Hex("Jefe", "what do ya want for nothing?")).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"); // RFC 4231, case 2
    expect(await sha256Hex(new Uint8Array([97, 98, 99]))).toBe(await sha256Hex("abc"));
  });

  it("compares in constant time and handles different lengths", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });

  it("stores a token as a keyed hash, and checks it without keeping the token", async () => {
    const pepper = "p".repeat(40);
    const token = randomToken();
    const stored = await hashToken(token, pepper);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
    expect(await verifyToken(token, pepper, stored)).toBe(true);
    expect(await verifyToken(`${token}x`, pepper, stored)).toBe(false);
    expect(await verifyToken(token, "q".repeat(40), stored)).toBe(false); // another pepper, another hash
  });

  it("derives a slow salted hash that is repeatable and depends on the salt", async () => {
    const salt = toHex(randomBytes(16));
    const first = await pbkdf2Hex("secreto bajo", salt, 1_000);
    expect(first).toHaveLength(64);
    expect(await pbkdf2Hex("secreto bajo", salt, 1_000)).toBe(first);
    expect(await pbkdf2Hex("secreto bajo", toHex(randomBytes(16)), 1_000)).not.toBe(first);
    expect(await pbkdf2Hex("otro", salt, 1_000)).not.toBe(first);
  });

  it("makes random tokens that are long, different and URL safe", () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(() => randomBytes(0)).toThrow();
    expect(() => randomBytes(5_000)).toThrow();
    expect(fromHex(toHex(new Uint8Array([1, 2, 255])))).toEqual(new Uint8Array([1, 2, 255]));
    expect(() => fromHex("zz")).toThrow();
  });

  it("encrypts and decrypts, with a fresh random value each time", async () => {
    const key = generateEncryptionKey();
    expect(fromBase64(key)).toHaveLength(32);
    const sealed = await encrypt("dato sensible: 4111", key, "tenant-a");
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("sensible");
    expect(await decrypt(sealed, key, "tenant-a")).toBe("dato sensible: 4111");
    expect(await encrypt("dato sensible: 4111", key, "tenant-a")).not.toBe(sealed);
  });

  it("binds a ciphertext to its company: another company, another key or a change cannot open it", async () => {
    const key = generateEncryptionKey();
    const sealed = await encrypt("solo de la empresa A", key, "tenant-a");
    await expect(decrypt(sealed, key, "tenant-b")).rejects.toThrow();
    await expect(decrypt(sealed, generateEncryptionKey(), "tenant-a")).rejects.toThrow();
    const [version, iv, body] = sealed.split(".") as [string, string, string];
    await expect(decrypt(`${version}.${iv}.${body.slice(0, -3)}AAA`, key, "tenant-a")).rejects.toThrow();
    await expect(decrypt("v2.x.y", key, "tenant-a")).rejects.toThrow(/no válido/);
    await expect(encrypt("x", "c2hvcnQ=", "tenant-a")).rejects.toThrow(/32 bytes/);
  });
});
