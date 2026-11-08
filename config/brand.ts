import { BarChart3, BookOpen, Bot, Building2, Code2, Cpu, Gem, Handshake, Inbox, Receipt, Sparkles, Store, UserCog, type LucideIcon } from "lucide-react";

// The visual identity of KYNOVA and of each of its products, in one place. A brand is a name, a line that says what it is, an icon and a tone;
// the tone is one of the design-system colors, so a brand looks right in both themes and nothing here declares a color.
export type BrandTone = "primary" | "accent" | "success" | "warning";

// Written out in full so Tailwind sees every class.
export const BRAND_TONES: Record<BrandTone, { icon: string; chip: string }> = {
  primary: { icon: "text-primary-soft", chip: "bg-primary/15" },
  accent: { icon: "text-accent", chip: "bg-accent/15" },
  success: { icon: "text-success", chip: "bg-success/15" },
  warning: { icon: "text-warning", chip: "bg-warning/15" },
};

export const BRAND_KEYS = ["kynova", "nex", "koe", "academy", "marketplace", "crm", "workers", "developers", "billing", "organization", "communications", "insights", "aiStudio"] as const;
export type BrandKey = (typeof BRAND_KEYS)[number];
export type Brand = { name: string; tagline: string; tone: BrandTone; icon: LucideIcon };

export const BRANDS: Record<BrandKey, Brand> = {
  kynova: { name: "KYNOVA", tagline: "El sistema operativo de negocio con IA", tone: "accent", icon: Gem },
  nex: { name: "NEX", tagline: "El asistente de IA de su empresa", tone: "primary", icon: Bot },
  koe: { name: "KOE", tagline: "El motor que calcula, decide y gobierna", tone: "accent", icon: Cpu },
  academy: { name: "Academy", tagline: "Cursos, exámenes y certificados", tone: "warning", icon: BookOpen },
  marketplace: { name: "Marketplace", tagline: "Productos, agentes y automatizaciones", tone: "success", icon: Store },
  crm: { name: "CRM", tagline: "Prospectos, clientes y oportunidades", tone: "primary", icon: Handshake },
  workers: { name: "Workers", tagline: "Trabajadores de IA bajo gobierno de KOE", tone: "accent", icon: UserCog },
  developers: { name: "Developer Platform", tagline: "API, webhooks y sandbox", tone: "primary", icon: Code2 },
  billing: { name: "Billing", tagline: "Planes, facturas y consumo", tone: "success", icon: Receipt },
  organization: { name: "Organization", tagline: "Equipos, roles y permisos", tone: "warning", icon: Building2 },
  communications: { name: "Communications", tagline: "Todos los canales en una bandeja", tone: "primary", icon: Inbox },
  insights: { name: "Insights", tagline: "Inteligencia empresarial de una sola fuente", tone: "accent", icon: BarChart3 },
  aiStudio: { name: "AI Studio", tagline: "Prompts, agentes y pruebas", tone: "success", icon: Sparkles },
};

/** Which brand each platform screen belongs to. A screen that is not listed (integrations, payments, referrals, automations) wears the KYNOVA brand. */
export const SECTION_BRAND: Readonly<Record<string, BrandKey>> = {
  store: "marketplace",
  academy: "academy",
  workers: "workers",
  studio: "aiStudio",
  insights: "insights",
  crm: "crm",
  comms: "communications",
  org: "organization",
  billing: "billing",
  developers: "developers",
};

export const brandOfSection = (section: string): Brand => BRANDS[SECTION_BRAND[section] ?? "kynova"];
