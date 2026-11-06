import { describe, expect, it } from "vitest";
import { CONVERSATION_CHANNELS, PAYMENT_RAILS } from "@/lib/contracts/pipeline";
import { PROVIDER_IDS, PROVIDER_MANIFESTS, approvalCapabilities, canTransitionConnection, validateManifests } from "./integrations";
import { addMoney, canTransitionPayment, isMoney, matchTransfer, netAmount, validatePaymentLink } from "./payments";
import { attribute, fraudSignals, rewardFor } from "./referrals";
import { canTransitionListing, reviewListing, splitRevenue, type Listing } from "./marketplace";
import { eligibleForCertificate, nextLesson, progressOf, type Course } from "./academy";
import { ACTION_LEVELS, WORKER_TEMPLATES, canStartRun, decide, highestLevelOf, levelForAction } from "./workers";
import { AUTOMATION_TEMPLATES, MAX_ACTIONS, validateAutomation, type AutomationDefinition } from "./automations";

describe("integrations", () => {
  it("declares the providers the channel and payment registries know (the form is not a provider), plus the calendar", () => {
    expect([...PROVIDER_IDS].sort()).toEqual([...CONVERSATION_CHANNELS.filter((channel) => channel !== "form"), ...PAYMENT_RAILS, "bankTransfer", "crypto", "googleCalendar"].sort());
    expect(validateManifests()).toEqual([]);
  });

  it("keeps the providers whose API is unknown honest: nothing is assumed", () => {
    for (const id of ["makapay", "makawallet", "crypto"] as const) {
      expect(PROVIDER_MANIFESTS[id].authKinds).toEqual(["undefined"]);
      expect(PROVIDER_MANIFESTS[id].webhook).toBe("pending");
      expect(PROVIDER_MANIFESTS[id].toVerify.length).toBeGreaterThan(0);
    }
  });

  it("flags the external effects of each provider as approval-gated", () => {
    expect(approvalCapabilities(PROVIDER_MANIFESTS.whatsapp)).toEqual(["sendMessages", "sendTemplates"]);
    expect(approvalCapabilities(PROVIDER_MANIFESTS.stripe)).toEqual(["createCharge", "refund"]);
    expect(approvalCapabilities(PROVIDER_MANIFESTS.googleCalendar)).toEqual(["writeCalendar"]);
  });

  it("rejects a broken manifest", () => {
    const broken = { ...PROVIDER_MANIFESTS, makapay: { ...PROVIDER_MANIFESTS.makapay, webhook: "signedHmac" as const } };
    expect(validateManifests(broken)).toContainEqual({ provider: "makapay", issue: "unknown auth must keep the webhook pending" });
  });

  it("moves a connection only along allowed paths", () => {
    expect(canTransitionConnection("notConnected", "pending")).toBe(true);
    expect(canTransitionConnection("notConnected", "active")).toBe(false);
    expect(canTransitionConnection("active", "revoked")).toBe(true);
    expect(canTransitionConnection("revoked", "active")).toBe(false);
  });
});

