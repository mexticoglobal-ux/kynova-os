// Marketplace contracts: what can be listed, how a listing is reviewed and how revenue is split.
// No listing is installable yet; this fixes the shapes so integrations, workers and templates can be published later.

import type { Capability } from "./integrations";

export const LISTING_KINDS = ["integration", "aiWorker", "automationTemplate", "servicePack", "course"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_STATUSES = ["draft", "inReview", "published", "suspended", "retired"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

const LISTING_TRANSITIONS: Record<ListingStatus, readonly ListingStatus[]> = {
  draft: ["inReview"],
  inReview: ["draft", "published"],
  published: ["suspended", "retired"],
  suspended: ["inReview", "retired"],
  retired: [],
};
export const canTransitionListing = (from: ListingStatus, to: ListingStatus): boolean => LISTING_TRANSITIONS[from].includes(to);

export type Pricing = { model: "free" } | { model: "oneTime" | "monthly"; amountMinor: number; currency: string };

export type Listing = {
  id: string;
  kind: ListingKind;
  publisherId: string;
  name: string;
  summary: string;
  version: string;
  pricing: Pricing;
  // What installing it lets it do. Anything not declared here is denied.
  permissions: { capabilities: readonly Capability[]; readsPersonalData: boolean; writesExternally: boolean };
  privacyPolicyUrl?: string;
  supportContact?: string;
  status: ListingStatus;
};

/** Issues that block a listing from leaving review. A person still decides; this only checks the objective ones. */
export function reviewListing(listing: Listing): string[] {
  const issues: string[] = [];
  if (listing.name.trim() === "" || listing.summary.trim() === "") issues.push("name and summary are required");
  if (!/^\d+\.\d+\.\d+$/.test(listing.version)) issues.push("version must be semantic (1.2.3)");
  if (listing.pricing.model !== "free" && (!Number.isSafeInteger(listing.pricing.amountMinor) || listing.pricing.amountMinor <= 0)) issues.push("a paid listing needs a positive price in minor units");
  if (listing.permissions.readsPersonalData && !listing.privacyPolicyUrl) issues.push("reading personal data requires a privacy policy");
  if (listing.permissions.writesExternally && !listing.supportContact) issues.push("acting outside the platform requires a support contact");
  if (listing.kind === "integration" && listing.permissions.capabilities.length === 0) issues.push("an integration must declare its capabilities");
  return issues;
}

/** Splits an amount between the publisher and the platform in integer minor units. The platform share rounds down. */
export function splitRevenue(amountMinor: number, platformBasisPoints: number): { platformMinor: number; publisherMinor: number } {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("invalid amount");
  if (!Number.isInteger(platformBasisPoints) || platformBasisPoints < 0 || platformBasisPoints > 10_000) throw new Error("invalid share");
  const platformMinor = Math.floor((amountMinor * platformBasisPoints) / 10_000);
  return { platformMinor, publisherMinor: amountMinor - platformMinor };
}

export const INSTALL_STATUSES = ["requested", "approved", "active", "paused", "uninstalled"] as const;
export type InstallStatus = (typeof INSTALL_STATUSES)[number];
