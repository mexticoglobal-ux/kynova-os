import { describe, expect, it } from "vitest";
import { isPerson } from "./actors";
import { ERROR_CODES, label, message } from "./marketplace-messages";
import {
  CATEGORIES, DEFAULT_SHARE_BPS, ITEM_KINDS, MAX_DOWNLOADS_PER_PURCHASE, MAX_REVIEW_CHARS, adminDashboard, downloadsOf, effectiveShareBps, listingsOf, moderationQueue, newMarketState, objectiveIssues, purchasesOf, ratingOf,
  reduceMarket, searchCatalog, sellerDashboard, tokenize, type ItemKind, type ListingContent, type MarketEvent, type MarketState,
} from "./marketplace-center";
import { DEMO_ADMINS, PLATFORM_TENANT, baseContent, demoOk } from "./marketplace-demo";
import { ACTION_LEVELS, decide, levelForAction } from "./workers";

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;
const NOVA = { tenantId: "tenant-nova", actor: "ana" };
const VIDA = { tenantId: "tenant-vida", actor: "lucia" };
const MAR = { tenantId: "tenant-mar", actor: "marco" };
const ADMIN_A = { tenantId: PLATFORM_TENANT, actor: "admin:ana" };
const ADMIN_B = { tenantId: PLATFORM_TENANT, actor: "admin:bruno" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };

const step = (state: MarketState, event: MarketEvent) => reduceMarket(state, event);
const must = (state: MarketState, event: MarketEvent): MarketState => {
  const result = reduceMarket(state, event);
  expect(result.error, event.type).toBeUndefined();
  return result.state;
};
const fresh = () => newMarketState(DEMO_ADMINS);
const listed = (state: MarketState, seller = NOVA, kind: ItemKind = "digitalResource", content: Partial<ListingContent> = {}, at = 1) => {
  const base = baseContent({ name: "Recurso", deliverable: { fileName: "a.pdf", sizeBytes: 100 }, ...content });
  const created = must(state, { ...seller, at: day(at), type: "listing.create", kind, content: base });
  return { state: created, id: created.listings.at(-1)?.id ?? "" };
};
const published = (state: MarketState, seller = NOVA, kind: ItemKind = "digitalResource", content: Partial<ListingContent> = {}) => {
  const { state: created, id } = listed(state, seller, kind, content);
  const submitted = must(created, { ...seller, at: day(1), type: "listing.submit", listingId: id });
  return { state: must(submitted, { ...ADMIN_A, at: day(2), type: "moderation.decide", listingId: id, approve: true }), id };
};
const buy = (state: MarketState, buyer: { tenantId: string; actor: string }, listingId: string, at = 5) => {
  const next = must(state, { ...buyer, at: day(at), type: "purchase.create", listingId });
  return { state: next, id: next.purchases.at(-1)?.id ?? "" };
};

describe("the sample loads without a refusal and shows every state", () => {
  it("has listings in each stage, charges in each stage and every kind but a physical product", () => {
    const state = demoOk();
    expect(state.listings.map((l) => l.status).sort()).toEqual(["draft", "pending", "published", "published", "published", "published"]);
    expect(new Set(state.charges.map((c) => c.status))).toEqual(new Set(["settled", "inSettlement", "accrued"]));
    expect(state.listings.find((l) => l.content.name === "Aviso de prospecto caliente")?.createdBy).toBe("worker:nex");
  });

  it("computes the seller and administrator dashboards", () => {
    const state = demoOk();
    const nova = sellerDashboard(state, "tenant-nova");
    expect(nova).toMatchObject({ sales: 3, activeSubscriptions: 1, gross: { USD: 15_600 }, platformFees: { USD: 2_195 }, net: { USD: 13_405 }, toSettle: { USD: 2_610 }, settled: { USD: 10_795 }, downloads: 2, averageRating: 4.5, reviewsToAnswer: 1 });
    expect(nova.top[0].name).toBe("Marketing para clínicas");
    const admin = adminDashboard(state);
    expect(admin).toMatchObject({ moderationQueue: 1, sellers: 3, buyers: 3, gross: { USD: 27_600 }, commission: { USD: 3_995 }, pendingShareChanges: 1, settlementsToDecide: 1, settlementsToPay: 0, hiddenReviews: 1, defaultShareBps: DEFAULT_SHARE_BPS });
    expect(admin.listingsByKind.automation).toBe(1);
  });
});

