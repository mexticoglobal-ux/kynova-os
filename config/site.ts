export const site = {
  name: "KYNOVA",
  product: "KYNOVA OS",
  ai: "NEX",
  url: "https://kynova.ai",
  themeColor: "#0F161A",
};

export const MODULE_KEYS = [
  "sales",
  "marketing",
  "clients",
  "properties",
  "automation",
  "finance",
  "analytics",
  "settings",
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export type AppNavKey = "dashboard" | "nex" | ModuleKey | "platform";

// Single source of navigation (rule ui.md). Labels come from the i18n `nav` dictionary.
export const appNav: ReadonlyArray<{ key: AppNavKey; href: string }> = [
  { key: "dashboard", href: "/dashboard" },
  { key: "nex", href: "/nex" },
  ...MODULE_KEYS.map((key) => ({ key, href: `/${key}` })),
  { key: "platform", href: "/platform" },
];

export type PublicNavKey = "pricing" | "academy" | "marketplace" | "docs";

export const publicNav: ReadonlyArray<{ key: PublicNavKey; href: string }> = [
  { key: "pricing", href: "/pricing" },
  { key: "academy", href: "/academy" },
  { key: "marketplace", href: "/marketplace" },
  { key: "docs", href: "/docs" },
];