describe("payments", () => {
  it("handles money as integers with an explicit currency", () => {
    expect(isMoney({ amountMinor: 1000, currency: "USD" })).toBe(true);
    expect(isMoney({ amountMinor: 10.5, currency: "USD" })).toBe(false);
    expect(isMoney({ amountMinor: -1, currency: "USD" })).toBe(false);
    expect(isMoney({ amountMinor: 1, currency: "usd" })).toBe(false);
    expect(addMoney({ amountMinor: 100, currency: "USD" }, { amountMinor: 50, currency: "USD" })).toEqual({ amountMinor: 150, currency: "USD" });
    expect(() => addMoney({ amountMinor: 1, currency: "USD" }, { amountMinor: 1, currency: "CRC" })).toThrow("currency mismatch");
  });

  it("only moves a payment forward", () => {
    expect(canTransitionPayment("pending", "succeeded")).toBe(true);
    expect(canTransitionPayment("succeeded", "refunded")).toBe(true);
    expect(canTransitionPayment("refunded", "succeeded")).toBe(false);
    expect(canTransitionPayment("failed", "succeeded")).toBe(false);
    expect(canTransitionPayment("succeeded", "succeeded")).toBe(true); // a repeated event changes nothing
  });

  it("never refunds more than was paid", () => {
    const paid = { amountMinor: 10_000, currency: "USD" };
    expect(netAmount(paid, [{ amountMinor: 2_500, currency: "USD" }])).toEqual({ amountMinor: 7_500, currency: "USD" });
    expect(() => netAmount(paid, [{ amountMinor: 6_000, currency: "USD" }, { amountMinor: 6_000, currency: "USD" }])).toThrow("refunds exceed");
  });

  it("requires a positive amount, a description and a reference for a payment link", () => {
    const ok = { tenantId: "t", amount: { amountMinor: 5000, currency: "USD" }, description: "Plan anual", reference: { opportunityId: "o" }, provider: "stripe" };
    expect(validatePaymentLink(ok)).toEqual([]);
    expect(validatePaymentLink({ ...ok, amount: { amountMinor: 0, currency: "USD" } })).toHaveLength(1);
    expect(validatePaymentLink({ ...ok, reference: {} })).toHaveLength(1);
    expect(validatePaymentLink({ ...ok, description: " " })).toHaveLength(1);
  });

  it("reconciles a transfer only when it is unambiguous", () => {
    const open = [
      { paymentId: "p1", expected: { amountMinor: 5000, currency: "CRC" }, reference: "A-1" },
      { paymentId: "p2", expected: { amountMinor: 5000, currency: "CRC" }, reference: "A-2" },
      { paymentId: "p3", expected: { amountMinor: 9000, currency: "CRC" } },
    ];
    const transfer = (reference?: string, amount = 5000) => ({ amount: { amountMinor: amount, currency: "CRC" }, reference, receivedAt: "2026-11-06T10:00:00Z" });
    expect(matchTransfer(transfer("A-2"), open)).toMatchObject({ kind: "exact", paymentId: "p2" });
    expect(matchTransfer(transfer(), open)).toMatchObject({ kind: "ambiguous", candidates: ["p1", "p2"] });
    expect(matchTransfer(transfer(undefined, 9000), open)).toMatchObject({ kind: "probable", paymentId: "p3" });
    expect(matchTransfer(transfer(undefined, 1234), open)).toMatchObject({ kind: "none" });
  });
});

describe("referrals", () => {
  const touches = [
    { referrerId: "a", at: "2026-10-01T00:00:00Z", code: "A" },
    { referrerId: "b", at: "2026-10-20T00:00:00Z", code: "B" },
    { referrerId: "c", at: "2026-11-10T00:00:00Z", code: "C" }, // after the conversion
  ];

  it("credits the last touch inside the window and nobody outside it", () => {
    expect(attribute(touches, "2026-11-01T00:00:00Z", 30)?.referrerId).toBe("b");
    expect(attribute(touches, "2026-11-01T00:00:00Z", 5)).toBeNull();
    expect(attribute([], "2026-11-01T00:00:00Z", 30)).toBeNull();
  });

  it("computes rewards in whole minor units, capped, never above the rule", () => {
    const sale = { amountMinor: 33_333, currency: "USD" };
    expect(rewardFor({ reward: { kind: "percent", basisPoints: 1000, currency: "USD" }, minSaleMinor: 0 }, sale)).toEqual({ amountMinor: 3333, currency: "USD" });
    expect(rewardFor({ reward: { kind: "percent", basisPoints: 1000, currency: "USD", capMinor: 2000 }, minSaleMinor: 0 }, sale).amountMinor).toBe(2000);
    expect(rewardFor({ reward: { kind: "fixed", amount: { amountMinor: 5000, currency: "USD" } }, minSaleMinor: 0 }, sale).amountMinor).toBe(5000);
    expect(rewardFor({ reward: { kind: "fixed", amount: { amountMinor: 5000, currency: "USD" } }, minSaleMinor: 100_000 }, sale).amountMinor).toBe(0);
    expect(rewardFor({ reward: { kind: "fixed", amount: { amountMinor: 5000, currency: "USD" } }, minSaleMinor: 0 }, { amountMinor: 1000, currency: "CRC" }).amountMinor).toBe(0); // currency mismatch pays nothing
  });

  it("holds suspicious rewards for review", () => {
    expect(fraudSignals({ referrerEmail: "A@x.co", referredEmail: " a@X.co ", referrerContactId: "c1", referredContactId: "c1", saleRefunded: true })).toEqual(["selfReferral", "sameEmail", "refundedSale"]);
    expect(fraudSignals({ referrerEmail: "a@x.co", referredEmail: "b@x.co" })).toEqual([]);
  });
});

