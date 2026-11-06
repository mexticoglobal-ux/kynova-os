import { CHANNEL_STATUS, CONVERSATION_CHANNELS, PAYMENT_RAILS, type ChannelStatus } from "@/lib/contracts/pipeline";
import type { ChannelAdapter, PaymentAdapter } from "./types";

// Adapters register here when they exist. Today the registry is empty on purpose: the web chat runs inside the app
// and the rest are only declared (CHANNEL_STATUS).
const channelAdapters = new Map<string, ChannelAdapter>();
const paymentAdapters = new Map<string, PaymentAdapter>();

export const registerChannelAdapter = (adapter: ChannelAdapter) => void channelAdapters.set(adapter.provider, adapter);
export const registerPaymentAdapter = (adapter: PaymentAdapter) => void paymentAdapters.set(adapter.provider, adapter);
export const getChannelAdapter = (provider: string) => channelAdapters.get(provider);
export const getPaymentAdapter = (provider: string) => paymentAdapters.get(provider);

export type IntegrationState = { provider: string; category: "conversation" | "payment"; status: ChannelStatus; connected: boolean };

export function integrationStates(): IntegrationState[] {
  return [
    ...CONVERSATION_CHANNELS.map((provider) => ({ provider, category: "conversation" as const, status: CHANNEL_STATUS[provider], connected: channelAdapters.has(provider) })),
    ...PAYMENT_RAILS.map((provider) => ({ provider, category: "payment" as const, status: CHANNEL_STATUS[provider], connected: paymentAdapters.has(provider) })),
  ];
}

export const isKnownProvider = (provider: string): boolean => [...CONVERSATION_CHANNELS, ...PAYMENT_RAILS].some((known) => known === provider);
