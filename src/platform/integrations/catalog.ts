import type { ConnectorDef } from "./domain";

/** The connectors defined today. None has an adapter yet, so all of them are honestly "coming soon". */
export const CONNECTORS: readonly ConnectorDef[] = [
  { key: "google_business", name: "Google Business Profile", kind: "search", capabilities: ["read_listing", "read_reviews", "read_insights"], fields: ["locationId"], available: false },
  { key: "ga4", name: "Google Analytics 4", kind: "analytics", capabilities: ["read_metrics", "read_audiences"], fields: ["propertyId"], available: false },
  { key: "search_console", name: "Google Search Console", kind: "search", capabilities: ["read_queries", "read_pages", "read_indexing"], fields: ["siteUrl"], available: false },
  { key: "meta_business", name: "Meta Business", kind: "social", capabilities: ["read_ads", "read_insights"], fields: ["businessId"], available: false },
  { key: "facebook_pages", name: "Facebook Pages", kind: "social", capabilities: ["read_posts", "read_insights"], fields: ["pageId"], available: false },
  { key: "instagram_business", name: "Instagram Business", kind: "social", capabilities: ["read_posts", "read_insights"], fields: ["accountId"], available: false },
  { key: "google_calendar", name: "Google Calendar", kind: "productivity", capabilities: ["read_events"], fields: ["calendarId"], available: false },
  { key: "google_workspace", name: "Gmail / Google Workspace", kind: "productivity", capabilities: ["read_mail_metadata"], fields: ["domain"], available: false },
  { key: "shopify", name: "Shopify", kind: "commerce", capabilities: ["read_orders", "read_products", "read_customers"], fields: ["shopDomain"], available: false },
  { key: "cloudflare", name: "Cloudflare", kind: "infrastructure", capabilities: ["read_zone", "read_analytics"], fields: ["zoneId"], available: false },
  { key: "makawallet", name: "MakaWallet", kind: "payments", capabilities: ["read_balance", "read_transactions"], fields: ["walletId"], available: false },
];
