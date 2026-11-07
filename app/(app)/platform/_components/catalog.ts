import { BookOpen, Blocks, CreditCard, Gift, Plug, Store, UserCog, Workflow, type LucideIcon } from "lucide-react";

// Base screens of the platform modules. Everything here is a preview of what will be connected: nothing is live.
export type PlatformSectionKey = "integrations" | "payments" | "referrals" | "store" | "academy" | "workers" | "automations";

export const PLATFORM_SECTIONS: ReadonlyArray<{ key: PlatformSectionKey; href: string; icon: LucideIcon; title: string; summary: string }> = [
  { key: "integrations", href: "/platform/integrations", icon: Plug, title: "Centro de Integraciones", summary: "Canales, pagos y calendario de la empresa, con el estado de cada conexión." },
  { key: "payments", href: "/platform/payments", icon: CreditCard, title: "Pagos", summary: "Enlaces de cobro, estados y conciliación. Cada cobro lo aprueba una persona." },
  { key: "referrals", href: "/platform/referrals", icon: Gift, title: "Referidos", summary: "Programa, atribución y recompensas con revisión antes de pagar." },
  { key: "store", href: "/platform/store", icon: Store, title: "Marketplace", summary: "Productos, servicios, cursos, agentes IA, automatizaciones y apps; toda publicación se aprueba antes de salir." },
  { key: "academy", href: "/platform/academy", icon: BookOpen, title: "Academia", summary: "Cursos, progreso y certificados para el equipo." },
  { key: "workers", href: "/platform/workers", icon: UserCog, title: "Trabajadores de NEX", summary: "Roles que NEX ejerce bajo un acuerdo de trabajo, con su nivel de autonomía a la vista." },
  { key: "automations", href: "/platform/automations", icon: Workflow, title: "Centro de Automatizaciones", summary: "Disparador, condiciones y acciones; todo nace en modo de prueba." },
];

export const PLATFORM_HUB = { icon: Blocks, title: "Plataforma", summary: "Base de lo que se conectará después de validar el Backend Core. Hoy es solo arquitectura y vistas: no hay conexiones reales." };

export function sectionInfo(key: PlatformSectionKey) {
  const info = PLATFORM_SECTIONS.find((item) => item.key === key);
  if (!info) throw new Error(`unknown platform section: ${key}`);
  return info;
}
