import { z } from "zod";
import type { Role } from "@/config/roles";

/**
 * Company Integrations Framework: the single place where a company's connections to outside platforms are described and their state is recorded.
 * It defines contracts, states, capabilities and non-secret configuration ONLY. No API is called, there is no OAuth and nothing is synced.
 * Every other system depends on this framework; it depends on none of them.
 */
export const STATUSES = ["not_configured", "pending", "connected", "error", "coming_soon"] as const;
export type Status = (typeof STATUSES)[number];
/** States a company can hold for a connector that exists. `coming_soon` is a property of the connector, never stored. */
export const STORED = ["not_configured", "pending", "connected", "error"] as const;
export type Stored = (typeof STORED)[number];
export const KINDS = ["analytics", "search", "social", "productivity", "commerce", "infrastructure", "payments"] as const;
export type Kind = (typeof KINDS)[number];
export type Health = "ok" | "error" | "unknown";

/** A connector contract. Adding a platform (TikTok, Stripe, Slack...) means adding one of these, never changing the framework. */
export interface ConnectorDef {
  key: string;
  name: string;
  kind: Kind;
  /** What a connected account would let an AI Employee do. Declarative only. */
  capabilities: readonly string[];
  /** Non-secret identifiers the company can register (a property id, a site URL). Secrets never live here. */
  fields: readonly string[];
  /** True only when a working adapter ships with the product. Until then the connector is shown as "coming soon". */
  available: boolean;
}
export interface IntegrationRecord {
  tenantId: string; connector: string; status: Stored; config: Record<string, string>;
  /** Reference to a future secret vault entry. The framework never stores a token or any secret value. */
  credentialRef: string | null; lastSyncAt: number | null; updatedBy: string; createdAt: number; updatedAt: number;
}
export type Capability = "view" | "manage";
const MANAGE: ReadonlySet<Role> = new Set<Role>(["super_admin", "owner", "ceo", "administrator", "manager", "marketing"]);
const VIEW: ReadonlySet<Role> = new Set<Role>([...MANAGE, "sales", "finance"]);
export const allows = (role: Role, c: Capability): boolean => (c === "manage" ? MANAGE : VIEW).has(role);

export const configureInput = z.strictObject({ config: z.record(z.string().max(60), z.string().trim().max(160)) });
export const connectorKeyInput = z.string().regex(/^[a-z0-9_]{2,40}$/);
