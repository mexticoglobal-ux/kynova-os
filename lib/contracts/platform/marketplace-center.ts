// Marketplace Center store: any company can sell products, services, courses, AI agents, automations, apps and digital
// resources; any company can buy. Pure and deterministic. One global catalog, with every record owned by a company
// (tenant): a company only ever sees and changes its own purchases, favorites, reviews and listings.
//
// No real payments or APIs: a purchase is simulated, and a seller settlement is only a request that people approve, with
// "paid" recorded using an external reference someone supplies. Nothing here moves money.
//
// Constitution (ADR-0009): every publication needs a person's approval, and every change to the revenue share is
// Level 3 (proposed by one admin, approved by another). NEX may prepare a draft (Level 1); it never publishes, buys,
// moderates, sets a revenue share or settles.

import { isPerson, isWorker } from "./actors";
import { addInterval } from "./billing";
import { isCrypto, isCurrency, sumByCurrency, type CurrencyCode } from "./currency";
import { EXTERNAL_EFFECTS, type Capability } from "./integrations";
import { label, message, type ErrorCode } from "./marketplace-messages";
import { splitRevenue } from "./marketplace";
import type { Money } from "./payments";

// ---------------------------------------------------------------- catalog vocabulary
export const ITEM_KINDS = ["product", "service", "course", "aiAgent", "automation", "app", "digitalResource"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export const CATEGORIES = ["marketing", "sales", "finance", "operations", "education", "design", "support", "development", "industry"] as const;
export type Category = (typeof CATEGORIES)[number];

export type MarketPricing = { model: "free" } | { model: "oneTime"; amountMinor: number } | { model: "subscription"; amountMinor: number; interval: "month" | "year" };
export type ListingContent = {
  name: string;
  summary: string;
  description: string;
  category: Category;
  tags: readonly string[];
  version: string;
  pricing: MarketPricing;
  currency: CurrencyCode;
  // What it may do once installed. Anything not declared here is denied.
  permissions: { capabilities: readonly Capability[]; readsPersonalData: boolean; writesExternally: boolean };
  privacyPolicyUrl?: string;
  supportContact?: string;
  deliverable?: { fileName: string; sizeBytes: number };
};

export type ListingStatus = "draft" | "pending" | "published" | "rejected" | "suspended" | "retired";
export type ModerationEntry = { at: string; actor: string; action: "submitted" | "approved" | "rejected" | "suspended" | "reinstateRequested" | "revisionSubmitted" | "revisionApproved" | "revisionRejected" | "retired"; reason?: string };
export type Listing = {
  id: string;
  sellerTenantId: string;
  kind: ItemKind;
  content: ListingContent;
  status: ListingStatus;
  shareOverrideBps?: number; // platform share for this listing; only changed through an approved Level 3 change
  createdBy: string;
  createdAt: string;
  submittedBy?: string;
  publishedAt?: string;
  pendingRevision?: { content: ListingContent; submittedBy: string; submittedAt: string };
  moderation: readonly ModerationEntry[];
};

export type Purchase = { id: string; listingId: string; buyerTenantId: string; buyerUser: string; pricing: MarketPricing; currency: CurrencyCode; status: "active" | "cancelled"; createdAt: string; nextRenewalAt?: string };
export type ChargeStatus = "accrued" | "inSettlement" | "settled";
export type Charge = { id: string; purchaseId: string; listingId: string; sellerTenantId: string; at: string; gross: Money; platformFee: Money; sellerNet: Money; shareBps: number; status: ChargeStatus; settlementId?: string };
export type Download = { id: string; purchaseId: string; listingId: string; buyerTenantId: string; user: string; at: string };
export type Review = { id: string; purchaseId: string; listingId: string; buyerTenantId: string; user: string; rating: number; body: string; createdAt: string; reply?: { text: string; by: string; at: string }; hidden?: { reason: string; by: string; at: string } };
export type Favorite = { tenantId: string; userId: string; listingId: string };
export type ShareScope = { type: "default" } | { type: "listing"; listingId: string };
export type ShareChange = { id: string; scope: ShareScope; fromBps: number; toBps: number; reason: string; status: "requested" | "approved" | "rejected"; requestedBy: string; requestedAt: string; decidedBy?: string; decidedAt?: string };
export type Settlement = { id: string; sellerTenantId: string; chargeIds: readonly string[]; total: Money; status: "requested" | "approved" | "paid" | "rejected"; requestedBy: string; requestedAt: string; decidedBy?: string; decidedAt?: string; paidAt?: string; paymentRef?: string };

export type MarketAudit = { at: string; actor: string; tenantId: string; action: string; detail?: string };
export type MarketLog = { at: string; level: "info" | "warn"; event: string };

export type MarketState = {
  admins: readonly string[]; // platform administrators: decided by the state, never by what an event claims
  defaultShareBps: number;
  minSettlementMinor: number;
  listings: readonly Listing[];
  purchases: readonly Purchase[];
  charges: readonly Charge[];
  downloads: readonly Download[];
  reviews: readonly Review[];
  favorites: readonly Favorite[];
  shareChanges: readonly ShareChange[];
  settlements: readonly Settlement[];
  audit: readonly MarketAudit[];
  logs: readonly MarketLog[];
  sequence: number;
};

export const DEFAULT_SHARE_BPS = 1_500; // 15 % to the platform
export const MAX_SHARE_BPS = 5_000; // never more than 50 %
export const MAX_DOWNLOADS_PER_PURCHASE = 20;
export const MAX_REVIEW_CHARS = 2_000;

export const newMarketState = (admins: readonly string[] = [], over: Partial<Pick<MarketState, "defaultShareBps" | "minSettlementMinor">> = {}): MarketState => ({
  admins, defaultShareBps: over.defaultShareBps ?? DEFAULT_SHARE_BPS, minSettlementMinor: over.minSettlementMinor ?? 1_000,
  listings: [], purchases: [], charges: [], downloads: [], reviews: [], favorites: [], shareChanges: [], settlements: [], audit: [], logs: [], sequence: 0,
});

// ---------------------------------------------------------------- objective review
export const DOWNLOADABLE_KINDS: readonly ItemKind[] = ["digitalResource", "course", "automation", "app", "product"];
export const ACTING_KINDS: readonly ItemKind[] = ["aiAgent", "automation", "app"];

/** The objective checks that must pass before a listing can be submitted or approved. A person still decides. */
export function objectiveIssues(kind: ItemKind, content: ListingContent): string[] {
  const issues: string[] = [];
  if (content.name.trim() === "" || content.name.length > 100) issues.push("nombre (1 a 100 caracteres)");
  if (content.summary.trim() === "" || content.summary.length > 200) issues.push("resumen (1 a 200 caracteres)");
  if (content.description.trim() === "") issues.push("descripción");
  if (!/^\d+\.\d+\.\d+$/.test(content.version)) issues.push("versión semántica (1.2.3)");
  if (!isCurrency(content.currency) || isCrypto(content.currency)) issues.push("moneda (solo dinero tradicional)");
  if (content.pricing.model !== "free" && (!Number.isSafeInteger(content.pricing.amountMinor) || content.pricing.amountMinor <= 0)) issues.push("precio positivo en unidades menores");
  if (content.tags.length > 8) issues.push("hasta 8 etiquetas");
  if (content.permissions.readsPersonalData && !content.privacyPolicyUrl) issues.push("política de privacidad (lee datos personales)");
  if (content.privacyPolicyUrl && !/^https:\/\//.test(content.privacyPolicyUrl)) issues.push("política de privacidad con https");
  if (content.permissions.writesExternally && !content.supportContact) issues.push("contacto de soporte (actúa fuera de la plataforma)");
  if (ACTING_KINDS.includes(kind) && content.permissions.capabilities.length === 0) issues.push("capacidades declaradas");
  if (content.permissions.capabilities.some((capability) => EXTERNAL_EFFECTS.includes(capability)) && !content.permissions.writesExternally) issues.push("declarar que actúa fuera de la plataforma");
  if (kind === "digitalResource" && !content.deliverable) issues.push("archivo para descargar");
  if (content.deliverable && (content.deliverable.fileName.trim() === "" || !Number.isSafeInteger(content.deliverable.sizeBytes) || content.deliverable.sizeBytes <= 0)) issues.push("archivo válido");
  return issues;
}

// ---------------------------------------------------------------- events
type Base = { at: string; tenantId: string; actor: string };
export type MarketEvent =
  | (Base & { type: "listing.create"; kind: ItemKind; content: ListingContent })
  | (Base & { type: "listing.edit"; listingId: string; content: ListingContent })
  | (Base & { type: "listing.submit"; listingId: string })
  | (Base & { type: "listing.retire"; listingId: string })
  | (Base & { type: "moderation.decide"; listingId: string; approve: boolean; reason?: string })
  | (Base & { type: "moderation.suspend"; listingId: string; reason: string })
  | (Base & { type: "moderation.reinstate"; listingId: string })
  | (Base & { type: "purchase.create"; listingId: string })
  | (Base & { type: "purchase.renew"; purchaseId: string })
  | (Base & { type: "purchase.cancel"; purchaseId: string })
  | (Base & { type: "download.record"; purchaseId: string })
  | (Base & { type: "favorite.toggle"; listingId: string })
  | (Base & { type: "review.submit"; purchaseId: string; rating: number; body: string })
  | (Base & { type: "review.reply"; reviewId: string; text: string })
  | (Base & { type: "review.hide"; reviewId: string; reason: string })
  | (Base & { type: "share.request"; scope: ShareScope; toBps: number; reason: string })
  | (Base & { type: "share.decide"; changeId: string; approve: boolean })
  | (Base & { type: "settlement.request"; sellerTenantId: string; currency: string })
  | (Base & { type: "settlement.decide"; settlementId: string; approve: boolean })
  | (Base & { type: "settlement.markPaid"; settlementId: string; paymentRef: string });

export type MarketResult = { state: MarketState; error?: string; errorCode?: ErrorCode };

// ---------------------------------------------------------------- helpers
// Nothing is ever trimmed: records, logs and the audit trail all stay. Limits belong to the view (display.ts).
const append = <T,>(items: readonly T[], item: T): readonly T[] => [...items, item];
const replace = <T extends { id: string }>(items: readonly T[], item: T): readonly T[] => items.map((existing) => (existing.id === item.id ? item : existing));
const nextId = (state: MarketState, prefix: string): { id: string; state: MarketState } => {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(4, "0")}`, state: { ...state, sequence } };
};
const note = (state: MarketState, event: { at: string; actor: string; tenantId: string }, action: string, detail?: string, level: MarketLog["level"] = "info"): MarketState => ({
  ...state,
  audit: append(state.audit, { at: event.at, actor: event.actor, tenantId: event.tenantId, action, detail }),
  logs: append(state.logs, { at: event.at, level, event: detail ? `${action}: ${detail}` : action }),
});
const trail = (listing: Listing, entry: ModerationEntry): Listing => ({ ...listing, moderation: append(listing.moderation, entry) });

export const isAdmin = (state: MarketState, actor: string): boolean => isPerson(actor) && state.admins.includes(actor);
export const effectiveShareBps = (state: MarketState, listing: Listing): number => listing.shareOverrideBps ?? state.defaultShareBps;
const priceOf = (pricing: MarketPricing): number => (pricing.model === "free" ? 0 : pricing.amountMinor);

function charge(state: MarketState, purchase: Purchase, listing: Listing, at: string): MarketState {
  const amount = priceOf(purchase.pricing);
  if (amount === 0) return state;
  const shareBps = effectiveShareBps(state, listing);
  const split = splitRevenue(amount, shareBps);
  const created = nextId(state, "ch");
  const money = (amountMinor: number): Money => ({ amountMinor, currency: purchase.currency });
  const entry: Charge = { id: created.id, purchaseId: purchase.id, listingId: listing.id, sellerTenantId: listing.sellerTenantId, at, gross: money(amount), platformFee: money(split.platformMinor), sellerNet: money(split.publisherMinor), shareBps, status: "accrued" };
  return { ...created.state, charges: append(created.state.charges, entry) };
}

// ---------------------------------------------------------------- the reducer
export function reduceMarket(state: MarketState, event: MarketEvent): MarketResult {
  const refuse = (code: ErrorCode, params?: Record<string, string | number>): MarketResult => ({ state, error: message(code, params), errorCode: code });
  const person = isPerson(event.actor);
  const find = (id: string) => state.listings.find((item) => item.id === id);
  const ownListing = (id: string): { listing?: Listing; failure?: MarketResult } => {
    const listing = find(id);
    if (!listing) return { failure: refuse("listingNotFound") };
    if (listing.sellerTenantId !== event.tenantId) return { failure: refuse("notYours") };
    return { listing };
  };

  switch (event.type) {
    // ---- publishing: a draft may be prepared by NEX; submitting and approving are people's
    case "listing.create": {
      if (!person && !isWorker(event.actor)) return refuse("personRequired");
      const created = nextId(state, "ls");
      const listing: Listing = { id: created.id, sellerTenantId: event.tenantId, kind: event.kind, content: event.content, status: "draft", createdBy: event.actor, createdAt: event.at, moderation: [] };
      return { state: note({ ...created.state, listings: append(created.state.listings, listing) }, event, "listing.create", `${listing.id} · ${event.kind}`) };
    }

    case "listing.edit": {
      const { listing, failure } = ownListing(event.listingId);
      if (!listing) return failure as MarketResult;
      if (listing.status === "pending") return refuse("inReview");
      if (listing.status === "draft" || listing.status === "rejected") {
        if (!person && !isWorker(event.actor)) return refuse("personRequired");
        return { state: note({ ...state, listings: replace(state.listings, { ...listing, content: event.content, status: "draft" }) }, event, "listing.edit", listing.id) };
      }
      if (listing.status !== "published") return refuse("notEditable", { status: label("listingStatus", listing.status) });
      // Changing something already published is a new publication: it goes back through review, and the live version stays as it is.
      if (!person) return refuse("personRequired");
      const issues = objectiveIssues(listing.kind, event.content);
      if (issues.length) return refuse("listingInvalid", { detail: issues[0] });
      const revised = trail({ ...listing, pendingRevision: { content: event.content, submittedBy: event.actor, submittedAt: event.at } }, { at: event.at, actor: event.actor, action: "revisionSubmitted" });
      return { state: note({ ...state, listings: replace(state.listings, revised) }, event, "listing.revision", listing.id) };
    }

    case "listing.submit": {
      if (!person) return refuse("personRequired");
      const { listing, failure } = ownListing(event.listingId);
      if (!listing) return failure as MarketResult;
      if (listing.status !== "draft" && listing.status !== "rejected") return refuse("invalidTransition", { from: label("listingStatus", listing.status), to: label("listingStatus", "pending") });
      const issues = objectiveIssues(listing.kind, listing.content);
      if (issues.length) return refuse("listingInvalid", { detail: issues[0] });
      const submitted = trail({ ...listing, status: "pending", submittedBy: event.actor }, { at: event.at, actor: event.actor, action: "submitted" });
      return { state: note({ ...state, listings: replace(state.listings, submitted) }, event, "listing.submit", listing.id) };
    }

    case "listing.retire": {
      if (!person) return refuse("personRequired");
      const listing = find(event.listingId);
      if (!listing) return refuse("listingNotFound");
      if (listing.sellerTenantId !== event.tenantId && !isAdmin(state, event.actor)) return refuse("notYours");
      if (listing.status === "retired") return refuse("invalidTransition", { from: label("listingStatus", "retired"), to: label("listingStatus", "retired") });
      const purchases = state.purchases.map((purchase) => (purchase.listingId === listing.id && purchase.pricing.model === "subscription" && purchase.status === "active" ? { ...purchase, status: "cancelled" as const } : purchase));
      return { state: note({ ...state, purchases, listings: replace(state.listings, trail({ ...listing, status: "retired", pendingRevision: undefined }, { at: event.at, actor: event.actor, action: "retired" })) }, event, "listing.retire", listing.id) };
    }

    // ---- moderation
    case "moderation.decide": {
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      const listing = find(event.listingId);
      if (!listing) return refuse("listingNotFound");
      const revision = listing.status === "published" ? listing.pendingRevision : undefined;
      if (listing.status !== "pending" && !revision) return refuse("nothingToReview");
      const submitter = revision ? revision.submittedBy : listing.submittedBy;
      if (submitter === event.actor) return refuse("selfReview");
      const reason = event.reason?.trim() ?? "";
      if (!event.approve && reason === "") return refuse("reasonRequired");
      if (event.approve) {
        const issues = objectiveIssues(listing.kind, revision ? revision.content : listing.content);
        if (issues.length) return refuse("listingInvalid", { detail: issues[0] });
      }
      let updated: Listing;
      if (revision) {
        updated = trail(
          event.approve ? { ...listing, content: revision.content, pendingRevision: undefined } : { ...listing, pendingRevision: undefined },
          { at: event.at, actor: event.actor, action: event.approve ? "revisionApproved" : "revisionRejected", reason: reason || undefined },
        );
      } else {
        updated = trail(
          event.approve ? { ...listing, status: "published", publishedAt: event.at } : { ...listing, status: "rejected" },
          { at: event.at, actor: event.actor, action: event.approve ? "approved" : "rejected", reason: reason || undefined },
        );
      }
      return { state: note({ ...state, listings: replace(state.listings, updated) }, event, event.approve ? "moderation.approve" : "moderation.reject", listing.id) };
    }

    case "moderation.suspend": {
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      const listing = find(event.listingId);
      if (!listing) return refuse("listingNotFound");
      if (listing.status !== "published") return refuse("notPublished");
      if (event.reason.trim() === "") return refuse("reasonRequired");
      return { state: note({ ...state, listings: replace(state.listings, trail({ ...listing, status: "suspended" }, { at: event.at, actor: event.actor, action: "suspended", reason: event.reason.trim() })) }, event, "moderation.suspend", listing.id, "warn") };
    }

    case "moderation.reinstate": {
      // Bringing a suspended listing back is a publication: it needs a second admin's approval.
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      const listing = find(event.listingId);
      if (!listing) return refuse("listingNotFound");
      if (listing.status !== "suspended") return refuse("invalidTransition", { from: label("listingStatus", listing.status), to: label("listingStatus", "pending") });
      return { state: note({ ...state, listings: replace(state.listings, trail({ ...listing, status: "pending", submittedBy: event.actor }, { at: event.at, actor: event.actor, action: "reinstateRequested" })) }, event, "moderation.reinstate", listing.id) };
    }

    // ---- buying (simulated)
    case "purchase.create": {
      if (!person) return refuse("personRequired"); // spending is Level 3
      const listing = find(event.listingId);
      if (!listing) return refuse("listingNotFound");
      if (listing.status !== "published") return refuse("notPublished");
      if (listing.sellerTenantId === event.tenantId) return refuse("ownListing");
      if (state.purchases.some((purchase) => purchase.listingId === listing.id && purchase.buyerTenantId === event.tenantId && purchase.status === "active")) return refuse("alreadyOwned");
      const created = nextId(state, "pu");
      const { pricing, currency } = listing.content;
      const purchase: Purchase = {
        id: created.id, listingId: listing.id, buyerTenantId: event.tenantId, buyerUser: event.actor, pricing, currency, status: "active", createdAt: event.at,
        nextRenewalAt: pricing.model === "subscription" ? addInterval(event.at, pricing.interval) : undefined,
      };
      const next = charge({ ...created.state, purchases: append(created.state.purchases, purchase) }, purchase, listing, event.at);
      return { state: note(next, event, "purchase.create", `${purchase.id} · ${listing.id} · simulado`) };
    }

    case "purchase.renew": {
      if (!person && event.actor !== "system") return refuse("personRequired");
      const purchase = state.purchases.find((item) => item.id === event.purchaseId);
      if (!purchase) return refuse("purchaseNotFound");
      const listing = find(purchase.listingId);
      if (!listing) return refuse("listingNotFound");
      if (purchase.status !== "active" || purchase.pricing.model !== "subscription" || !purchase.nextRenewalAt) return refuse("purchaseInactive");
      if (listing.status !== "published") return refuse("notPublished");
      if (Date.parse(event.at) < Date.parse(purchase.nextRenewalAt)) return refuse("renewalNotDue", { date: purchase.nextRenewalAt.slice(0, 10) });
      const renewed: Purchase = { ...purchase, nextRenewalAt: addInterval(event.at, purchase.pricing.interval) };
      return { state: note(charge({ ...state, purchases: replace(state.purchases, renewed) }, renewed, listing, event.at), event, "purchase.renew", purchase.id) };
    }

    case "purchase.cancel": {
      if (!person) return refuse("personRequired");
      const purchase = state.purchases.find((item) => item.id === event.purchaseId);
      if (!purchase) return refuse("purchaseNotFound");
      if (purchase.buyerTenantId !== event.tenantId) return refuse("notYourPurchase");
      if (purchase.status !== "active") return refuse("purchaseInactive");
      if (purchase.pricing.model === "oneTime") return refuse("notCancellable");
      return { state: note({ ...state, purchases: replace(state.purchases, { ...purchase, status: "cancelled", nextRenewalAt: undefined }) }, event, "purchase.cancel", purchase.id) };
    }

    case "download.record": {
      if (!person) return refuse("personRequired");
      const purchase = state.purchases.find((item) => item.id === event.purchaseId);
      if (!purchase) return refuse("purchaseNotFound");
      if (purchase.buyerTenantId !== event.tenantId) return refuse("notYourPurchase");
      if (purchase.status !== "active") return refuse("purchaseInactive");
      const listing = find(purchase.listingId);
      if (!listing?.content.deliverable) return refuse("noDeliverable");
      if (listing.status === "suspended") return refuse("suspendedNoAccess");
      if (state.downloads.filter((download) => download.purchaseId === purchase.id).length >= MAX_DOWNLOADS_PER_PURCHASE) return refuse("downloadLimit", { max: MAX_DOWNLOADS_PER_PURCHASE });
      const created = nextId(state, "dl");
      const download: Download = { id: created.id, purchaseId: purchase.id, listingId: listing.id, buyerTenantId: event.tenantId, user: event.actor, at: event.at };
      return { state: note({ ...created.state, downloads: append(created.state.downloads, download) }, event, "download.record", `${download.id} · ${listing.id}`) };
    }

    // ---- favorites
    case "favorite.toggle": {
      if (!person) return refuse("personRequired");
      const listing = find(event.listingId);
      if (!listing) return refuse("listingNotFound");
      const existing = state.favorites.find((fav) => fav.tenantId === event.tenantId && fav.userId === event.actor && fav.listingId === event.listingId);
      if (existing) return { state: note({ ...state, favorites: state.favorites.filter((fav) => fav !== existing) }, event, "favorite.remove", event.listingId) };
      if (listing.status !== "published") return refuse("notPublished");
      return { state: note({ ...state, favorites: append(state.favorites, { tenantId: event.tenantId, userId: event.actor, listingId: event.listingId }) }, event, "favorite.add", event.listingId) };
    }

    // ---- ratings and reviews
    case "review.submit": {
      if (!person) return refuse("personRequired");
      const purchase = state.purchases.find((item) => item.id === event.purchaseId);
      if (!purchase) return refuse("purchaseNotFound");
      if (purchase.buyerTenantId !== event.tenantId) return refuse("reviewNotAllowed");
      if (state.reviews.some((review) => review.purchaseId === purchase.id)) return refuse("alreadyReviewed");
      if (!Number.isInteger(event.rating) || event.rating < 1 || event.rating > 5) return refuse("ratingInvalid");
      const body = event.body.trim();
      if (body.length > MAX_REVIEW_CHARS) return refuse("reviewTooLong", { max: MAX_REVIEW_CHARS });
      const created = nextId(state, "rv");
      const review: Review = { id: created.id, purchaseId: purchase.id, listingId: purchase.listingId, buyerTenantId: event.tenantId, user: event.actor, rating: event.rating, body, createdAt: event.at };
      return { state: note({ ...created.state, reviews: append(created.state.reviews, review) }, event, "review.submit", `${review.id} · ${review.listingId}`) };
    }

    case "review.reply": {
      if (!person) return refuse("personRequired");
      const review = state.reviews.find((item) => item.id === event.reviewId);
      if (!review) return refuse("reviewNotFound");
      const listing = find(review.listingId);
      if (!listing || listing.sellerTenantId !== event.tenantId) return refuse("notYours");
      if (review.reply) return refuse("alreadyReplied");
      if (event.text.trim() === "") return refuse("reasonRequired");
      return { state: note({ ...state, reviews: replace(state.reviews, { ...review, reply: { text: event.text.trim(), by: event.actor, at: event.at } }) }, event, "review.reply", review.id) };
    }

    case "review.hide": {
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      const review = state.reviews.find((item) => item.id === event.reviewId);
      if (!review) return refuse("reviewNotFound");
      if (event.reason.trim() === "") return refuse("reasonRequired");
      return { state: note({ ...state, reviews: replace(state.reviews, { ...review, hidden: { reason: event.reason.trim(), by: event.actor, at: event.at } }) }, event, "review.hide", review.id, "warn") };
    }

    // ---- revenue share: Level 3. One admin proposes, another approves; it applies to future charges only.
    case "share.request": {
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      if (!Number.isInteger(event.toBps) || event.toBps < 0 || event.toBps > MAX_SHARE_BPS) return refuse("shareInvalid", { max: MAX_SHARE_BPS });
      if (event.reason.trim() === "") return refuse("reasonRequired");
      let fromBps = state.defaultShareBps;
      if (event.scope.type === "listing") {
        const listing = find(event.scope.listingId);
        if (!listing) return refuse("listingNotFound");
        fromBps = effectiveShareBps(state, listing);
      }
      if (fromBps === event.toBps) return refuse("shareUnchanged");
      const sameScope = (scope: ShareScope) => (scope.type === "default" ? event.scope.type === "default" : event.scope.type === "listing" && event.scope.listingId === scope.listingId);
      if (state.shareChanges.some((change) => change.status === "requested" && sameScope(change.scope))) return refuse("sharePending");
      const created = nextId(state, "sc");
      const change: ShareChange = { id: created.id, scope: event.scope, fromBps, toBps: event.toBps, reason: event.reason.trim(), status: "requested", requestedBy: event.actor, requestedAt: event.at };
      return { state: note({ ...created.state, shareChanges: append(created.state.shareChanges, change) }, event, "share.request", `${change.id} · ${fromBps} → ${event.toBps}`) };
    }

    case "share.decide": {
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      const change = state.shareChanges.find((item) => item.id === event.changeId);
      if (!change) return refuse("shareChangeNotFound");
      if (change.status !== "requested") return refuse("shareChangeResolved");
      if (event.approve && change.requestedBy === event.actor) return refuse("selfApproval");
      const decided: ShareChange = { ...change, status: event.approve ? "approved" : "rejected", decidedBy: event.actor, decidedAt: event.at };
      let next: MarketState = { ...state, shareChanges: replace(state.shareChanges, decided) };
      if (event.approve) {
        if (change.scope.type === "default") next = { ...next, defaultShareBps: change.toBps };
        else {
          const scope = change.scope;
          const listing = find(scope.listingId);
          if (listing) next = { ...next, listings: replace(next.listings, { ...listing, shareOverrideBps: change.toBps }) };
        }
      }
      return { state: note(next, event, event.approve ? "share.approve" : "share.reject", change.id) };
    }

    // ---- settling what sellers earned: Level 3, decoupled from any payment gateway
    case "settlement.request": {
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      if (!isCurrency(event.currency) || isCrypto(event.currency)) return refuse("currencyInvalid");
      const ready = state.charges.filter((item) => item.sellerTenantId === event.sellerTenantId && item.status === "accrued" && item.sellerNet.currency === event.currency);
      if (ready.length === 0) return refuse("nothingToSettle");
      const total = ready.reduce((sum, item) => sum + item.sellerNet.amountMinor, 0);
      if (total < state.minSettlementMinor) return refuse("settlementBelowMinimum", { min: state.minSettlementMinor });
      const created = nextId(state, "st");
      const settlement: Settlement = { id: created.id, sellerTenantId: event.sellerTenantId, chargeIds: ready.map((item) => item.id), total: { amountMinor: total, currency: event.currency }, status: "requested", requestedBy: event.actor, requestedAt: event.at };
      const charges = created.state.charges.map((item) => (settlement.chargeIds.includes(item.id) ? { ...item, status: "inSettlement" as const, settlementId: settlement.id } : item));
      return { state: note({ ...created.state, charges, settlements: append(created.state.settlements, settlement) }, event, "settlement.request", `${settlement.id} · ${event.sellerTenantId}`) };
    }

    case "settlement.decide": {
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      const settlement = state.settlements.find((item) => item.id === event.settlementId);
      if (!settlement) return refuse("settlementNotFound");
      if (settlement.status !== "requested") return refuse("settlementResolved");
      if (event.approve && settlement.requestedBy === event.actor) return refuse("selfApproval");
      const decided: Settlement = { ...settlement, status: event.approve ? "approved" : "rejected", decidedBy: event.actor, decidedAt: event.at };
      const charges = event.approve ? state.charges : state.charges.map((item) => (item.settlementId === settlement.id ? { ...item, status: "accrued" as const, settlementId: undefined } : item));
      return { state: note({ ...state, charges, settlements: replace(state.settlements, decided) }, event, event.approve ? "settlement.approve" : "settlement.reject", settlement.id) };
    }

    case "settlement.markPaid": {
      if (!isAdmin(state, event.actor)) return refuse(person ? "adminRequired" : "personRequired");
      const settlement = state.settlements.find((item) => item.id === event.settlementId);
      if (!settlement) return refuse("settlementNotFound");
      if (settlement.status !== "approved") return refuse("settlementNotApproved");
      const paymentRef = event.paymentRef.trim();
      if (paymentRef === "" || paymentRef.length > 80) return refuse("paymentRefRequired");
      const charges = state.charges.map((item) => (item.settlementId === settlement.id ? { ...item, status: "settled" as const } : item));
      return { state: note({ ...state, charges, settlements: replace(state.settlements, { ...settlement, status: "paid", paidAt: event.at, paymentRef }) }, event, "settlement.paid", `${settlement.id} · ${paymentRef}`) };
    }
  }
}

export function applyAllMarket(state: MarketState, events: readonly MarketEvent[]): { state: MarketState; errors: string[] } {
  const errors: string[] = [];
  let current = state;
  for (const event of events) {
    const result = reduceMarket(current, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    current = result.state;
  }
  return { state: current, errors };
}

// ---------------------------------------------------------------- ratings
export function ratingOf(state: MarketState, listingId: string): { average: number | null; count: number; distribution: [number, number, number, number, number] } {
  const visible = state.reviews.filter((review) => review.listingId === listingId && !review.hidden);
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  for (const review of visible) distribution[review.rating - 1] += 1;
  const average = visible.length === 0 ? null : Math.round((visible.reduce((sum, review) => sum + review.rating, 0) / visible.length) * 10) / 10;
  return { average, count: visible.length, distribution };
}

// ---------------------------------------------------------------- search and filters (published listings only)
export type CatalogQuery = {
  text?: string;
  kinds?: readonly ItemKind[];
  category?: Category;
  pricing?: "free" | "paid" | "oneTime" | "subscription";
  currency?: CurrencyCode;
  maxPriceMinor?: number; // compared only for listings in `currency`
  minRating?: number;
  sort?: "relevance" | "newest" | "rating" | "priceAsc" | "priceDesc" | "popular";
  favoritesOf?: { tenantId: string; userId: string };
};
export type CatalogItem = { listing: Listing; rating: ReturnType<typeof ratingOf>; sales: number; relevance: number; isFavorite: boolean };

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const tokenize = (text: string): string[] => fold(text).split(/[^a-z0-9]+/).filter(Boolean);

export function searchCatalog(state: MarketState, query: CatalogQuery = {}, viewer?: { tenantId: string; userId: string }): CatalogItem[] {
  const tokens = tokenize(query.text ?? "");
  const items: CatalogItem[] = [];
  for (const listing of state.listings) {
    if (listing.status !== "published") continue;
    const { content } = listing;
    if (query.kinds && query.kinds.length > 0 && !query.kinds.includes(listing.kind)) continue;
    if (query.category && content.category !== query.category) continue;
    if (query.pricing) {
      const model = content.pricing.model;
      if (query.pricing === "paid" ? model === "free" : model !== query.pricing) continue;
    }
    if (query.currency && content.currency !== query.currency) continue;
    if (query.maxPriceMinor !== undefined && content.pricing.model !== "free" && content.pricing.amountMinor > query.maxPriceMinor) continue;
    const rating = ratingOf(state, listing.id);
    if (query.minRating !== undefined && (rating.average === null || rating.average < query.minRating)) continue;
    const isFavorite = state.favorites.some((fav) => fav.listingId === listing.id && viewer && fav.tenantId === viewer.tenantId && fav.userId === viewer.userId);
    if (query.favoritesOf && !state.favorites.some((fav) => fav.listingId === listing.id && fav.tenantId === query.favoritesOf?.tenantId && fav.userId === query.favoritesOf.userId)) continue;

    // every word must appear somewhere; where it appears decides the order
    const fields: [number, string[]][] = [[3, tokenize(content.name)], [2, content.tags.flatMap(tokenize)], [1, tokenize(content.summary)], [0.5, tokenize(content.description)], [1, tokenize(label("itemKind", listing.kind))]];
    let relevance = 0;
    let matchesAll = true;
    for (const token of tokens) {
      const best = Math.max(0, ...fields.map(([weight, words]) => (words.some((word) => word.startsWith(token)) ? weight : 0)));
      if (best === 0) { matchesAll = false; break; }
      relevance += best;
    }
    if (!matchesAll) continue;
    const sales = state.purchases.filter((purchase) => purchase.listingId === listing.id).length;
    items.push({ listing, rating, sales, relevance, isFavorite: Boolean(isFavorite) });
  }
  const price = (item: CatalogItem) => priceOf(item.listing.content.pricing);
  const sorters: Record<NonNullable<CatalogQuery["sort"]>, (a: CatalogItem, b: CatalogItem) => number> = {
    relevance: (a, b) => b.relevance - a.relevance || b.sales - a.sales,
    newest: (a, b) => Date.parse(b.listing.publishedAt ?? b.listing.createdAt) - Date.parse(a.listing.publishedAt ?? a.listing.createdAt),
    rating: (a, b) => (b.rating.average ?? 0) - (a.rating.average ?? 0) || b.rating.count - a.rating.count,
    priceAsc: (a, b) => price(a) - price(b),
    priceDesc: (a, b) => price(b) - price(a),
    popular: (a, b) => b.sales - a.sales,
  };
  return items.sort((a, b) => sorters[query.sort ?? (tokens.length ? "relevance" : "newest")](a, b) || a.listing.id.localeCompare(b.listing.id));
}

// ---------------------------------------------------------------- per-company views (a company never sees another's data)
export const purchasesOf = (state: MarketState, tenantId: string) => state.purchases.filter((purchase) => purchase.buyerTenantId === tenantId);
export const downloadsOf = (state: MarketState, tenantId: string) => state.downloads.filter((download) => download.buyerTenantId === tenantId);
export const listingsOf = (state: MarketState, tenantId: string) => state.listings.filter((listing) => listing.sellerTenantId === tenantId);
export const moderationQueue = (state: MarketState): Listing[] => state.listings.filter((listing) => listing.status === "pending" || (listing.status === "published" && listing.pendingRevision !== undefined));

export type SellerDashboard = {
  listings: Record<ListingStatus, number>;
  sales: number;
  activeSubscriptions: number;
  gross: Record<string, number>;
  platformFees: Record<string, number>;
  net: Record<string, number>;
  toSettle: Record<string, number>; // earned, not yet in a settlement
  settled: Record<string, number>;
  downloads: number;
  favorites: number;
  averageRating: number | null;
  reviewsToAnswer: number;
  top: { listingId: string; name: string; sales: number; netMinor: number }[];
};

export function sellerDashboard(state: MarketState, tenantId: string): SellerDashboard {
  const mine = listingsOf(state, tenantId);
  const ids = new Set(mine.map((listing) => listing.id));
  const charges = state.charges.filter((item) => item.sellerTenantId === tenantId);
  const purchases = state.purchases.filter((purchase) => ids.has(purchase.listingId));
  const reviews = state.reviews.filter((review) => ids.has(review.listingId) && !review.hidden);
  const status = (value: ListingStatus) => mine.filter((listing) => listing.status === value).length;
  return {
    listings: { draft: status("draft"), pending: status("pending"), published: status("published"), rejected: status("rejected"), suspended: status("suspended"), retired: status("retired") },
    sales: purchases.length,
    activeSubscriptions: purchases.filter((purchase) => purchase.pricing.model === "subscription" && purchase.status === "active").length,
    gross: sumByCurrency(charges.map((item) => item.gross)),
    platformFees: sumByCurrency(charges.map((item) => item.platformFee)),
    net: sumByCurrency(charges.map((item) => item.sellerNet)),
    toSettle: sumByCurrency(charges.filter((item) => item.status === "accrued").map((item) => item.sellerNet)),
    settled: sumByCurrency(charges.filter((item) => item.status === "settled").map((item) => item.sellerNet)),
    downloads: state.downloads.filter((download) => ids.has(download.listingId)).length,
    favorites: state.favorites.filter((fav) => ids.has(fav.listingId)).length,
    averageRating: reviews.length === 0 ? null : Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10,
    reviewsToAnswer: reviews.filter((review) => !review.reply).length,
    top: mine
      .map((listing) => ({ listingId: listing.id, name: listing.content.name, sales: purchases.filter((purchase) => purchase.listingId === listing.id).length, netMinor: charges.filter((item) => item.listingId === listing.id).reduce((sum, item) => sum + item.sellerNet.amountMinor, 0) }))
      .sort((a, b) => b.netMinor - a.netMinor || b.sales - a.sales)
      .slice(0, 5),
  };
}

export type AdminDashboard = {
  listingsByStatus: Record<ListingStatus, number>;
  listingsByKind: Record<ItemKind, number>;
  moderationQueue: number;
  sellers: number;
  buyers: number;
  gross: Record<string, number>; // everything bought, by currency
  commission: Record<string, number>; // what the platform keeps
  owedToSellers: Record<string, number>;
  pendingShareChanges: number;
  settlementsToDecide: number;
  settlementsToPay: number;
  hiddenReviews: number;
  defaultShareBps: number;
};

export function adminDashboard(state: MarketState): AdminDashboard {
  const count = <K extends string>(keys: readonly K[], pick: (listing: Listing) => K) => Object.fromEntries(keys.map((key) => [key, state.listings.filter((listing) => pick(listing) === key).length])) as Record<K, number>;
  return {
    listingsByStatus: count(["draft", "pending", "published", "rejected", "suspended", "retired"] as const, (listing) => listing.status),
    listingsByKind: count(ITEM_KINDS, (listing) => listing.kind),
    moderationQueue: moderationQueue(state).length,
    sellers: new Set(state.listings.map((listing) => listing.sellerTenantId)).size,
    buyers: new Set(state.purchases.map((purchase) => purchase.buyerTenantId)).size,
    gross: sumByCurrency(state.charges.map((item) => item.gross)),
    commission: sumByCurrency(state.charges.map((item) => item.platformFee)),
    owedToSellers: sumByCurrency(state.charges.filter((item) => item.status !== "settled").map((item) => item.sellerNet)),
    pendingShareChanges: state.shareChanges.filter((change) => change.status === "requested").length,
    settlementsToDecide: state.settlements.filter((item) => item.status === "requested").length,
    settlementsToPay: state.settlements.filter((item) => item.status === "approved").length,
    hiddenReviews: state.reviews.filter((review) => review.hidden).length,
    defaultShareBps: state.defaultShareBps,
  };
}
