import { BarChart3, BookOpen, Blocks, Building2, CreditCard, Gift, Handshake, Inbox, Plug, Receipt, Sparkles, Store, UserCog, Workflow, type LucideIcon } from "lucide-react";

// Base screens of the platform modules. Everything here is a preview of what will be connected: nothing is live.
export type PlatformSectionKey = "integrations" | "payments" | "referrals" | "store" | "academy" | "workers" | "automations" | "studio" | "insights" | "crm" | "comms" | "org" | "billing";

export const PLATFORM_SECTIONS: ReadonlyArray<{ key: PlatformSectionKey; href: string; icon: LucideIcon; title: string; summary: string }> = [
  { key: "integrations", href: "/platform/integrations", icon: Plug, title: "Centro de Integraciones", summary: "Canales, pagos y calendario de la empresa, con el estado de cada conexión." },
  { key: "payments", href: "/platform/payments", icon: CreditCard, title: "Pagos", summary: "Enlaces de cobro, estados y conciliación. Cada cobro lo aprueba una persona." },
  { key: "referrals", href: "/platform/referrals", icon: Gift, title: "Referidos", summary: "Programa, atribución y recompensas con revisión antes de pagar." },
  { key: "store", href: "/platform/store", icon: Store, title: "Marketplace", summary: "Productos, servicios, cursos, agentes IA, automatizaciones y apps; toda publicación se aprueba antes de salir." },
  { key: "academy", href: "/platform/academy", icon: BookOpen, title: "Academia", summary: "Cursos de su empresa y oficiales, exámenes, certificados, venta en el Marketplace y NEX como tutor." },
  { key: "workers", href: "/platform/workers", icon: UserCog, title: "NEX Workers", summary: "Trabajadores especializados que colaboran bajo KOE: autonomía por la Constitución, herramientas, memoria, auditoría y varios modelos de IA." },
  { key: "automations", href: "/platform/automations", icon: Workflow, title: "Centro de Automatizaciones", summary: "Disparador, condiciones y acciones; todo nace en modo de prueba." },
  { key: "studio", href: "/platform/studio", icon: Sparkles, title: "AI Studio", summary: "Prompts, agentes IA, versiones y pruebas. Todo pasa por KOE; NEX deja borradores y publicar lo aprueba una persona." },
  { key: "insights", href: "/platform/insights", icon: BarChart3, title: "Insights", summary: "Inteligencia empresarial: ROI, productividad, IA, clientes y KOE, con cifras de una sola fuente de verdad." },
  { key: "crm", href: "/platform/crm", icon: Handshake, title: "CRM inteligente", summary: "Pipeline, oportunidades, tareas propuestas por NEX y Cliente 360. KOE recomienda; una persona decide y cierra." },
  { key: "comms", href: "/platform/comms", icon: Inbox, title: "Comunicaciones", summary: "Una bandeja para todos los canales. KOE entiende y enruta, NEX prepara borradores y nunca envía; una persona decide." },
  { key: "org", href: "/platform/org", icon: Building2, title: "Organización e identidad", summary: "La estructura completa de la empresa: sucursales, equipos, personas y Workers IA, roles y permisos. KOE recomienda; una persona decide." },
  { key: "billing", href: "/platform/billing", icon: Receipt, title: "Facturación y suscripciones", summary: "Plan, límites, add-ons, facturas, consumo de IA, forecast y ROI. KOE calcula y recomienda; una persona decide y nunca se cobra sola." },
];

export const PLATFORM_HUB = { icon: Blocks, title: "Plataforma", summary: "Base de lo que se conectará después de validar el Backend Core. Hoy es solo arquitectura y vistas: no hay conexiones reales." };

export function sectionInfo(key: PlatformSectionKey) {
  const info = PLATFORM_SECTIONS.find((item) => item.key === key);
  if (!info) throw new Error(`unknown platform section: ${key}`);
  return info;
}
