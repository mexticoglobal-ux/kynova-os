const snake = (k: string) => k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
/** Domain is camelCase with epoch milliseconds; the API is snake_case with ISO dates. `tenantId` never leaves. `config` and `state` keep their keys. */
const KEEP = new Set(["config", "state"]);
export function toWire(v: unknown, keep = false): unknown {
  if (Array.isArray(v)) return v.map((x) => toWire(x));
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) { if (k === "tenantId") continue; o[keep ? k : snake(k)] = /At$/.test(k) && typeof val === "number" ? new Date(val).toISOString() : toWire(val, KEEP.has(k)); }
    return o;
  }
  return v;
}
export function fromWire(v: unknown, keep = false): unknown {
  if (Array.isArray(v)) return v.map((x) => fromWire(x));
  if (v && typeof v === "object") { const o: Record<string, unknown> = {}; for (const [k, val] of Object.entries(v)) { const c = keep ? k : camel(k); o[c] = fromWire(val, c === "config"); } return o; }
  return v;
}