describe("objective review", () => {
  it("accepts a clean listing and names what is missing otherwise", () => {
    expect(objectiveIssues("digitalResource", baseContent({ deliverable: { fileName: "a.pdf", sizeBytes: 1 } }))).toEqual([]);
    expect(objectiveIssues("digitalResource", baseContent())[0]).toContain("archivo");
    expect(objectiveIssues("service", baseContent({ name: " " }))[0]).toContain("nombre");
    expect(objectiveIssues("service", baseContent({ version: "v1" }))[0]).toContain("versión");
    expect(objectiveIssues("service", baseContent({ pricing: { model: "oneTime", amountMinor: 0 } }))[0]).toContain("precio");
    expect(objectiveIssues("service", baseContent({ currency: "BTC" }))[0]).toContain("moneda");
    expect(objectiveIssues("service", baseContent({ permissions: { capabilities: [], readsPersonalData: true, writesExternally: false } }))[0]).toContain("privacidad");
    expect(objectiveIssues("service", baseContent({ permissions: { capabilities: [], readsPersonalData: false, writesExternally: true } }))[0]).toContain("soporte");
    expect(objectiveIssues("aiAgent", baseContent())[0]).toContain("capacidades");
    expect(objectiveIssues("app", baseContent({ permissions: { capabilities: ["sendMessages"], readsPersonalData: false, writesExternally: false } })).join()).toContain("fuera de la plataforma");
    expect(objectiveIssues("service", baseContent({ privacyPolicyUrl: "http://x.test" }))[0]).toContain("https");
  });
});

describe("publishing always needs a person's approval", () => {
  it("lets NEX prepare a draft but never submit it, and lets people submit only their own", () => {
    const { state, id } = listed(fresh(), NEX);
    expect(state.listings[0]).toMatchObject({ status: "draft", createdBy: "worker:nex" });
    expect(step(state, { ...NEX, at: day(2), type: "listing.submit", listingId: id }).errorCode).toBe("personRequired");
    expect(step(state, { ...VIDA, at: day(2), type: "listing.submit", listingId: id }).errorCode).toBe("notYours");
    expect(step(state, { ...NOVA, at: day(2), type: "listing.edit", listingId: id, content: baseContent({ name: "Editado" }) }).error).toBeUndefined();
    expect(step(state, { tenantId: "t", actor: "system", at: day(2), type: "listing.create", kind: "service", content: baseContent() }).errorCode).toBe("personRequired");
  });

  it("blocks submitting a listing that fails the objective checks", () => {
    const { state, id } = listed(fresh(), NOVA, "digitalResource", { name: " " });
    expect(step(state, { ...NOVA, at: day(2), type: "listing.submit", listingId: id }).errorCode).toBe("listingInvalid");
  });

  it("is approved only by an administrator who is not the submitter, and never publishes by itself", () => {
    const { state, id } = listed(fresh());
    const submitted = must(state, { ...NOVA, at: day(2), type: "listing.submit", listingId: id });
    expect(submitted.listings[0].status).toBe("pending");
    expect(searchCatalog(submitted)).toHaveLength(0); // pending is not in the catalog
    const decide = (who: { tenantId: string; actor: string }, approve = true, reason?: string) => step(submitted, { ...who, at: day(3), type: "moderation.decide", listingId: id, approve, reason });
    expect(decide(VIDA).errorCode).toBe("adminRequired");
    expect(decide({ tenantId: "x", actor: "worker:nex" }).errorCode).toBe("personRequired");
    expect(decide({ tenantId: "x", actor: "admin:impostor" }).errorCode).toBe("adminRequired"); // being called admin is not enough: the state decides
    expect(decide(ADMIN_A, false).errorCode).toBe("reasonRequired");
    expect(decide(ADMIN_A).state.listings[0].status).toBe("published");
    expect(decide(ADMIN_A, false, "Falta el archivo").state.listings[0].status).toBe("rejected");

    const selfSubmitted = newMarketState(["admin:ana"]);
    const mine = listed(selfSubmitted, ADMIN_A);
    const pending = must(mine.state, { ...ADMIN_A, at: day(2), type: "listing.submit", listingId: mine.id });
    expect(step(pending, { ...ADMIN_A, at: day(3), type: "moderation.decide", listingId: mine.id, approve: true }).errorCode).toBe("selfReview");
  });

  it("lets a rejected listing be fixed and sent again, and refuses edits while it is in review", () => {
    const { state, id } = listed(fresh());
    let current = must(state, { ...NOVA, at: day(2), type: "listing.submit", listingId: id });
    expect(step(current, { ...NOVA, at: day(2), type: "listing.edit", listingId: id, content: baseContent() }).errorCode).toBe("inReview");
    current = must(current, { ...ADMIN_A, at: day(3), type: "moderation.decide", listingId: id, approve: false, reason: "Mejore la descripción" });
    current = must(current, { ...NOVA, at: day(4), type: "listing.edit", listingId: id, content: baseContent({ name: "Recurso", deliverable: { fileName: "a.pdf", sizeBytes: 1 } }) });
    expect(current.listings[0].status).toBe("draft");
    current = must(current, { ...NOVA, at: day(5), type: "listing.submit", listingId: id });
    expect(current.listings[0].moderation.map((entry) => entry.action)).toEqual(["submitted", "rejected", "submitted"]);
  });

  it("sends a change to a published listing back through review while the live version stays", () => {
    const { state, id } = published(fresh());
    const edited = must(state, { ...NOVA, at: day(6), type: "listing.edit", listingId: id, content: baseContent({ name: "Recurso v2", deliverable: { fileName: "b.pdf", sizeBytes: 2 }, pricing: { model: "oneTime", amountMinor: 900 } }) });
    expect(edited.listings[0].content.name).toBe("Recurso"); // still the approved version
    expect(searchCatalog(edited)[0].listing.content.pricing.model).toBe("free");
    expect(moderationQueue(edited).map((l) => l.id)).toEqual([id]);
    expect(step(edited, { ...NEX, at: day(6), type: "listing.edit", listingId: id, content: baseContent() }).errorCode).toBe("personRequired");
    const approved = must(edited, { ...ADMIN_B, at: day(7), type: "moderation.decide", listingId: id, approve: true });
    expect(approved.listings[0].content.name).toBe("Recurso v2");
    expect(approved.listings[0].pendingRevision).toBeUndefined();
    const rejected = must(edited, { ...ADMIN_B, at: day(7), type: "moderation.decide", listingId: id, approve: false, reason: "No" });
    expect(rejected.listings[0].content.name).toBe("Recurso");
    expect(moderationQueue(rejected)).toHaveLength(0);
  });

  it("suspends with a reason, hides the listing, and needs a second administrator to bring it back", () => {
    const { state, id } = published(fresh());
    expect(step(state, { ...ADMIN_A, at: day(3), type: "moderation.suspend", listingId: id, reason: " " }).errorCode).toBe("reasonRequired");
    expect(step(state, { ...NOVA, at: day(3), type: "moderation.suspend", listingId: id, reason: "x" }).errorCode).toBe("adminRequired");
    const suspended = must(state, { ...ADMIN_A, at: day(3), type: "moderation.suspend", listingId: id, reason: "Contenido engañoso" });
    expect(searchCatalog(suspended)).toHaveLength(0);
    expect(step(suspended, { ...VIDA, at: day(4), type: "purchase.create", listingId: id }).errorCode).toBe("notPublished");
    const pending = must(suspended, { ...ADMIN_A, at: day(4), type: "moderation.reinstate", listingId: id });
    expect(pending.listings[0].status).toBe("pending");
    expect(step(pending, { ...ADMIN_A, at: day(5), type: "moderation.decide", listingId: id, approve: true }).errorCode).toBe("selfReview");
    expect(must(pending, { ...ADMIN_B, at: day(5), type: "moderation.decide", listingId: id, approve: true }).listings[0].status).toBe("published");
  });

  it("retires a listing and stops its subscriptions", () => {
    const { state, id } = published(fresh(), NOVA, "aiAgent", { pricing: { model: "subscription", amountMinor: 1_000, interval: "month" }, permissions: { capabilities: ["receiveMessages"], readsPersonalData: false, writesExternally: false }, deliverable: undefined });
    const bought = buy(state, VIDA, id);
    const retired = must(bought.state, { ...NOVA, at: day(9), type: "listing.retire", listingId: id });
    expect(retired.listings[0].status).toBe("retired");
    expect(retired.purchases[0].status).toBe("cancelled");
    expect(step(retired, { ...MAR, at: day(10), type: "purchase.create", listingId: id }).errorCode).toBe("notPublished");
    expect(step(bought.state, { ...VIDA, at: day(9), type: "listing.retire", listingId: id }).errorCode).toBe("notYours");
  });
});

