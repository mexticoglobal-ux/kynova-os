// NEX Executive Copilot: the vocabulary. The Copilot is the digital executive of each company: before it answers or proposes anything it consults the RAG (which consults the Memory Engine and the
// Knowledge Graph) and KOE (the platform's statistics), understands the business, finds problems, opportunities and risks, builds a deterministic plan, ranks recommendations and PREPARES actions.
// It never executes anything: every action is only a suggestion that a person with enough role must approve, by the autonomy level the platform already assigns (ADR-0009), and even an approved action
// is only recorded as approved. Everything is rules and pure reducers: no clock (every event carries `at`), no database, no network, no AI.

import type { BusinessModule } from "@/lib/contracts/platform/koe-ledger";
import type { Insights, InsightsInput } from "@/lib/contracts/platform/koe-insights";
import type { AutonomyLevel } from "@/lib/contracts/platform/workers";
import type { Principal } from "@/lib/nex/memory";
import type { Intent, RagConfig, RagState } from "@/lib/nex/rag";

export type { AutonomyLevel, Insights, Intent, Principal };
export type Role = "viewer" | "member" | "manager" | "admin" | "owner";

export const PLAN_TYPES = ["sales", "marketing", "finance", "operations", "crm", "automations", "ai", "growth", "support", "organization"] as const;
export type PlanType = (typeof PLAN_TYPES)[number];
export const FINDING_KINDS = ["problem", "opportunity", "risk"] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];
/** The platform's business modules, plus the NEX layers a recommendation can involve. */
export type InvolvedModule = BusinessModule | "memory" | "knowledge" | "insights" | "billing" | "comms" | "organization" | "ai";
export type Horizon = "now" | "week" | "month" | "quarter";

/** Something the Copilot found out about the business. It carries numbers and ids as evidence, never the text of a memory. */
export type Finding = { id: string; kind: FindingKind; area: PlanType; /** 0–100 */ severity: number; evidence: readonly string[]; modules: readonly InvolvedModule[]; needs: "general" | "finance" };
export type Objective = { id: string; source: "session" | "knowledge" | "default"; label: string };

export type Recommendation = {
  id: string; findingId: string; kind: FindingKind; severity: Severity; /** 0–100: the finding's severity */ score: number; area: PlanType; title: string;
  /** why (motivo) */ reason: string; /** what it gets (beneficio) */ benefit: string;
  impact: { level: "high" | "medium" | "low"; score: number }; risk: { level: "high" | "medium" | "low"; note: string };
  modules: readonly InvolvedModule[]; evidence: readonly string[]; needs: "general" | "finance";
};

export type PlanStep = { order: number; title: string; why: string; area: PlanType; recommendationId?: string };
export type Plan = { id: string; type: PlanType; title: string; objective: string; horizon: Horizon; steps: readonly PlanStep[]; basedOn: readonly string[] };

export type ActionStatus = "suggested" | "approved" | "rejected" | "expired";
/** A prepared action. It is NEVER executed here: `executed` is always false, approval only records that a person agreed. */
export type SuggestedAction = {
  readonly id: string; readonly tenantId: string; readonly recommendationId: string;
  /** the platform's own action id, whose level is decided in code (workers.ts) */
  readonly actionId: string; readonly label: string; readonly level: AutonomyLevel;
  readonly requiresApproval: true; readonly approverRole: Role; readonly executed: false; readonly preparedBy: "nex";
  readonly status: ActionStatus; readonly needs: "general" | "finance"; readonly modules: readonly InvolvedModule[];
  readonly suggestedAt: string; readonly expiresAt: string; readonly decidedBy?: string; readonly decidedAt?: string;
};

/** What a session remembers: a topic, an objective, a few decisions and recommendations. Never the conversation. */
export type SessionDecision = { id: string; label: string; at: string };
export type Session = {
  readonly id: string; readonly tenantId: string; /** `person:ana`, `worker:sales`, `system` */ readonly owner: string; readonly startedAt: string; readonly lastAt: string; readonly turns: number;
  readonly topic?: Intent; readonly objective?: string; /** the few meaningful words of the last question, so a short follow-up keeps its topic */ readonly focus: readonly string[];
  readonly decisions: readonly SessionDecision[]; readonly recommendations: readonly { id: string; title: string; severity: Severity }[];
};