describe("marketplace", () => {
  const listing = (over: Partial<Listing> = {}): Listing => ({
    id: "l1", kind: "aiWorker", publisherId: "p1", name: "Cobranza", summary: "Recordatorios", version: "1.0.0", pricing: { model: "free" },
    permissions: { capabilities: [], readsPersonalData: false, writesExternally: false }, status: "draft", ...over,
  });

  it("reviews the objective requirements of a listing", () => {
    expect(reviewListing(listing())).toEqual([]);
    expect(reviewListing(listing({ version: "v1" }))).toHaveLength(1);
    expect(reviewListing(listing({ pricing: { model: "monthly", amountMinor: 0, currency: "USD" } }))).toHaveLength(1);
    expect(reviewListing(listing({ permissions: { capabilities: [], readsPersonalData: true, writesExternally: true } }))).toHaveLength(2);
    expect(reviewListing(listing({ kind: "integration" }))).toContain("an integration must declare its capabilities");
  });

  it("publishes only through review, and a retired listing never returns", () => {
    expect(canTransitionListing("draft", "inReview")).toBe(true);
    expect(canTransitionListing("draft", "published")).toBe(false);
    expect(canTransitionListing("published", "suspended")).toBe(true);
    expect(canTransitionListing("retired", "published")).toBe(false);
  });

  it("splits revenue without losing a cent", () => {
    expect(splitRevenue(10_001, 2_000)).toEqual({ platformMinor: 2_000, publisherMinor: 8_001 });
    for (const amount of [0, 1, 99, 12_345]) {
      const { platformMinor, publisherMinor } = splitRevenue(amount, 1_500);
      expect(platformMinor + publisherMinor).toBe(amount);
    }
    expect(() => splitRevenue(-1, 100)).toThrow();
    expect(() => splitRevenue(100, 10_001)).toThrow();
  });
});

describe("academy", () => {
  const course: Course = {
    id: "c", title: "Primeros pasos", summary: "", level: "beginner", audience: "everyone",
    lessons: [{ id: "l1", title: "A", minutes: 5, required: true }, { id: "l2", title: "B", minutes: 10, required: true }, { id: "l3", title: "Extra", minutes: 15, required: false }],
    quiz: { id: "q", passPercent: 70 },
  };

  it("measures progress and the minutes left", () => {
    expect(progressOf(course, { completedLessonIds: [] })).toEqual({ percent: 0, completed: 0, total: 3, minutesLeft: 30 });
    expect(progressOf(course, { completedLessonIds: ["l1", "ghost"] })).toEqual({ percent: 33, completed: 1, total: 3, minutesLeft: 25 });
    expect(nextLesson(course, { completedLessonIds: ["l1"] })?.id).toBe("l2");
    expect(nextLesson(course, { completedLessonIds: ["l1", "l2", "l3"] })).toBeNull();
  });

  it("grants a certificate only with every required lesson and a passing quiz", () => {
    expect(eligibleForCertificate(course, { completedLessonIds: ["l1", "l2"] })).toBe(false);
    expect(eligibleForCertificate(course, { completedLessonIds: ["l1", "l2"], quizScorePercent: 69 })).toBe(false);
    expect(eligibleForCertificate(course, { completedLessonIds: ["l1", "l2"], quizScorePercent: 70 })).toBe(true);
    expect(eligibleForCertificate(course, { completedLessonIds: ["l1"], quizScorePercent: 100 })).toBe(false);
    expect(eligibleForCertificate({ ...course, quiz: undefined }, { completedLessonIds: ["l1", "l2"] })).toBe(true);
  });
});

