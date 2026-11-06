// Interfaces for connecting channels and payment providers later (ADR-0010, docs/architecture/integrations.md).
// Nothing implements them yet: only the web chat exists, inside the app. Every channel ends in the same pipeline
// by producing a NormalizedInbound; every provider reports payments as NormalizedPayment.

import type { ConversationChannel, PaymentRail } from "@/lib/contracts/pipeline";

export type NormalizedInbound = {
  provider: ConversationChannel;
  integrationAccountId: string;
  externalEventId: string;
  externalThreadId?: string;
  sender: { kind: "email" | "phone" | "whatsapp" | "facebook_psid" | "instagram_igsid" | "web_visitor"; providerScopedId: string; displayName?: string; locale?: string };
  receivedAt: string;
  sentAt?: string;
  content: { type: "text" | "media" | "choice" | "event"; text?: string; payload?: Record<string, unknown> };
  consent?: { purpose: "data_processing" | "marketing_email" | "whatsapp_optin"; noticeVersion: string };
};

// Sending needs cover: an approval or an active authorization. The outbox refuses anything else.
export type OutboundIntent = {
  integrationAccountId: string;
  conversationId: string;
  content: { type: "text" | "template"; text?: string; templateId?: string; parameters?: string[] };
  idempotencyKey: string;
  approvalRequestId?: string;
  authorizationId?: string;
};

export type PaymentStatus = "pending" | "succeeded" | "failed" | "refunded" | "disputed";

// Amounts are integers in minor units (cents) with an explicit currency: never floats.
export type NormalizedPayment = {
  provider: PaymentRail;
  integrationAccountId: string;
  providerPaymentId: string;
  eventType: string;
  status: PaymentStatus;
  amountMinor: number;
  currency: string;
  feeMinor?: number;
  occurredAt: string;
  references: { opportunityId?: string; customerId?: string; invoiceId?: string };
};

export type InboundRequest = { headers: Headers; body: string };

export interface ChannelAdapter {
  readonly provider: ConversationChannel;
  /** Signature and freshness of the webhook; nothing is stored before this passes. */
  verify(request: InboundRequest): Promise<boolean>;
  parse(request: InboundRequest): Promise<NormalizedInbound[]>;
  send(intent: OutboundIntent): Promise<{ providerMessageId: string }>;
}

export interface PaymentAdapter {
  readonly provider: PaymentRail;
  verify(request: InboundRequest): Promise<boolean>;
  parse(request: InboundRequest): Promise<NormalizedPayment[]>;
  /** Creating a charge or a payment link is a financial action: it always waits for a person's approval. */
  createCharge(input: { amountMinor: number; currency: string; reference: string; idempotencyKey: string }): Promise<{ url: string; providerPaymentId: string }>;
}
