// The first segment of every screen that needs a signed-in user when a Supabase project is configured.
// A literal array so Next.js can read it for the middleware matcher at build time.
export const APP_PATHS = ["dashboard", "nex", "sales", "marketing", "clients", "properties", "automation", "finance", "analytics", "settings", "platform", "onboarding"];

// A same-site path to return to after signing in. Anything else (other sites, protocol-relative URLs) becomes /dashboard.
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/dashboard";
  const first = value.split("/")[1]?.split("?")[0] ?? "";
  return APP_PATHS.includes(first) && first !== "onboarding" ? value : "/dashboard";
}

export const TENANT_COOKIE = "kynova_tenant";
