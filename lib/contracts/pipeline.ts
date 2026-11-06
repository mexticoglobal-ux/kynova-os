import type { AuditBand, AuditDimension, Infrastructure } from "@/lib/contracts/audit";

// Commercial pipeline: the one place where every prospect ends up, whatever channel it came from.
// Channels and payment rails are declared here but NOT implemented: only the web chat exists, in demo mode.
// To add a channel later, write an adapter that turns its messages into a `LeadIntake`; the pipeline does not change.

export const CONVERSATION_CHANNELS = ["webChat", "whatsapp", "facebook", "instagram", "email", "form"] as const;
export type ConversationChannel = (typeof CONVERSATION_CHANNELS)[number];

export const PAYMENT_RAILS = ["stripe", "paypal", "makapay", "makawallet", "sinpe"] as const;
export type PaymentRail = (typeof PAYMENT_RAILS)[number];

export type ChannelStatus = "demo" | "planned";

// What exists today. Everything marked "planned" has no code behind it yet.
export const CHANNEL_STATUS: Record<ConversationChannel | PaymentRail, ChannelStatus> = {
  webChat: "demo",
  whatsapp: "planned",
  facebook: "planned",
  instagram: "planned",
  email: "planned",
  form: "planned",
  stripe: "planned",
  paypal: "planned",
  makapay: "planned",
  makawallet: "planned",
  sinpe: "planned",
};

export const STAGES = ["new", "needsFollowUp", "meetingRequested", "won"] as const;
export type Stage = (typeof STAGES)[number];

export const PRIORITIES = ["high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];

// How the commercial team should treat the prospect: graded by the client's rules, or handed to a person.
export type Grade = "hot" | "warm" | "cold" | "human";

export type ContactMethod = "email" | "whatsapp" | "phone";

// A meeting request NEX prepared. It contacts a prospect for the first time, so it always waits for an owner's approval.
export type MeetingApproval = { kind: "meeting"; draft: string };

export type Lead = {
  id: string;
  channel: ConversationChannel;
  // "overnight": already there when the owner arrived (demo seed). "session": arrived while the owner was using the app.
  arrival: "overnight" | "session";
  company: string;
  contactName: string;
  contact: { method: ContactMethod; value: string } | null;
  score: number | null;
  band: AuditBand | null;
  infrastructure: Infrastructure | null;
  // The plain-language sentence that goes with the score.
  status: string | null;
  grade: Grade;
  points: number | null;
  reasons: string[];
  priority: Priority;
  services: string[];
  topGaps: AuditDimension[];
  challenge?: string;
  question?: string;
  stage: Stage;
  nextAction: string;
  owner: string;
  approval: MeetingApproval | null;
  // The database id of the pending approval (backend mode only).
  approvalId?: string;
};

// Normalised shape every conversation channel must produce. The web chat's handoff already has it (see lib/pipeline.ts).
export type LeadIntake = {
  channel: ConversationChannel;
  company?: string;
  contactName?: string;
  contact: { method: ContactMethod; value: string } | null;
};

// A payment that belongs to a lead. Reserved for the payments sprint: nothing produces or consumes it yet.
export type PaymentEvent = {
  rail: PaymentRail;
  leadId: string;
  amountMinor: number;
  currency: string;
  status: "pending" | "paid" | "failed";
};
