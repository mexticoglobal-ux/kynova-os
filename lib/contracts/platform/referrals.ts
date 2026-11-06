// Referrals module contracts: programs, attribution and rewards. Rewards are paid through the Payments module (Level 3).

import type { Money } from "./payments";

export type RewardRule = { kind: "fixed"; amount: Money } | { kind: "percent"; basisPoints: number; currency: string; capMinor?: number };

export type ReferralProgram = {
  id: string;
  tenantId: string;
  name: string;
  status: "draft" | "active" | "paused" | "ended";
  reward: RewardRule;
  // A conversion counts for the referrer only if the referred person's first touch is this recent.
  attributionWindowDays: number;
  minSaleMinor: number;
};

export type Touch = { referrerId: string; at: string; code: string };

/** Last-touch attribution inside the window. Returns the referrer that earns the reward, or null. */
export function attribute(touches: readonly Touch[], convertedAt: string, windowDays: number): Touch | null {
  const end = Date.parse(convertedAt);
  const windowMs = windowDays * 86_400_000;
  const valid = touches.filter((touch) => {
    const at = Date.parse(touch.at);
    return !Number.isNaN(at) && at <= end && end - at <= windowMs;
  });
  return valid.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
}

/** Integer reward in minor units, never negative, rounded down so the company never pays more than the rule says. */
export function rewardFor(program: Pick<ReferralProgram, "reward" | "minSaleMinor">, sale: Money): Money {
  if (sale.amountMinor < program.minSaleMinor) return { amountMinor: 0, currency: sale.currency };
  const { reward } = program;
  if (reward.kind === "fixed") return { amountMinor: reward.amount.currency === sale.currency ? reward.amount.amountMinor : 0, currency: reward.amount.currency };
  const raw = Math.floor((sale.amountMinor * reward.basisPoints) / 10_000);
  return { amountMinor: Math.min(raw, reward.capMinor ?? raw), currency: reward.currency };
}

export type FraudSignal = "selfReferral" | "sameEmail" | "sameDevice" | "refundedSale";

/** Signals that hold a reward for a person to review: the platform never pays out automatically on any of them. */
export function fraudSignals(input: { referrerEmail: string; referredEmail: string; referrerContactId?: string; referredContactId?: string; sameDevice?: boolean; saleRefunded?: boolean }): FraudSignal[] {
  const signals: FraudSignal[] = [];
  if (input.referrerContactId && input.referrerContactId === input.referredContactId) signals.push("selfReferral");
  if (input.referrerEmail.trim().toLowerCase() === input.referredEmail.trim().toLowerCase()) signals.push("sameEmail");
  if (input.sameDevice) signals.push("sameDevice");
  if (input.saleRefunded) signals.push("refundedSale");
  return signals;
}

export const REWARD_STATUSES = ["pending", "held", "approved", "paid", "rejected"] as const;
export type RewardStatus = (typeof REWARD_STATUSES)[number];
