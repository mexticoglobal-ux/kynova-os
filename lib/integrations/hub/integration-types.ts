// Universal Integration Hub (Sprint 42): the ONE contract every external service implements, and the types the whole layer shares. A provider (Google, Outlook, WhatsApp, Stripe, Slack, any future
// API) is a set of eight methods and a manifest; nothing in the platform depends on a specific provider, and nothing talks to one except through the Hub:
//
//     Worker -> Connector -> Integration Hub -> Provider
//
// Pure types and two tiny helpers: no network, no secrets, no clock. Tokens and message contents never appear in any type here: a provider hands back counts, ids and kinds.

// ---------------------------------------------------------------- failures: a kind, whether it is worth retrying, and nothing else (never a token, a body or a provider's words)
export const FAILURE_KINDS = ["auth", "scope", "rateLimit", "timeout", "provider", "network", "notFound", "invalid", "notConnected", "unsupported"] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];
export type ProviderFailure = { kind: FailureKind; message: string; retryable: boolean; retryAfterMs?: number };
export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: ProviderFailure };
export const ok = <T>(value: T): ProviderResult<T> => ({ ok: true, value });
/** Kinds worth retrying by default: a limit, a timeout, a provider or network hiccup. Authorization, scope and bad requests are never retried: another attempt cannot fix them. */
export const RETRYABLE_KINDS: readonly FailureKind[] = ["rateLimit", "timeout", "provider", "network"];
export const failure = (kind: FailureKind, message: string, over: { retryable?: boolean; retryAfterMs?: number } = {}): ProviderResult<never> => ({
  ok: false, error: { kind, message, retryable: over.retryable ?? RETRYABLE_KINDS.includes(kind), ...(over.retryAfterMs !== undefined ? { retryAfterMs: over.retryAfterMs } : {}) },
});

// ---------------------------------------------------------------- what a provider can do: capabilities
/** A capability is a universal verb ("mail.send", "calendar.create", "files.upload"): callers ask for the capability, never for a provider's own operation. */
export type Capability = {
  id: string; label: string; kind: "read" | "write";
  /** it leaves the platform or changes the customer's data: always behind a person (Level 3) */
  external: boolean;
};
export const CATEGORIES = ["email", "calendar", "files", "messaging", "social", "video", "payments", "chat", "commerce", "crm", "other"] as const;
export type Category = (typeof CATEGORIES)[number];
export const PROVIDER_TYPES = ["oauth2", "apiKey", "webhook", "custom"] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number];

export type ScopeDef = { id: string; label: string; effect: "read" | "write" };
export type RateLimitSpec = { perMinute: number; perHour: number; perDay: number; burst: number };
export type HealthTargets = { latencyTargetMs: number; syncMaxAgeMs: number };
export type BreakerSpec = { failureThreshold: number; cooldownMs: number; deadAfterOpens: number };
export type RetrySpec = { maxAttempts: number; baseMs: number; factor: number; maxMs: number; jitter: number };
/** What a provider registers: who it is and what it promises. Every number is a REFERENCE value to verify against the provider's own documentation. */
export type ProviderManifest = {
  id: string; name: string; category: Category; type: ProviderType; version: string;
  permissions: readonly string[]; scopes: readonly ScopeDef[]; rateLimits: RateLimitSpec; health: HealthTargets; capabilities: readonly Capability[];
  retry?: Partial<RetrySpec>; breaker?: Partial<BreakerSpec>; timeoutMs?: number;
};

// ---------------------------------------------------------------- the contract
export type ProviderContext = {
  tenantId: string; connectionId: string; now: number; traceId: string;
  /** the Worker acting (execute, sync) */ workerId?: string;
  /** the person acting (connect, disconnect, refresh) */ actorId?: string;
  /** the person who approved this operation (an external write) */ approvedBy?: string;
};
export type ConnectInput = { phase: "start"; scopes: readonly string[]; redirectUri: string; target?: string } | { phase: "callback"; state: string; code?: string; error?: string; redirectUri: string; target?: string };
export type ConnectOutput = { status: "pending" | "connected" | "failed"; authorizationUrl?: string; accountRef?: string; tokenRef?: string };
export type HealthProbe = { ok: boolean; latencyMs: number; oauth: "authorized" | "pending" | "revoked" | "none" | "n/a"; tokenState: "valid" | "expiringSoon" | "expired" | "revoked" | "none"; lastSyncAt?: string };
export type SyncInput = { kind: string; cursor?: string };
export type SyncOutput = { kind: string; items: number; cursor?: string };
export type ExecuteInput = { capability: string; params: Readonly<Record<string, unknown>> };
export type ExecuteOutput = { data?: unknown };
export type ValidateInput = { capability: string; params: Readonly<Record<string, unknown>> } | { webhook: { headers: Readonly<Record<string, string>>; body: string } };
export type ValidateOutput = { valid: boolean; issues: readonly string[] };

/** The one contract. A provider implements exactly these eight methods; the Hub does everything else (limits, retries, breakers, health, events, approvals). */
export interface IntegrationProvider {
  readonly manifest: ProviderManifest;
  connect(ctx: ProviderContext, input: ConnectInput): Promise<ProviderResult<ConnectOutput>>;
  disconnect(ctx: ProviderContext): Promise<ProviderResult<{ revoked: boolean }>>;
  refresh(ctx: ProviderContext): Promise<ProviderResult<{ renewed: boolean; expiresAt?: number }>>;
  health(ctx: ProviderContext): Promise<ProviderResult<HealthProbe>>;
  sync(ctx: ProviderContext, input: SyncInput): Promise<ProviderResult<SyncOutput>>;
  execute(ctx: ProviderContext, input: ExecuteInput): Promise<ProviderResult<ExecuteOutput>>;
  validate(ctx: ProviderContext, input: ValidateInput): Promise<ProviderResult<ValidateOutput>>;
  capabilities(): readonly Capability[];
}
export const CONTRACT_METHODS = ["connect", "disconnect", "refresh", "health", "sync", "execute", "validate", "capabilities"] as const;

// ---------------------------------------------------------------- who calls the Hub
/** Only a Worker (through its Connector) reaches the Hub to execute or sync. Agents, modules and screens do not. `system` is the platform's own scheduler. */
export type Caller = { kind: "worker"; workerId: string; tenantId: string; connectorId: string } | { kind: "system"; tenantId: string; reason: string };
export type Actor = { kind: "person" | "worker" | "system" | "agent" | "module"; id: string };
export const isPersonActor = (actor: Actor): boolean => actor.kind === "person" && actor.id.trim() !== "" && !actor.id.startsWith("worker:") && actor.id !== "system";

// ---------------------------------------------------------------- the engine's deps (injected: the layer holds no clock and no timers of its own)
export type Deps = { now: () => number; sleep: (ms: number) => Promise<void>; timeout: (ms: number) => Promise<"timeout"> };
export const realDeps: Deps = { now: () => Date.now(), sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)), timeout: (ms) => new Promise((resolve) => setTimeout(() => resolve("timeout"), ms)) };

export type ConnectionStatus = "disconnected" | "pending" | "connected" | "error" | "dead";
export type Connection = {
  id: string; tenantId: string; providerId: string; status: ConnectionStatus; accountRef?: string; tokenRef?: string; createdBy: string; createdAt: string; connectedAt?: string; lastSyncAt?: string; lastError?: { at: string; kind: FailureKind; message: string };
};