describe("purchases, subscriptions and downloads (simulated)", () => {
  it("refuses NEX, the seller itself, a repeat, and an unpublished listing", () => {
    const { state, id } = published(fresh(), NOVA, "digitalResource", { pricing: { model: "oneTime", amountMinor: 1_000 } });
    expect(step(state, { ...NEX, at: day(5), type: "purchase.create", listingId: id }).errorCode).toBe("personRequired");
    expect(step(state, { ...NOVA, at: day(5), type: "purchase.create", listingId: id }).errorCode).toBe("ownListing");
    const bought = buy(state, VIDA, id).state;
    expect(step(bought, { ...VIDA, at: day(6), type: "purchase.create", listingId: id }).errorCode).toBe("alreadyOwned");
    const draft = listed(fresh());
    expect(step(draft.state, { ...VIDA, at: day(6), type: "purchase.create", listingId: draft.id }).errorCode).toBe("notPublished");
  });

  it("charges nothing for a free listing and splits a one-time price without losing a cent", () => {
    const free = published(fresh());
    expect(buy(free.state, VIDA, free.id).state.charges).toHaveLength(0);
    const paid = published(fresh(), NOVA, "digitalResource", { pricing: { model: "oneTime", amountMinor: 3_333 } });
    const charge = buy(paid.state, VIDA, paid.id).state.charges[0];
    expect(charge).toMatchObject({ shareBps: 1_500, status: "accrued" });
    expect(charge.platformFee.amountMinor).toBe(499); // 15 % of 33.33, rounded down
    expect(charge.platformFee.amountMinor + charge.sellerNet.amountMinor).toBe(3_333);
  });

  it("renews a subscription only when it is due, at the share in force then, and stops when cancelled", () => {
    const { state, id } = published(fresh(), NOVA, "aiAgent", { pricing: { model: "subscription", amountMinor: 2_000, interval: "month" }, permissions: { capabilities: ["receiveMessages"], readsPersonalData: false, writesExternally: false }, deliverable: undefined });
    const bought = buy(state, VIDA, id, 8);
    const renew = (s: MarketState, at: string) => step(s, { tenantId: PLATFORM_TENANT, actor: "system", at, type: "purchase.renew", purchaseId: bought.id });
    expect(renew(bought.state, "2026-10-20T10:00:00.000Z").errorCode).toBe("renewalNotDue");
    expect(step(bought.state, { ...NEX, at: "2026-11-09T10:00:00.000Z", type: "purchase.renew", purchaseId: bought.id }).errorCode).toBe("personRequired");
    const renewed = renew(bought.state, "2026-11-09T10:00:00.000Z").state;
    expect(renewed.charges).toHaveLength(2);
    expect(renewed.purchases[0].nextRenewalAt).toBe("2026-12-09T10:00:00.000Z");
    const cancelled = must(renewed, { ...VIDA, at: day(30), type: "purchase.cancel", purchaseId: bought.id });
    expect(step(cancelled, { tenantId: PLATFORM_TENANT, actor: "system", at: "2027-01-10T10:00:00.000Z", type: "purchase.renew", purchaseId: bought.id }).errorCode).toBe("purchaseInactive");
  });

  it("does not cancel a one-time purchase (already paid) and only the buyer's company may cancel", () => {
    const { state, id } = published(fresh(), NOVA, "digitalResource", { pricing: { model: "oneTime", amountMinor: 500 } });
    const bought = buy(state, VIDA, id);
    expect(step(bought.state, { ...VIDA, at: day(6), type: "purchase.cancel", purchaseId: bought.id }).errorCode).toBe("notCancellable");
    expect(step(bought.state, { ...MAR, at: day(6), type: "purchase.cancel", purchaseId: bought.id }).errorCode).toBe("notYourPurchase");
  });

  it("lets only the buying company download, up to a limit, never when suspended or without a file", () => {
    const { state, id } = published(fresh());
    const bought = buy(state, VIDA, id);
    expect(step(bought.state, { ...MAR, at: day(6), type: "download.record", purchaseId: bought.id }).errorCode).toBe("notYourPurchase");
    expect(step(bought.state, { ...NEX, at: day(6), type: "download.record", purchaseId: bought.id }).errorCode).toBe("personRequired");
    let current = bought.state;
    for (let index = 0; index < MAX_DOWNLOADS_PER_PURCHASE; index += 1) current = must(current, { ...VIDA, at: day(6), type: "download.record", purchaseId: bought.id });
    expect(step(current, { ...VIDA, at: day(7), type: "download.record", purchaseId: bought.id }).errorCode).toBe("downloadLimit");
    expect(downloadsOf(current, "tenant-vida")).toHaveLength(MAX_DOWNLOADS_PER_PURCHASE);
    expect(downloadsOf(current, "tenant-mar")).toHaveLength(0);

    const suspended = must(bought.state, { ...ADMIN_A, at: day(6), type: "moderation.suspend", listingId: id, reason: "Revisión" });
    expect(step(suspended, { ...VIDA, at: day(7), type: "download.record", purchaseId: bought.id }).errorCode).toBe("suspendedNoAccess");

    const service = published(fresh(), NOVA, "service", { pricing: { model: "oneTime", amountMinor: 500 }, deliverable: undefined });
    const hired = buy(service.state, VIDA, service.id);
    expect(step(hired.state, { ...VIDA, at: day(6), type: "download.record", purchaseId: hired.id }).errorCode).toBe("noDeliverable");
  });
});

