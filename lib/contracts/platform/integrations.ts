// Integrations v1: what a provider is, how it connects and what it may do. Contracts only: no provider is connected.
// Real connections plug in by adding an adapter (lib/integrations/types.ts) for a manifest declared here.

export const INTEGRATION_CATEGORIES = ["conversation", "payment", "calendar"] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export const PROVIDER_IDS = [
  "webChat", "whatsapp", "facebook", "instagram", "email",
  "stripe", "paypal", "makapay", "makawallet", "sinpe", "bankTransfer", "crypto",
  "googleCalendar",
] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const AUTH_KINDS = ["oauth2", "apiKey", "webhookSecret", "none", "undefined"] as const;
export type AuthKind = (typeof AUTH_KINDS)[number];

export const CAPABILITIES = [
  "receiveMessages", "sendMessages", "sendTemplates", "receiveAttachments",
  "createCharge", "refund", "reconcile", "receivePayments",
  "readCalendar", "writeCalendar",
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// Capabilities that reach outside the platform or move money: always behind an approval (Level 3) unless an
// authorization explicitly covers them (ADR-0009). Reading never needs one.
export const EXTERNAL_EFFECTS: readonly Capability[] = ["sendMessages", "sendTemplates", "createCharge", "refund", "writeCalendar"];

export const CONNECTION_STATUSES = ["notConnected", "pending", "active", "degraded", "paused", "error", "revoked"] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

const TRANSITIONS: Record<ConnectionStatus, readonly ConnectionStatus[]> = {
  notConnected: ["pending"],
  pending: ["active", "error", "notConnected"],
  active: ["degraded", "paused", "error", "revoked"],
  degraded: ["active", "error", "paused", "revoked"],
  paused: ["active", "revoked"],
  error: ["pending", "active", "revoked"],
  revoked: ["notConnected"],
};

export const canTransitionConnection = (from: ConnectionStatus, to: ConnectionStatus): boolean => TRANSITIONS[from].includes(to);

export type ProviderManifest = {
  id: ProviderId;
  label: string;
  category: IntegrationCategory;
  // How a company connects it. "undefined" means the provider's API is not known yet (MakaPay, MakaWallet, SINPE).
  authKinds: readonly AuthKind[];
  capabilities: readonly Capability[];
  // How inbound requests are authenticated. "pending" until the provider's documentation is available.
  webhook: "signedHmac" | "providerVerified" | "none" | "pending";
  sandbox: boolean;
  // What must be confirmed before building the adapter. Empty only when nothing is uncertain.
  toVerify: readonly string[];
};

export const PROVIDER_MANIFESTS: Record<ProviderId, ProviderManifest> = {
  webChat: { id: "webChat", label: "Chat web", category: "conversation", authKinds: ["none"], capabilities: ["receiveMessages", "sendMessages", "receiveAttachments"], webhook: "none", sandbox: true, toVerify: [] },
  whatsapp: {
    id: "whatsapp", label: "WhatsApp", category: "conversation", authKinds: ["oauth2", "apiKey"], capabilities: ["receiveMessages", "sendMessages", "sendTemplates", "receiveAttachments"],
    webhook: "signedHmac", sandbox: true,
    toVerify: ["Ventana de atención de 24 h y plantillas aprobadas", "Verificación del negocio y revisión de la app", "Opt-in del contacto", "Límites de calidad y de tasa"],
  },
  facebook: {
    id: "facebook", label: "Facebook Messenger", category: "conversation", authKinds: ["oauth2"], capabilities: ["receiveMessages", "sendMessages", "receiveAttachments"],
    webhook: "signedHmac", sandbox: true, toVerify: ["Permisos y revisión de la app", "Reglas de la ventana de respuesta", "El identificador de la persona es por página"],
  },
  instagram: {
    id: "instagram", label: "Instagram", category: "conversation", authKinds: ["oauth2"], capabilities: ["receiveMessages", "sendMessages", "receiveAttachments"],
    webhook: "signedHmac", sandbox: true, toVerify: ["Misma plataforma y revisión que Facebook", "Reglas de mensajería por cuenta profesional"],
  },
  email: {
    id: "email", label: "Correo", category: "conversation", authKinds: ["oauth2", "apiKey"], capabilities: ["receiveMessages", "sendMessages", "receiveAttachments"],
    webhook: "providerVerified", sandbox: true, toVerify: ["Recepción: enrutamiento de Cloudflare o proveedor de entrada", "SPF, DKIM y DMARC por dominio de la empresa", "Baja y cumplimiento de correo comercial"],
  },
  stripe: {
    id: "stripe", label: "Stripe", category: "payment", authKinds: ["apiKey", "oauth2"], capabilities: ["createCharge", "refund", "receivePayments"],
    webhook: "signedHmac", sandbox: true, toVerify: ["Pago alojado por el proveedor (sin datos de tarjeta en KYNOVA)", "Disputas y reembolsos como eventos", "Monedas y países habilitados para la empresa"],
  },
  paypal: {
    id: "paypal", label: "PayPal", category: "payment", authKinds: ["oauth2"], capabilities: ["createCharge", "refund", "receivePayments"],
    webhook: "providerVerified", sandbox: true, toVerify: ["Verificación de firma por su API", "Órdenes y capturas", "Disputas"],
  },
  makapay: {
    id: "makapay", label: "MakaPay", category: "payment", authKinds: ["undefined"], capabilities: ["createCharge", "receivePayments"],
    webhook: "pending", sandbox: false, toVerify: ["Documentación técnica: autenticación, cobros, webhooks, estados y liquidación", "Entorno de pruebas", "Reembolsos"],
  },
  makawallet: {
    id: "makawallet", label: "MakaWallet", category: "payment", authKinds: ["undefined"], capabilities: ["receivePayments"],
    webhook: "pending", sandbox: false, toVerify: ["Documentación técnica", "Si implica saldos, transferencias y retiros además de cobros", "Modelo de liquidación"],
  },
  sinpe: {
    id: "sinpe", label: "SINPE", category: "payment", authKinds: ["none"], capabilities: ["receivePayments", "reconcile"],
    webhook: "none", sandbox: false,
    toVerify: ["Modo manual o asistido: la empresa importa el extracto o la notificación del banco, sin acceso a una API", "Una pasarela o agregador con API sería un proveedor aparte", "Asignación asistida de cada pago, siempre confirmada por una persona"],
  },
  bankTransfer: {
    id: "bankTransfer", label: "Transferencia bancaria", category: "payment", authKinds: ["none"], capabilities: ["receivePayments", "reconcile"],
    webhook: "none", sandbox: true, toVerify: ["Datos de la cuenta receptora por empresa", "Formato del extracto (CSV u otro) o importación manual", "Referencia única por cobro para conciliar"],
  },
  crypto: {
    id: "crypto", label: "Criptomonedas (reservado)", category: "payment", authKinds: ["undefined"], capabilities: ["receivePayments"],
    webhook: "pending", sandbox: false,
    toVerify: ["Redes y activos soportados (BTC, USDC…)", "Custodia propia o procesador", "Confirmaciones y reorganizaciones de la red", "Tratamiento legal y fiscal", "Cantidades por encima de 2^53 (p. ej. wei) necesitan otro tipo numérico"],
  },
  googleCalendar: {
    id: "googleCalendar", label: "Google Calendar", category: "calendar", authKinds: ["oauth2"], capabilities: ["readCalendar", "writeCalendar"],
    webhook: "providerVerified", sandbox: false, toVerify: ["Alcances mínimos (solo disponibilidad primero)", "Verificación de la app de Google", "Calendario por usuario o compartido de la empresa"],
  },
};

export type ManifestIssue = { provider: ProviderId; issue: string };

// A manifest that cannot be built from today: unknown auth without a pending webhook, external effects without a sandbox note, etc.
export function validateManifests(manifests: Record<ProviderId, ProviderManifest> = PROVIDER_MANIFESTS): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  for (const id of PROVIDER_IDS) {
    const manifest = manifests[id];
    if (!manifest || manifest.id !== id) issues.push({ provider: id, issue: "missing or mismatched id" });
    else {
      if (manifest.capabilities.length === 0) issues.push({ provider: id, issue: "no capabilities" });
      if (manifest.authKinds.includes("undefined") && manifest.webhook !== "pending") issues.push({ provider: id, issue: "unknown auth must keep the webhook pending" });
      if (manifest.authKinds.includes("undefined") && manifest.toVerify.length === 0) issues.push({ provider: id, issue: "unknown provider must say what to verify" });
      if (manifest.category === "payment" && !manifest.capabilities.some((capability) => capability === "receivePayments")) issues.push({ provider: id, issue: "a payment provider must report payments" });
    }
  }
  return issues;
}

/** The capabilities of a provider that always wait for a person's approval. */
export const approvalCapabilities = (manifest: ProviderManifest): Capability[] => manifest.capabilities.filter((capability) => EXTERNAL_EFFECTS.includes(capability));