export type AuditEntry = { at: string; actor: string; tenantId: string; action: string; detail?: Readonly<Record<string, string | number | boolean>> };
export type CopilotState = { readonly sessions: readonly Session[]; readonly actions: readonly SuggestedAction[]; readonly rag: RagState; readonly seq: Readonly<Record<string, number>>; readonly audit: readonly AuditEntry[] };

export type CopilotConfig = {
  /** a session idle for longer than this is over (ms) */ sessionTtlMs: number;
  /** how long a suggested action waits for a person (ms) */ actionTtlMs: number;
  maxSessions: number; maxActions: number; maxDecisions: number; maxRecommendations: number; maxSteps: number;
  rag: Partial<RagConfig>;
};
export const DEFAULT_CONFIG: CopilotConfig = { sessionTtlMs: 1_800_000, actionTtlMs: 259_200_000, maxSessions: 200, maxActions: 500, maxDecisions: 10, maxRecommendations: 7, maxSteps: 6, rag: {} };

export type AskOptions = { sessionId?: string; objective?: string; planType?: PlanType; topK?: number };

export type KoeInput = InsightsInput;
/** The company decides which workers are active; this layer never guesses. */
export type CopilotEnv = { isWorkerActive(tenantId: string, workerId: string): boolean };

export type DashboardKpi = { id: string; label: string; value: number | null; unit: "count" | "percent" | "hours" | "money_micros"; source: "koe" | "memory" | "graph" | "copilot" };
export type DashboardItem = { id: string; title: string; severity: Severity; score: number; area: PlanType };
export type DashboardAlert = { id: string; severity: Severity; message: string };
export type DashboardData = {
  tenantId: string; generatedAt: string; status: "healthy" | "attention" | "critical" | "unknown"; summary: readonly string[];
  kpis: readonly DashboardKpi[]; risks: readonly DashboardItem[]; opportunities: readonly DashboardItem[]; alerts: readonly DashboardAlert[];
  priorities: readonly (DashboardItem & { rank: number })[]; coverage: { memory: boolean; graph: boolean; koe: boolean };
};

export type Consulted = { rag: boolean; memory: boolean; graph: boolean; koe: boolean };
export type CopilotResponse = {
  sessionId: string; topic: Intent; understanding: { objectives: readonly Objective[]; findings: readonly Finding[]; counts: Readonly<Record<string, number>> };
  context: { items: number; chars: number; sources: readonly { key: string; kind: string; type: string; score: number }[]; lines: readonly string[]; cached: boolean };
  plan: Plan; recommendations: readonly Recommendation[]; actions: readonly SuggestedAction[]; executiveSummary: readonly string[]; text: string; consulted: Consulted;
};

export type Refusal = "tenant" | "forbidden" | "workerInactive" | "invalid" | "sensitive" | "notFound" | "expired" | "level";

type Base = { tenantId: string; actor: Principal; at: string };
export type CopilotEvent =
  | (Base & { type: "ask"; question: string; options?: AskOptions })
  | (Base & { type: "decide"; sessionId: string; label: string })
  | (Base & { type: "end"; sessionId: string })
  | (Base & { type: "approve"; actionId: string })
  | (Base & { type: "reject"; actionId: string })
  | (Base & { type: "dashboard" });

export const COPILOT_EVENT_TYPES = [
  "copilot.asked", "copilot.context", "copilot.planned", "copilot.recommended", "copilot.action_suggested", "copilot.action_approved", "copilot.action_rejected", "copilot.action_expired",
  "copilot.dashboard", "copilot.session_started", "copilot.session_ended", "copilot.decision", "copilot.refused",
] as const;
export type CopilotEventType = (typeof COPILOT_EVENT_TYPES)[number];
/** What happened, without the question, the context or the knowledge: counts and short identifiers. */
export type CopilotEventInput = { at: string; tenantId: string; actorKind: Principal["kind"]; actorId: string; type: CopilotEventType; detail?: Readonly<Record<string, unknown>> };

export type CopilotResult = { ok: boolean; refusal?: Refusal; reasons?: readonly string[]; response?: CopilotResponse; session?: Session; action?: SuggestedAction; dashboard?: DashboardData; events: readonly CopilotEventInput[] };
export type CopilotOutcome = { state: CopilotState; result: CopilotResult };