describe("favorites, ratings and reviews", () => {
  it("toggles a favorite per person, only on published listings, and removing is always allowed", () => {
    const { state, id } = published(fresh());
    const faved = must(state, { ...VIDA, at: day(5), type: "favorite.toggle", listingId: id });
    expect(searchCatalog(faved, { favoritesOf: { tenantId: "tenant-vida", userId: "lucia" } })).toHaveLength(1);
    expect(searchCatalog(faved, { favoritesOf: { tenantId: "tenant-mar", userId: "marco" } })).toHaveLength(0);
    expect(searchCatalog(faved, {}, { tenantId: "tenant-vida", userId: "lucia" })[0].isFavorite).toBe(true);
    expect(searchCatalog(faved, {}, { tenantId: "tenant-mar", userId: "marco" })[0].isFavorite).toBe(false);
    const suspended = must(faved, { ...ADMIN_A, at: day(6), type: "moderation.suspend", listingId: id, reason: "x" });
    expect(must(suspended, { ...VIDA, at: day(7), type: "favorite.toggle", listingId: id }).favorites).toHaveLength(0);
    expect(step(suspended, { ...MAR, at: day(7), type: "favorite.toggle", listingId: id }).errorCode).toBe("notPublished");
    expect(step(state, { ...NEX, at: day(5), type: "favorite.toggle", listingId: id }).errorCode).toBe("personRequired");
  });

  it("lets only buyers review, once per purchase, with a valid rating and a bounded text", () => {
    const { state, id } = published(fresh());
    const bought = buy(state, VIDA, id);
    const review = (who: { tenantId: string; actor: string }, rating: number, body = "ok") => step(bought.state, { ...who, at: day(8), type: "review.submit", purchaseId: bought.id, rating, body });
    expect(review(MAR, 5).errorCode).toBe("reviewNotAllowed");
    expect(review(VIDA, 0).errorCode).toBe("ratingInvalid");
    expect(review(VIDA, 6).errorCode).toBe("ratingInvalid");
    expect(review(VIDA, 4.5).errorCode).toBe("ratingInvalid");
    expect(review(VIDA, 5, "x".repeat(MAX_REVIEW_CHARS + 1)).errorCode).toBe("reviewTooLong");
    expect(review({ ...VIDA, actor: "worker:nex" }, 5).errorCode).toBe("personRequired");
    const reviewed = review(VIDA, 5).state;
    expect(step(reviewed, { ...VIDA, at: day(9), type: "review.submit", purchaseId: bought.id, rating: 1, body: "otra" }).errorCode).toBe("alreadyReviewed");
  });

  it("averages visible reviews, lets only the seller reply once, and lets only an administrator hide one", () => {
    const { state, id } = published(fresh());
    let current = buy(state, VIDA, id).state;
    current = buy(current, MAR, id).state;
    current = must(current, { ...VIDA, at: day(8), type: "review.submit", purchaseId: current.purchases[0].id, rating: 5, body: "Excelente" });
    current = must(current, { ...MAR, at: day(8), type: "review.submit", purchaseId: current.purchases[1].id, rating: 2, body: "Regular" });
    expect(ratingOf(current, id)).toEqual({ average: 3.5, count: 2, distribution: [0, 1, 0, 0, 1] });
    const [first, second] = current.reviews;
    expect(step(current, { ...VIDA, at: day(9), type: "review.reply", reviewId: first.id, text: "Gracias" }).errorCode).toBe("notYours");
    const replied = must(current, { ...NOVA, at: day(9), type: "review.reply", reviewId: first.id, text: "Gracias" });
    expect(step(replied, { ...NOVA, at: day(10), type: "review.reply", reviewId: first.id, text: "Otra" }).errorCode).toBe("alreadyReplied");
    expect(step(current, { ...NOVA, at: day(10), type: "review.hide", reviewId: second.id, reason: "x" }).errorCode).toBe("adminRequired");
    expect(step(current, { ...ADMIN_A, at: day(10), type: "review.hide", reviewId: second.id, reason: " " }).errorCode).toBe("reasonRequired");
    const hidden = must(current, { ...ADMIN_A, at: day(10), type: "review.hide", reviewId: second.id, reason: "Ofensivo" });
    expect(ratingOf(hidden, id)).toMatchObject({ average: 5, count: 1 });
    expect(hidden.reviews).toHaveLength(2); // hidden, never deleted
  });
});