describe("AI workers: autonomy is decided by code and fails closed", () => {
  it("treats an unknown action as Level 3", () => {
    expect(levelForAction("something.new")).toBe(3);
    expect(levelForAction("__proto__")).toBe(3);
    expect(levelForAction("constructor")).toBe(3);
    expect(decide("something.new")).toEqual({ allowed: false, level: 3, needs: "approval" });
  });

  it("lets Level 1 run, and keeps money, first contact and customers at Level 3", () => {
    expect(decide("summary.prepare").allowed).toBe(true);
    for (const action of ["message.sendFirst", "payment.createLink", "payment.refund", "customer.create", "opportunity.win", "contact.erase"]) {
      expect(ACTION_LEVELS[action as keyof typeof ACTION_LEVELS]).toBe(3);
      expect(decide(action, { action, status: "active" }).allowed).toBe(false); // even an authorization cannot lower Level 3
    }
  });

  it("allows a Level 2 action only inside an active, unexpired, unexhausted authorization", () => {
    const auth = { action: "faq.answer", status: "active" as const, maxPerDay: 2, usedToday: 1, expiresAt: "2030-01-01T00:00:00Z" };
    const now = new Date("2026-11-06T10:00:00Z");
    expect(decide("faq.answer", undefined, now)).toMatchObject({ allowed: false, needs: "approval" });
    expect(decide("faq.answer", auth, now).allowed).toBe(true);
    expect(decide("faq.answer", { ...auth, usedToday: 2 }, now).allowed).toBe(false);
    expect(decide("faq.answer", { ...auth, expiresAt: "2026-01-01T00:00:00Z" }, now).allowed).toBe(false);
    expect(decide("faq.answer", { ...auth, status: "revoked" }, now).allowed).toBe(false);
    expect(decide("faq.answer", { ...auth, action: "other" }, now).allowed).toBe(false);
  });

  it("shows the highest level a worker reaches, so the owner knows before activating", () => {
    expect(highestLevelOf(["contact.read"])).toBe(1);
    expect(highestLevelOf(["contact.read", "faq.answer"])).toBe(2);
    expect(highestLevelOf(["contact.read", "unknown"])).toBe(3);
    expect(WORKER_TEMPLATES.find((worker) => worker.id === "reporter")?.highestLevel).toBe(1);
    expect(WORKER_TEMPLATES.find((worker) => worker.id === "collections")?.highestLevel).toBe(3);
  });

  it("stops new runs when the worker is paused or out of budget", () => {
    expect(canStartRun({ maxRunsPerDay: 5, maxActionsPerRun: 3, paused: false }, 4)).toBe(true);
    expect(canStartRun({ maxRunsPerDay: 5, maxActionsPerRun: 3, paused: false }, 5)).toBe(false);
    expect(canStartRun({ maxRunsPerDay: 5, maxActionsPerRun: 3, paused: true }, 0)).toBe(false);
  });
});

describe("automations", () => {
  const base = (over: Partial<AutomationDefinition> = {}): AutomationDefinition => ({
    name: "Prueba", trigger: { kind: "leadCreated" }, conditions: [], actions: [{ kind: "createTask", params: { title: "x" } }], status: "draft", testMode: true, ...over,
  });

  it("accepts every shipped template and starts each in test mode", () => {
    for (const template of AUTOMATION_TEMPLATES) {
      expect(validateAutomation(template).errors).toEqual([]);
      expect(template.testMode).toBe(true);
    }
  });

  it("routes actions that reach outside through approval", () => {
    const report = validateAutomation(base({ actions: [{ kind: "createTask", params: {} }, { kind: "sendMessage", params: {} }, { kind: "callWebhook", params: {} }] }));
    expect(report.approvalActions).toEqual([1, 2]);
    expect(report.warnings.join(" ")).toContain("approval");
  });

  it("rejects unknown pieces and oversized definitions", () => {
    expect(validateAutomation(base({ trigger: { kind: "nope" as never } })).errors).toHaveLength(1);
    expect(validateAutomation(base({ actions: [] })).errors).toContain("at least one action");
    expect(validateAutomation(base({ actions: Array.from({ length: MAX_ACTIONS + 1 }, () => ({ kind: "createTask" as const, params: {} })) })).errors).toHaveLength(1);
    expect(validateAutomation(base({ actions: [{ kind: "explode" as never, params: {} }] })).errors).toHaveLength(1);
    expect(validateAutomation(base({ conditions: [{ field: " ", op: "equals", value: 1 }] })).errors).toHaveLength(1);
    expect(validateAutomation(base({ trigger: { kind: "schedule" } })).errors).toContain("a schedule needs a cron expression");
    expect(validateAutomation(base({ name: " " })).errors).toHaveLength(1);
  });

  it("warns about a possible loop and about an active automation still in test mode", () => {
    const loop = validateAutomation(base({ trigger: { kind: "opportunityStageChanged" }, actions: [{ kind: "moveOpportunityStage", params: {} }] }));
    expect(loop.warnings.join(" ")).toContain("retrigger");
    expect(validateAutomation(base({ status: "active" })).warnings.join(" ")).toContain("test mode");
  });
});
