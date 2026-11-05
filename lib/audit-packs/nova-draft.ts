import type { CatalogService } from "@/lib/contracts/audit";
import type { Treatment } from "@/lib/audit-copy";

// DRAFT of Nova Marketing Studio's offer. Nothing here is confirmed by Nova (see docs/mvp/nova/PACK-NOVA-BORRADOR.md):
// it exists so the audit experience can be demonstrated end to end. It carries no prices, deadlines or promised results.
// The final pack is client data loaded as an approved version (ADR-0006), not code.

export type ClientPack = {
  brand: string;
  isDraft: boolean;
  defaultTreatment: Treatment;
  catalog: CatalogService[];
  services: Record<string, { name: string; summary: string }>;
};

export const NOVA_DRAFT_PACK: ClientPack = {
  brand: "Nova Marketing Studio",
  isDraft: true,
  defaultTreatment: "usted",
  catalog: [
    { id: "strategy", addresses: ["analytics", "advertising", "social"], fitsInfrastructure: ["none", "partial", "established"] },
    { id: "social", addresses: ["social", "capture"], fitsInfrastructure: ["none", "partial", "established"] },
    { id: "content", addresses: ["social"], fitsInfrastructure: ["none", "partial", "established"] },
    { id: "ads", addresses: ["advertising", "capture", "analytics"], fitsInfrastructure: ["partial", "established"] },
    { id: "web", addresses: ["web", "capture"], fitsInfrastructure: ["none", "partial"] },
    { id: "seo", addresses: ["web", "capture"], fitsInfrastructure: ["partial", "established"] },
    { id: "branding", addresses: ["web", "social"], fitsInfrastructure: ["none"] },
    { id: "crm", addresses: ["followUp", "automation"], fitsInfrastructure: ["partial", "established"] },
    { id: "reporting", addresses: ["analytics"], fitsInfrastructure: ["partial", "established"] },
    { id: "ai", addresses: ["ai", "automation"], fitsInfrastructure: ["established"] },
  ],
  services: {
    strategy: { name: "Estrategia y plan de marketing digital", summary: "Un plan con prioridades, canales y metas para los próximos meses." },
    social: { name: "Gestión de redes sociales", summary: "Calendario, publicaciones y atención de las redes del negocio." },
    content: { name: "Contenido: foto, video y diseño", summary: "Piezas visuales para sostener la presencia de la marca." },
    ads: { name: "Publicidad pagada", summary: "Campañas en Meta y Google con objetivos y presupuesto definidos." },
    web: { name: "Sitio web y páginas de aterrizaje", summary: "Un sitio pensado para que el visitante contacte." },
    seo: { name: "Posicionamiento en buscadores (SEO)", summary: "Que el negocio aparezca cuando lo buscan." },
    branding: { name: "Identidad de marca", summary: "Nombre, estilo visual y mensaje coherentes." },
    crm: { name: "CRM y automatización del seguimiento", summary: "Un sistema para no dejar enfriar ninguna oportunidad." },
    reporting: { name: "Analítica y reportes", summary: "Números claros de lo que funciona y lo que no." },
    ai: { name: "Implementación de IA y asistentes", summary: "Asistentes que absorben el trabajo repetitivo." },
  },
};