describe("revenue share is Level 3", () => {
  it("is in the worker catalog at Level 3 and no authorization can lower it; drafting is Level 1", () => {
    for (const action of ["marketplace.publish", "marketplace.purchase", "marketplace.revenueShare", "marketplace.settlement"] as const) {
      expect(ACTION_LEVELS[action]).toBe(3);
      expect(decide(action, { action, status: "active" }).allowed).toBe(false);
    }
    expect(levelForAction("marketplace.draftListing")).toBe(1);
    expect(isPerson("worker:nex")).toBe(false);
  });

  const request = (state: MarketState, who: { tenantId: string; actor: string }, toBps: number, scope: { type: "default" } | { type: "listing"; listingId: string } = { type: "default" }) =>
    step(state, { ...who, at: day(10), type: "share.request", scope, toBps, reason: "Motivo" });

  it("refuses NEX, ordinary users, out-of-range values, no-ops and a second change while one is waiting", () => {
    const state = fresh();
    expect(request(state, { ...NEX, actor: "worker:nex" }, 1_000).errorCode).toBe("personRequired");
    expect(request(state, NOVA, 1_000).errorCode).toBe("adminRequired");
    expect(request(state, ADMIN_A, 5_001).errorCode).toBe("shareInvalid");
    expect(request(state, ADMIN_A, -1).errorCode).toBe("shareInvalid");
    expect(request(state, ADMIN_A, 10.5).errorCode).toBe("shareInvalid");
    expect(request(state, ADMIN_A, DEFAULT_SHARE_BPS).errorCode).toBe("shareUnchanged");
    expect(step(state, { ...ADMIN_A, at: day(10), type: "share.request", scope: { type: "default" }, toBps: 1_000, reason: " " }).errorCode).toBe("reasonRequired");
    expect(request(state, ADMIN_A, 1_000, { type: "listing", listingId: "nope" }).errorCode).toBe("listingNotFound");
    const waiting = request(state, ADMIN_A, 1_000).state;
    expect(request(waiting, ADMIN_B, 900).errorCode).toBe("sharePending");
  });

  it("needs a different administrator to approve, and the change applies only to later charges", () => {
    const { state, id } = published(fresh(), NOVA, "digitalResource", { pricing: { model: "oneTime", amountMinor: 10_000 } });
    const first = buy(state, VIDA, id).state;
    const waiting = request(first, ADMIN_A, 2_000).state;
    const change = waiting.shareChanges[0];
    expect(waiting.defaultShareBps).toBe(1_500); // nothing changes until it is approved
    expect(step(waiting, { ...ADMIN_A, at: day(11), type: "share.decide", changeId: change.id, approve: true }).errorCode).toBe("selfApproval");
    expect(step(waiting, { ...NOVA, at: day(11), type: "share.decide", changeId: change.id, approve: true }).errorCode).toBe("adminRequired");
    expect(step(waiting, { ...NEX, actor: "worker:nex", at: day(11), type: "share.decide", changeId: change.id, approve: true }).errorCode).toBe("personRequired");
    const approved = must(waiting, { ...ADMIN_B, at: day(11), type: "share.decide", changeId: change.id, approve: true });
    expect(approved.defaultShareBps).toBe(2_000);
    expect(approved.charges[0].shareBps).toBe(1_500); // the charge already made keeps its share
    const later = buy(approved, MAR, id, 12).state;
    expect(later.charges[1]).toMatchObject({ shareBps: 2_000 });
    expect(later.charges[1].platformFee.amountMinor).toBe(2_000);
    expect(step(approved, { ...ADMIN_B, at: day(12), type: "share.decide", changeId: change.id, approve: false }).errorCode).toBe("shareChangeResolved");
  });

  it("a rejected change changes nothing, and a per-listing override beats the default", () => {
    const { state, id } = published(fresh());
    const waiting = request(state, ADMIN_A, 1_000, { type: "listing", listingId: id }).state;
    const rejected = must(waiting, { ...ADMIN_B, at: day(11), type: "share.decide", changeId: waiting.shareChanges[0].id, approve: false });
    expect(effectiveShareBps(rejected, rejected.listings[0])).toBe(1_500);
    const again = request(rejected, ADMIN_A, 1_000, { type: "listing", listingId: id }).state;
    const approved = must(again, { ...ADMIN_B, at: day(12), type: "share.decide", changeId: again.shareChanges[1].id, approve: true });
    expect(effectiveShareBps(approved, approved.listings[0])).toBe(1_000);
    expect(approved.defaultShareBps).toBe(1_500);
  });
});

