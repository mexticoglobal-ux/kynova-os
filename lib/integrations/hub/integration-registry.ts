// The Integration Registry: the one list of every provider KYNOVA knows. A provider REGISTERS its manifest (id, name, category, type, version, permissions, scopes, rate limits, health targets and
// capabilities) together with the object that implements the contract; a provider only DECLARED has a manifest and no adapter yet (it cannot be connected, and the registry says so). The Hub
// asks the registry "who can do mail.send?", never "is it Google?": that is what lets any future API plug in without changing the core.

import { validateRateLimits } from "./integration-rate-limit";
import { CATEGORIES, CONTRACT_METHODS, PROVIDER_TYPES, type Capability, type IntegrationProvider, type ProviderManifest } from "./integration-types";

const ID = /^[a-z][a-z0-9-]{1,39}$/;
const SEMVER = /^\d+\.\d+\.\d+$/;
const CAPABILITY_ID = /^[a-z]+(\.[a-zA-Z]+)+$/;

/** What is wrong with a manifest (empty when it is valid). A manifest is checked when it is registered, so the rest of the Hub can trust it. */
export function validateManifest(manifest: ProviderManifest): string[] {
  const issues: string[] = [];
  if (!ID.test(manifest.id)) issues.push("id");
  if (manifest.name.trim().length < 2) issues.push("name");
  if (!(CATEGORIES as readonly string[]).includes(manifest.category)) issues.push("category");
  if (!(PROVIDER_TYPES as readonly string[]).includes(manifest.type)) issues.push("type");
  if (!SEMVER.test(manifest.version)) issues.push("version");
  if (manifest.scopes.some((scope) => !scope.id || !["read", "write"].includes(scope.effect))) issues.push("scopes");
  if (new Set(manifest.scopes.map((scope) => scope.id)).size !== manifest.scopes.length) issues.push("scopes:duplicate");
  for (const issue of validateRateLimits(manifest.rateLimits)) issues.push(`rateLimits:${issue}`);
  if (!(manifest.health.latencyTargetMs > 0) || !(manifest.health.syncMaxAgeMs > 0)) issues.push("health");
  if (manifest.capabilities.length === 0) issues.push("capabilities");
  if (manifest.capabilities.some((cap) => !CAPABILITY_ID.test(cap.id))) issues.push("capabilities:id");
  if (new Set(manifest.capabilities.map((cap) => cap.id)).size !== manifest.capabilities.length) issues.push("capabilities:duplicate");
  // a write that leaves the platform is the only kind of write there is: reading can never be external
  if (manifest.capabilities.some((cap) => cap.kind === "read" && cap.external)) issues.push("capabilities:readExternal");
  if (manifest.timeoutMs !== undefined && !(manifest.timeoutMs >= 100)) issues.push("timeoutMs");
  return issues;
}

export type RegistryEntry = { manifest: ProviderManifest; provider?: IntegrationProvider; registered: boolean };
export class IntegrationRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  /** Registers a provider: its manifest must be valid, it must implement the whole contract and declare exactly the capabilities of its manifest. */
  register(provider: IntegrationProvider): { ok: true } | { ok: false; issues: string[] } {
    const issues = validateManifest(provider.manifest);
    for (const method of CONTRACT_METHODS) if (typeof (provider as unknown as Record<string, unknown>)[method] !== "function") issues.push(`contract:${method}`);
    if (issues.length === 0) {
      const declared = provider.capabilities().map((cap) => cap.id).sort().join(",");
      const promised = provider.manifest.capabilities.map((cap) => cap.id).sort().join(",");
      if (declared !== promised) issues.push("capabilities:mismatch");
    }
    if (this.entries.get(provider.manifest.id)?.registered) issues.push("duplicate");
    if (issues.length) return { ok: false, issues };
    this.entries.set(provider.manifest.id, { manifest: provider.manifest, provider, registered: true });
    return { ok: true };
  }
  /** Declares a provider that has no adapter yet: it is listed (so the platform knows it is coming) but cannot be connected. */
  declare(manifest: ProviderManifest): { ok: true } | { ok: false; issues: string[] } {
    const issues = validateManifest(manifest);
    if (this.entries.has(manifest.id)) issues.push("duplicate");
    if (issues.length) return { ok: false, issues };
    this.entries.set(manifest.id, { manifest, registered: false });
    return { ok: true };
  }
  get(id: string): RegistryEntry | undefined { return this.entries.get(id); }
  /** The adapter of a registered provider, or undefined. */
  providerOf(id: string): IntegrationProvider | undefined { return this.entries.get(id)?.provider; }
  list(): readonly RegistryEntry[] { return [...this.entries.values()].sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)); }
  registered(): readonly RegistryEntry[] { return this.list().filter((row) => row.registered); }
  byCategory(category: string): readonly RegistryEntry[] { return this.list().filter((row) => row.manifest.category === category); }
  /** Who can do this capability (registered providers only): the Hub's only way to choose a provider. */
  byCapability(capabilityId: string): readonly RegistryEntry[] { return this.registered().filter((row) => row.manifest.capabilities.some((cap) => cap.id === capabilityId)); }
  capability(providerId: string, capabilityId: string): Capability | undefined { return this.entries.get(providerId)?.manifest.capabilities.find((cap) => cap.id === capabilityId); }
}

