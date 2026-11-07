import { describe, expect, it } from "vitest";
import { PROVIDER_IDS } from "./integrations";
import {
  CONFIG_FIELDS,
  activationBlockers,
  defaultPermissions,
  newConnection,
  reduce,
  validateConfig,
  validatePermissions,
  type Connection,
  type ConnectionEvent,
} from "./connection";

const at = "2026-11-06T10:00:00Z";
const actor = "user-1";
const apply = (connection: Connection, ...events: ConnectionEvent[]) => events.reduce((current, event) => reduce(current, event).connection, connection);
const validStripe = { displayName: "Cobros", mode: "test", credential: "secret:stripe-main" };

describe("configuration", () => {
  it("defines the fields of every provider", () => {
    for (const id of PROVIDER_IDS) expect(CONFIG_FIELDS[id].length).toBeGreaterThan(0);
  });

  it("asks for what is missing and accepts a complete form", () => {
    expect(validateConfig("stripe", {})).toHaveLength(3);
    expect(validateConfig("stripe", validStripe)).toEqual([]);
  });

  it("rejects a raw secret where a reference is expected", () => {
    expect(validateConfig("stripe", { ...validStripe, credential: "sk_live_abc123" })[0]).toContain("referencia");
    expect(validateConfig("stripe", { ...validStripe, mode: "yolo" })[0]).toContain("no válido");
  });
});

describe("permissions", () => {
  it("starts with everything off", () => {
    expect(Object.values(defaultPermissions("whatsapp")).every((grant) => grant === "off")).toBe(true);
  });

  it("never lets an external effect run unattended, and refuses what the provider does not offer", () => {
    expect(validatePermissions("whatsapp", { sendMessages: "approval", receiveMessages: "auto" })).toEqual([]);
    expect(validatePermissions("whatsapp", { sendMessages: "auto" })[0]).toContain("no está permitido");
    expect(validatePermissions("whatsapp", { refund: "approval" })[0]).toContain("no lo ofrece");
  });
});

describe("connection lifecycle", () => {
  it("connects as a draft, then activates only with a complete configuration", () => {
    const draft = apply(newConnection("stripe"), { type: "configure", actor, at, config: { displayName: "Cobros" } });
    expect(draft.status).toBe("pending");
    expect(reduce(draft, { type: "activate", actor, at }).error).toContain("obligatorio");
    const ready = apply(draft, { type: "configure", actor, at, config: validStripe });
    const active = reduce(ready, { type: "activate", actor, at });
    expect(active.error).toBeUndefined();
    expect(active.connection).toMatchObject({ status: "active", enabled: true });
  });

  it("explains why activation is blocked", () => {
    expect(activationBlockers(newConnection("stripe"))).toHaveLength(3);
    expect(activationBlockers(newConnection("makapay"))[0]).toContain("documentación");
  });

  it("can never activate a provider whose API is still unknown", () => {
    const connection = apply(newConnection("makapay"), { type: "configure", actor, at, config: { displayName: "Maka" } });
    expect(reduce(connection, { type: "activate", actor, at }).error).toContain("documentación");
  });

  it("pauses and revokes, and a revoked connection cannot be edited back to life", () => {
    const active = apply(newConnection("stripe"), { type: "configure", actor, at, config: validStripe }, { type: "activate", actor, at });
    const paused = apply(active, { type: "deactivate", actor, at });
    expect(paused).toMatchObject({ status: "paused", enabled: false });
    expect(reduce(paused, { type: "deactivate", actor, at }).error).toBeDefined();
    const revoked = apply(paused, { type: "revoke", actor, at });
    expect(revoked.status).toBe("revoked");
    expect(reduce(revoked, { type: "configure", actor, at, config: validStripe }).error).toContain("revocada");
    expect(reduce(revoked, { type: "activate", actor, at }).error).toBeDefined();
  });

  it("degrades on a retryable error and stops on one that needs a person", () => {
    const active = apply(newConnection("stripe"), { type: "configure", actor, at, config: validStripe }, { type: "activate", actor, at });
    const slow = apply(active, { type: "fail", at, kind: "rateLimit", message: "429" });
    expect(slow).toMatchObject({ status: "degraded", enabled: true });
    expect(slow.errors[0].retryable).toBe(true);
    const broken = apply(active, { type: "fail", at, kind: "auth", message: "401" });
    expect(broken).toMatchObject({ status: "error", enabled: false });
    expect(broken.errors[0].retryable).toBe(false);
  });

  it("applies permissions without losing the others and refuses invalid ones", () => {
    const connection = apply(newConnection("whatsapp"), { type: "setPermissions", actor, at, permissions: { receiveMessages: "auto" } }, { type: "setPermissions", actor, at, permissions: { sendMessages: "approval" } });
    expect(connection.permissions).toMatchObject({ receiveMessages: "auto", sendMessages: "approval", sendTemplates: "off" });
    expect(reduce(connection, { type: "setPermissions", actor, at, permissions: { sendMessages: "auto" } }).error).toBeDefined();
  });
});

describe("logs and audit", () => {
  it("records who did what, with no secret in the trail", () => {
    const connection = apply(newConnection("stripe"), { type: "configure", actor, at, config: validStripe }, { type: "activate", actor, at });
    expect(connection.audit.map((entry) => entry.action)).toEqual(["connect", "activate"]);
    expect(connection.audit.every((entry) => entry.actor === actor)).toBe(true);
    expect(JSON.stringify([connection.audit, connection.logs])).not.toContain("secret:stripe-main");
  });

  it("attributes failures to the system and never drops an entry", () => {
    let connection = newConnection("stripe");
    for (let index = 0; index < 500; index += 1) connection = apply(connection, { type: "fail", at, kind: "network", message: `n${index}` });
    expect(connection.logs).toHaveLength(500);
    expect(connection.errors).toHaveLength(500);
    expect(connection.audit).toHaveLength(500);
    expect(connection.audit.at(-1)?.actor).toBe("system");
    expect(connection.errors[0].message).toBe("n0");
    expect(connection.errors.at(-1)?.message).toBe("n499");
  });
});
