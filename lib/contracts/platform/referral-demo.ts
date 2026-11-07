// Sample data for the local simulation of the Referrals Center. Fictional people and amounts. It is built by applying
// events through the same reducer a real adapter will use, so loading it also proves the rules hold together.

import { reduceReferrals, newReferralState, type ProgramInput, type ReferralEvent, type ReferralState } from "./referral-center";

export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
] as const;

export const DEMO_PROGRAM: ProgramInput = {
  name: "Programa de referidos",
  status: "active",
  currency: "USD",
  reward: { kind: "percent", basisPoints: 1_000, currency: "USD" },
  levels: [],
  levelsEnabled: false, // multi-level is prepared in code and configuration, but switched off for now
  attributionWindowDays: 30,
  minSaleMinor: 1_000,
  approval: { holdDays: 7, autoApproveMaxMinor: 5_000, minPayoutMinor: 1_000 },
  linkBase: "https://kynova.example",
};

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;

/** Builds the sample for one company. Later steps look up the codes and ids the earlier ones produced. */
export function demoReferralState(tenantId: string): { state: ReferralState; errors: string[] } {
  const errors: string[] = [];
  let state = newReferralState(tenantId);
  const send = (event: ReferralEvent) => {
    const result = reduceReferrals(state, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const code = (name: string) => state.affiliates.find((affiliate) => affiliate.name === name)?.code ?? "";
  const id = (name: string) => state.affiliates.find((affiliate) => affiliate.name === name)?.id ?? "";
  const base = { tenantId };

  send({ ...base, at: day(1), type: "program.save", actor: "ana", program: DEMO_PROGRAM });
  send({ ...base, at: day(1), type: "affiliate.enroll", actor: "ana", name: "Marta Solís", email: "marta@nova.test" });
  send({ ...base, at: day(1), type: "affiliate.enroll", actor: "ana", name: "Luis Prado", email: "luis@nova.test", sponsorCode: code("Marta Solís") });
  send({ ...base, at: day(1), type: "affiliate.enroll", actor: "ana", name: "Carla Mena", email: "carla@nova.test" });

  // Marta: one sale that earns a small commission, and a lead that only signed up.
  send({ ...base, at: day(3), type: "referral.click", code: code("Marta Solís"), email: "vida@clinica.test", name: "Clínica Vida" });
  send({ ...base, at: day(4), type: "referral.convert", email: "vida@clinica.test", sale: { amountMinor: 12_000, currency: "USD" }, saleRef: "S-1001" });
  send({ ...base, at: day(3), type: "referral.click", code: code("Marta Solís"), email: "aurora@cafe.test", name: "Café Aurora" });
  send({ ...base, at: day(3), type: "referral.signup", referralId: state.referrals.find((r) => r.email === "aurora@cafe.test")?.id ?? "" });

  // Luis: a large sale, so a person has to review it.
  send({ ...base, at: day(3), type: "referral.click", code: code("Luis Prado"), email: "mar@hotel.test", name: "Hotel Mar" });
  send({ ...base, at: day(5), type: "referral.convert", email: "mar@hotel.test", sale: { amountMinor: 90_000, currency: "USD" }, saleRef: "S-1002" });

  // Carla: her own email as the referred person (held for fraud), and a lead two affiliates touched (last touch wins).
  send({ ...base, at: day(3), type: "referral.click", code: code("Carla Mena"), email: "carla@nova.test", name: "Carla Mena" });
  send({ ...base, at: day(6), type: "referral.convert", email: "carla@nova.test", sale: { amountMinor: 20_000, currency: "USD" }, saleRef: "S-1003" });
  send({ ...base, at: day(2), type: "referral.click", code: code("Luis Prado"), email: "norte@studio.test", name: "Studio Norte" });
  send({ ...base, at: day(4), type: "referral.click", code: code("Carla Mena"), email: "norte@studio.test", name: "Studio Norte" });
  send({ ...base, at: day(7), type: "referral.convert", email: "norte@studio.test", sale: { amountMinor: 5_000, currency: "USD" }, saleRef: "S-1004" });

  // Ten days later the hold has passed: small clean commissions are approved by rule; the large one waits for a person.
  send({ ...base, at: day(20), type: "tick" });
  const large = state.commissions.find((commission) => commission.saleRef === "S-1002");
  send({ ...base, at: day(21), type: "commission.review", actor: "bruno", commissionId: large?.id ?? "", approve: true });

  // Luis's payout is requested, approved by someone else and recorded as paid outside the platform. Marta's waits for a decision.
  send({ ...base, at: day(22), type: "payout.request", actor: "ana", affiliateId: id("Luis Prado"), currency: "USD" });
  const luisPayout = state.payouts[0];
  send({ ...base, at: day(23), type: "payout.decide", actor: "bruno", payoutId: luisPayout?.id ?? "", approve: true });
  send({ ...base, at: day(24), type: "payout.markPaid", actor: "bruno", payoutId: luisPayout?.id ?? "", paymentRef: "TRANSFERENCIA-0042" });
  send({ ...base, at: day(24), type: "payout.request", actor: "ana", affiliateId: id("Marta Solís"), currency: "USD" });
  return { state, errors };
}