describe("settling what sellers earned is Level 3 too, and decoupled from any gateway", () => {
  const earned = () => {
    const { state, id } = published(fresh(), NOVA, "digitalResource", { pricing: { model: "oneTime", amountMinor: 10_000 } });
    return { state: buy(state, VIDA, id).state, id };
  };
  const ask = (state: MarketState, who: { tenantId: string; actor: string }, seller = "tenant-nova", currency = "USD") => step(state, { ...who, at: day(20), type: "settlement.request", sellerTenantId: seller, currency });

  it("refuses non-admins, NEX, crypto, nothing to settle and amounts under the minimum", () => {
    const { state } = earned();
    expect(ask(state, NOVA).errorCode).toBe("adminRequired");
    expect(ask(state, { ...NEX, actor: "worker:nex" }).errorCode).toBe("personRequired");
    expect(ask(state, ADMIN_A, "tenant-nova", "BTC").errorCode).toBe("currencyInvalid");
    expect(ask(state, ADMIN_A, "tenant-mar").errorCode).toBe("nothingToSettle");
    expect(ask(state, ADMIN_A, "tenant-nova", "EUR").errorCode).toBe("nothingToSettle");
    expect(ask({ ...state, minSettlementMinor: 100_000 }, ADMIN_A).errorCode).toBe("settlementBelowMinimum");
  });

  it("goes request → approval by another administrator → paid with an outside reference", () => {
    const { state } = earned();
    let current = must(state, { ...ADMIN_A, at: day(20), type: "settlement.request", sellerTenantId: "tenant-nova", currency: "USD" });
    const settlement = current.settlements[0];
    expect(settlement.total).toEqual({ amountMinor: 8_500, currency: "USD" });
    expect(current.charges[0].status).toBe("inSettlement");
    expect(ask(current, ADMIN_B).errorCode).toBe("nothingToSettle"); // the same earnings cannot be requested twice
    expect(step(current, { ...ADMIN_A, at: day(21), type: "settlement.decide", settlementId: settlement.id, approve: true }).errorCode).toBe("selfApproval");
    expect(step(current, { ...ADMIN_B, at: day(21), type: "settlement.markPaid", settlementId: settlement.id, paymentRef: "X" }).errorCode).toBe("settlementNotApproved");
    current = must(current, { ...ADMIN_B, at: day(21), type: "settlement.decide", settlementId: settlement.id, approve: true });
    expect(step(current, { ...ADMIN_B, at: day(22), type: "settlement.markPaid", settlementId: settlement.id, paymentRef: " " }).errorCode).toBe("paymentRefRequired");
    current = must(current, { ...ADMIN_B, at: day(22), type: "settlement.markPaid", settlementId: settlement.id, paymentRef: "TRANSFERENCIA-9" });
    expect(current.settlements[0]).toMatchObject({ status: "paid", paymentRef: "TRANSFERENCIA-9" });
    expect(current.charges[0].status).toBe("settled");
    expect(step(current, { ...ADMIN_B, at: day(23), type: "settlement.decide", settlementId: settlement.id, approve: false }).errorCode).toBe("settlementResolved");
  });

  it("a rejected settlement returns the earnings to be settled again", () => {
    const { state } = earned();
    let current = must(state, { ...ADMIN_A, at: day(20), type: "settlement.request", sellerTenantId: "tenant-nova", currency: "USD" });
    current = must(current, { ...ADMIN_B, at: day(21), type: "settlement.decide", settlementId: current.settlements[0].id, approve: false });
    expect(current.charges[0]).toMatchObject({ status: "accrued", settlementId: undefined });
    expect(ask(current, ADMIN_A).error).toBeUndefined();
  });
});