// ---------------------------------------------------------------- the providers KYNOVA expects to connect: declared, not connected
const cap = (id: string, label: string, kind: "read" | "write", external = kind === "write"): Capability => ({ id, label, kind, external });
const scope = (id: string, label: string, effect: "read" | "write") => ({ id, label, effect });
const limits = (perMinute: number, perHour: number, perDay: number, burst: number) => ({ perMinute, perHour, perDay, burst });
const health = (latencyTargetMs: number, syncMaxAgeMs = 3_600_000) => ({ latencyTargetMs, syncMaxAgeMs });
const declared = (m: Omit<ProviderManifest, "version" | "permissions"> & { version?: string; permissions?: readonly string[] }): ProviderManifest => ({ version: "0.1.0", permissions: m.scopes.map((row) => row.id), ...m });

/** Every limit and target below is a REFERENCE value, to verify against each provider's own documentation when its adapter is written. */
export const DECLARED_MANIFESTS: readonly ProviderManifest[] = [
  declared({ id: "outlook", name: "Outlook", category: "email", type: "oauth2", scopes: [scope("mail.read", "Leer correos", "read"), scope("mail.send", "Enviar correos", "write")], rateLimits: limits(600, 10_000, 100_000, 30), health: health(900), capabilities: [cap("mail.search", "Buscar correos", "read"), cap("mail.read", "Leer un correo", "read"), cap("mail.send", "Enviar un correo", "write"), cap("mail.reply", "Responder un correo", "write")] }),
  declared({ id: "whatsapp", name: "WhatsApp Business", category: "messaging", type: "oauth2", scopes: [scope("messages.receive", "Recibir mensajes", "read"), scope("messages.send", "Enviar mensajes", "write")], rateLimits: limits(80, 3_000, 50_000, 20), health: health(1_200), capabilities: [cap("messages.list", "Ver mensajes", "read"), cap("messages.send", "Enviar un mensaje", "write")] }),
  declared({ id: "meta", name: "Meta (Facebook e Instagram)", category: "social", type: "oauth2", scopes: [scope("pages.read", "Leer páginas", "read"), scope("pages.publish", "Publicar", "write")], rateLimits: limits(200, 4_800, 80_000, 25), health: health(1_200), capabilities: [cap("social.read", "Leer publicaciones y comentarios", "read"), cap("social.publish", "Publicar", "write"), cap("messages.list", "Ver mensajes", "read"), cap("messages.send", "Enviar un mensaje", "write")] }),
  declared({ id: "stripe", name: "Stripe", category: "payments", type: "apiKey", scopes: [scope("payments.read", "Leer pagos", "read"), scope("payments.write", "Cobrar y reembolsar", "write")], rateLimits: limits(100, 6_000, 100_000, 25), health: health(600), capabilities: [cap("payments.list", "Ver pagos", "read"), cap("payments.charge", "Cobrar", "write"), cap("payments.refund", "Reembolsar", "write")] }),
  declared({ id: "makapay", name: "MakaPay", category: "payments", type: "custom", scopes: [scope("payments.read", "Leer pagos", "read"), scope("payments.write", "Cobrar", "write")], rateLimits: limits(60, 1_800, 20_000, 10), health: health(900), capabilities: [cap("payments.list", "Ver pagos", "read"), cap("payments.charge", "Cobrar", "write")] }),
  declared({ id: "paypal", name: "PayPal", category: "payments", type: "oauth2", scopes: [scope("payments.read", "Leer pagos", "read"), scope("payments.write", "Cobrar y reembolsar", "write")], rateLimits: limits(60, 2_400, 30_000, 15), health: health(900), capabilities: [cap("payments.list", "Ver pagos", "read"), cap("payments.charge", "Cobrar", "write"), cap("payments.refund", "Reembolsar", "write")] }),
  declared({ id: "linkedin", name: "LinkedIn", category: "social", type: "oauth2", scopes: [scope("company.read", "Leer la página", "read"), scope("company.publish", "Publicar", "write")], rateLimits: limits(30, 1_000, 10_000, 8), health: health(1_500), capabilities: [cap("social.read", "Leer publicaciones y comentarios", "read"), cap("social.publish", "Publicar", "write")] }),
  declared({ id: "tiktok", name: "TikTok Business", category: "video", type: "oauth2", scopes: [scope("videos.read", "Leer videos", "read"), scope("videos.publish", "Publicar", "write")], rateLimits: limits(30, 1_000, 10_000, 8), health: health(1_500), capabilities: [cap("video.list", "Ver videos", "read"), cap("video.publish", "Publicar un video", "write")] }),
  declared({ id: "youtube", name: "YouTube", category: "video", type: "oauth2", scopes: [scope("videos.read", "Leer videos", "read"), scope("videos.upload", "Subir videos", "write")], rateLimits: limits(60, 1_800, 10_000, 10), health: health(1_200), capabilities: [cap("video.list", "Ver videos", "read"), cap("video.publish", "Publicar un video", "write"), cap("social.read", "Leer comentarios", "read")] }),
  declared({ id: "slack", name: "Slack", category: "chat", type: "oauth2", scopes: [scope("chat.read", "Leer mensajes", "read"), scope("chat.write", "Enviar mensajes", "write")], rateLimits: limits(60, 3_600, 50_000, 15), health: health(700), capabilities: [cap("chat.list", "Ver mensajes", "read"), cap("chat.send", "Enviar un mensaje", "write")] }),
  declared({ id: "discord", name: "Discord", category: "chat", type: "apiKey", scopes: [scope("chat.read", "Leer mensajes", "read"), scope("chat.write", "Enviar mensajes", "write")], rateLimits: limits(50, 3_000, 40_000, 12), health: health(700), capabilities: [cap("chat.list", "Ver mensajes", "read"), cap("chat.send", "Enviar un mensaje", "write")] }),
  declared({ id: "shopify", name: "Shopify", category: "commerce", type: "oauth2", scopes: [scope("orders.read", "Leer pedidos", "read"), scope("products.write", "Cambiar productos", "write")], rateLimits: limits(120, 7_200, 100_000, 40), health: health(800), capabilities: [cap("orders.list", "Ver pedidos", "read"), cap("products.update", "Cambiar un producto", "write")] }),
  declared({ id: "hubspot", name: "HubSpot", category: "crm", type: "oauth2", scopes: [scope("contacts.read", "Leer contactos", "read"), scope("contacts.write", "Cambiar contactos", "write")], rateLimits: limits(100, 6_000, 250_000, 25), health: health(800), capabilities: [cap("contacts.list", "Ver contactos", "read"), cap("contacts.upsert", "Crear o cambiar un contacto", "write")] }),
  declared({ id: "salesforce", name: "Salesforce", category: "crm", type: "oauth2", scopes: [scope("contacts.read", "Leer contactos", "read"), scope("contacts.write", "Cambiar contactos", "write")], rateLimits: limits(100, 5_000, 100_000, 25), health: health(1_000), capabilities: [cap("contacts.list", "Ver contactos", "read"), cap("contacts.upsert", "Crear o cambiar un contacto", "write")] }),
];
/** A registry with every expected provider declared. Adapters register on top as their sprints land. */
export function registryWithDeclared(): IntegrationRegistry { const registry = new IntegrationRegistry(); for (const manifest of DECLARED_MANIFESTS) registry.declare(manifest); return registry; }
