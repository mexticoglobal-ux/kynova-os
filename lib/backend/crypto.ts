// Encryption and hash helpers on the Web Crypto API (the same one in Node and in Cloudflare Workers): no dependency, no network, no key in code.
// Tokens and API keys are stored as a keyed hash (never the value). Sensitive fields are encrypted with AES-256-GCM, and the ciphertext is bound
// to a context (the company) so a value encrypted for one company can never be opened as another's.

const subtle = (): SubtleCrypto => {
  const api = globalThis.crypto?.subtle;
  if (!api) throw new Error("Web Crypto no está disponible en este entorno.");
  return api;
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const toHex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
export function fromHex(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) throw new Error("hex no válido");
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}
export const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
const toBase64Url = (bytes: Uint8Array): string => toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text: string): Uint8Array => fromBase64(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));

export function randomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length < 1 || length > 1024) throw new Error("longitud no válida");
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
/** A random token that is safe in a URL. */
export const randomToken = (bytes = 32): string => toBase64Url(randomBytes(bytes));

// ---------------------------------------------------------------- hashes
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? encoder.encode(input) : input;
  return toHex(new Uint8Array(await subtle().digest("SHA-256", data as BufferSource)));
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const imported = await subtle().importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await subtle().sign("HMAC", imported, encoder.encode(message))));
}

/** Compares two strings in time that does not depend on where they differ, so the comparison leaks nothing. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return diff === 0;
}

/** The stored form of a token or an API key: a keyed hash. The value itself is never kept. */
export const hashToken = (token: string, pepper: string): Promise<string> => hmacSha256Hex(pepper, token);
export async function verifyToken(token: string, pepper: string, expectedHash: string): Promise<boolean> {
  return timingSafeEqual(await hashToken(token, pepper), expectedHash);
}

/** A slow, salted hash for low-entropy secrets (PBKDF2-SHA256). */
export async function pbkdf2Hex(secret: string, saltHex: string, iterations = 210_000, bytes = 32): Promise<string> {
  const base = await subtle().importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle().deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromHex(saltHex) as BufferSource, iterations }, base, bytes * 8);
  return toHex(new Uint8Array(bits));
}

// ---------------------------------------------------------------- encryption
export const ENVELOPE_VERSION = "v1";

/** A new AES-256 key, in base64, to be stored as a secret (never in code). */
export const generateEncryptionKey = (): string => toBase64(randomBytes(32));

async function aesKey(keyBase64: string, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  const raw = fromBase64(keyBase64);
  if (raw.length !== 32) throw new Error("La llave de cifrado debe tener 32 bytes.");
  return subtle().importKey("raw", raw as BufferSource, "AES-GCM", false, [usage]);
}

/** Encrypts text. `context` (for example the company id) is bound to the ciphertext: it must be the same to open it. */
export async function encrypt(plaintext: string, keyBase64: string, context = ""): Promise<string> {
  const iv = randomBytes(12);
  const sealed = await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource, additionalData: encoder.encode(context) as BufferSource }, await aesKey(keyBase64, "encrypt"), encoder.encode(plaintext));
  return `${ENVELOPE_VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(sealed))}`;
}

export async function decrypt(envelope: string, keyBase64: string, context = ""): Promise<string> {
  const [version, iv, sealed] = envelope.split(".");
  if (version !== ENVELOPE_VERSION || !iv || !sealed) throw new Error("Sobre cifrado no válido.");
  const opened = await subtle().decrypt({ name: "AES-GCM", iv: fromBase64Url(iv) as BufferSource, additionalData: encoder.encode(context) as BufferSource }, await aesKey(keyBase64, "decrypt"), fromBase64Url(sealed) as BufferSource);
  return decoder.decode(opened);
}