describe("search, filters and categories", () => {
  const catalog = () => demoOk();

  it("finds by name, tag, summary and kind, ignoring accents and case, and requires every word", () => {
    const state = catalog();
    expect(searchCatalog(state, { text: "CLINICAS" }).map((item) => item.listing.content.name)).toEqual(["Marketing para clínicas"]);
    expect(searchCatalog(state, { text: "seguimiento ventas" })).toHaveLength(1);
    expect(searchCatalog(state, { text: "seguimiento hoteles" })).toHaveLength(0);
    expect(searchCatalog(state, { text: "whats" }).map((item) => item.listing.id)).toHaveLength(1); // prefix
    expect(searchCatalog(state, { text: "curso" }).map((item) => item.listing.kind)).toEqual(["course"]); // the kind's own label counts
    expect(tokenize("Átomo, ÁREA-51")).toEqual(["atomo", "area", "51"]);
  });

  it("lists only published listings", () => {
    const state = catalog();
    expect(searchCatalog(state)).toHaveLength(4);
    expect(searchCatalog(state, { text: "auditoría" })).toHaveLength(0); // pending
    expect(searchCatalog(state, { text: "aviso" })).toHaveLength(0); // draft
  });

  it("filters by kind, category, pricing, currency, price and rating", () => {
    const state = catalog();
    const names = (query: Parameters<typeof searchCatalog>[1]) => searchCatalog(state, query).map((item) => item.listing.content.name).sort();
    expect(names({ kinds: ["course", "app"] })).toEqual(["Marketing para clínicas", "Reservas rápidas"]);
    expect(names({ category: "sales" })).toEqual(["Asistente de seguimiento"]);
    expect(names({ pricing: "free" })).toEqual(["Plantillas de WhatsApp"]);
    expect(names({ pricing: "paid" })).toHaveLength(3);
    expect(names({ pricing: "subscription" })).toEqual(["Asistente de seguimiento", "Reservas rápidas"]);
    expect(names({ pricing: "oneTime" })).toEqual(["Marketing para clínicas"]);
    expect(names({ currency: "EUR" })).toEqual([]);
    expect(names({ currency: "USD", maxPriceMinor: 5_000 })).toEqual(["Asistente de seguimiento", "Marketing para clínicas", "Plantillas de WhatsApp"]); // free always fits
    expect(names({ minRating: 4.5 })).toEqual(["Marketing para clínicas"]);
    expect(names({ minRating: 1 })).toEqual(["Marketing para clínicas"]); // listings with no visible reviews have no rating to compare
  });

  it("sorts by price, rating, popularity, newest and relevance, with a stable tie-break", () => {
    const state = catalog();
    const order = (sort: NonNullable<Parameters<typeof searchCatalog>[1]>["sort"]) => searchCatalog(state, { sort }).map((item) => item.listing.content.name);
    expect(order("priceAsc")[0]).toBe("Plantillas de WhatsApp");
    expect(order("priceDesc")[0]).toBe("Reservas rápidas");
    expect(order("rating")[0]).toBe("Marketing para clínicas");
    expect(order("popular")[0]).toBe("Marketing para clínicas");
    expect(searchCatalog(state, { text: "marketing" })[0].listing.content.name).toBe("Marketing para clínicas"); // name beats a tag elsewhere
    expect(order("newest")).toHaveLength(4);
    expect(searchCatalog(state, { sort: "popular" }).map((i) => i.listing.id)).toEqual(searchCatalog(state, { sort: "popular" }).map((i) => i.listing.id));
  });

  it("knows every kind and category in the dictionary", () => {
    for (const kind of ITEM_KINDS) expect(label("itemKind", kind)).not.toBe("");
    for (const category of CATEGORIES) expect(label("category", category)).not.toBe("");
  });
});

describe("one company never sees or changes another's data", () => {
  it("scopes purchases, downloads, listings and the seller dashboard to the company", () => {
    const state = demoOk();
    expect(purchasesOf(state, "tenant-vida").every((purchase) => purchase.buyerTenantId === "tenant-vida")).toBe(true);
    expect(purchasesOf(state, "tenant-nova").map((p) => p.listingId)).toHaveLength(2);
    expect(downloadsOf(state, "tenant-nova")).toHaveLength(0);
    expect(listingsOf(state, "tenant-mar").map((l) => l.content.name)).toEqual(["Reservas rápidas"]);
    expect(sellerDashboard(state, "tenant-mar").sales).toBe(1);
    expect(sellerDashboard(state, "tenant-mar").gross).toEqual({ USD: 12_000 });
    expect(sellerDashboard(state, "tenant-unknown").sales).toBe(0);
  });

  it("refuses edits, retirements, replies, cancellations, downloads and reviews on another company's records", () => {
    const state = demoOk();
    const course = state.listings.find((l) => l.content.name === "Marketing para clínicas");
    const purchaseOfVida = state.purchases.find((p) => p.buyerTenantId === "tenant-vida" && p.listingId === course?.id);
    const reviewOfMar = state.reviews.find((r) => r.buyerTenantId === "tenant-mar");
    expect(step(state, { ...MAR, at: day(20), type: "listing.edit", listingId: course?.id ?? "", content: baseContent() }).errorCode).toBe("notYours");
    expect(step(state, { ...MAR, at: day(20), type: "listing.retire", listingId: course?.id ?? "" }).errorCode).toBe("notYours");
    expect(step(state, { ...MAR, at: day(20), type: "download.record", purchaseId: purchaseOfVida?.id ?? "" }).errorCode).toBe("notYourPurchase");
    expect(step(state, { ...MAR, at: day(20), type: "purchase.cancel", purchaseId: purchaseOfVida?.id ?? "" }).errorCode).toBe("notYourPurchase");
    expect(step(state, { ...MAR, at: day(20), type: "review.submit", purchaseId: purchaseOfVida?.id ?? "", rating: 5, body: "" }).errorCode).toBe("reviewNotAllowed");
    expect(step(state, { ...VIDA, at: day(20), type: "review.reply", reviewId: reviewOfMar?.id ?? "", text: "x" }).errorCode).toBe("notYours");
  });
});

describe("nothing is ever trimmed", () => {
  it("keeps every purchase, favorite, log and audit entry, however many there are", () => {
    const { state, id } = published(fresh());
    let current = state;
    for (let index = 0; index < 400; index += 1) {
      current = must(current, { tenantId: `tenant-${index}`, actor: `user-${index}`, at: day(5), type: "purchase.create", listingId: id });
      current = must(current, { tenantId: `tenant-${index}`, actor: `user-${index}`, at: day(5), type: "favorite.toggle", listingId: id });
    }
    expect(current.purchases).toHaveLength(400);
    expect(current.favorites).toHaveLength(400);
    expect(current.audit.length).toBeGreaterThan(800);
    expect(current.logs.length).toBeGreaterThan(800);
    expect(current.audit[0].action).toBe("listing.create"); // the first thing that ever happened is still there
  });
});

describe("language", () => {
  it("has a message for every error code and no placeholder left unfilled", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x", from: "a", to: "b", status: "s", date: "d", max: 1, min: 1 })).not.toMatch(/\{\w+\}/);
    expect(message("listingInvalid", { detail: "nombre" })).toBe("La publicación no cumple los requisitos: nombre.");
    expect(label("listingStatus", "pending")).toBe("En revisión");
    expect(label("sort", "priceAsc")).toContain("menor");
  });
});
