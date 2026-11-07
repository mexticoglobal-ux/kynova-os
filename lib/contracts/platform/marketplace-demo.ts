// Sample data for the local simulation of the Marketplace. Fictional companies, people and amounts. It is built by applying
// events through the same reducer a real adapter will use, so loading it also proves the rules hold together.

import { newMarketState, reduceMarket, type ItemKind, type ListingContent, type MarketEvent, type MarketState } from "./marketplace-center";

export const PLATFORM_TENANT = "tenant-kynova";
export const DEMO_ADMINS = ["admin:ana", "admin:bruno"] as const;

export const DEMO_TENANTS = [
  { id: "tenant-nova", name: "Nova Marketing Studio" },
  { id: "tenant-vida", name: "Clínica Vida" },
  { id: "tenant-mar", name: "Hotel Mar" },
  { id: PLATFORM_TENANT, name: "KYNOVA (plataforma)" },
] as const;

// Who the simulation can act as. "worker:nex" is NEX: it may prepare a draft and nothing else.
export const DEMO_PERSONAS = [
  { id: "nova-ana", label: "Nova · Ana (vende y compra)", tenantId: "tenant-nova", actor: "ana" },
  { id: "vida-lucia", label: "Clínica Vida · Lucía", tenantId: "tenant-vida", actor: "lucia" },
  { id: "mar-marco", label: "Hotel Mar · Marco", tenantId: "tenant-mar", actor: "marco" },
  { id: "admin-ana", label: "Administración · Ana", tenantId: PLATFORM_TENANT, actor: "admin:ana" },
  { id: "admin-bruno", label: "Administración · Bruno", tenantId: PLATFORM_TENANT, actor: "admin:bruno" },
  { id: "nex", label: "NEX (IA) en Nova", tenantId: "tenant-nova", actor: "worker:nex" },
] as const;

export const baseContent = (over: Partial<ListingContent> = {}): ListingContent => ({
  name: "Plantilla de ejemplo",
  summary: "Un resumen breve de lo que ofrece.",
  description: "Descripción completa de lo que incluye, para quién es y cómo se usa.",
  category: "marketing",
  tags: [],
  version: "1.0.0",
  pricing: { model: "free" },
  currency: "USD",
  permissions: { capabilities: [], readsPersonalData: false, writesExternally: false },
  ...over,
});

const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T10:00:00.000Z`;

export function demoMarketState(): { state: MarketState; errors: string[] } {
  const errors: string[] = [];
  let state = newMarketState(DEMO_ADMINS);
  const send = (event: MarketEvent) => {
    const result = reduceMarket(state, event);
    if (result.error) errors.push(`${event.type}: ${result.error}`);
    state = result.state;
  };
  const listing = (name: string) => state.listings.find((item) => item.content.name === name)?.id ?? "";
  const purchase = (tenantId: string, name: string) => state.purchases.find((item) => item.buyerTenantId === tenantId && item.listingId === listing(name))?.id ?? "";
  const nova = { tenantId: "tenant-nova", actor: "ana" };
  const vida = { tenantId: "tenant-vida", actor: "lucia" };
  const mar = { tenantId: "tenant-mar", actor: "marco" };
  const adminAna = { tenantId: PLATFORM_TENANT, actor: "admin:ana" };
  const adminBruno = { tenantId: PLATFORM_TENANT, actor: "admin:bruno" };

  // Sellers create and submit; a different administrator approves each one.
  const publish = (seller: { tenantId: string; actor: string }, kind: ItemKind, content: ListingContent, at: number) => {
    send({ ...seller, at: day(at), type: "listing.create", kind, content });
    const id = state.listings.at(-1)?.id ?? "";
    send({ ...seller, at: day(at), type: "listing.submit", listingId: id });
    return id;
  };
  const approve = (id: string, at: number) => send({ ...adminAna, at: day(at), type: "moderation.decide", listingId: id, approve: true });

  const course = publish(nova, "course", baseContent({ name: "Marketing para clínicas", summary: "Curso práctico para atraer pacientes.", category: "education", tags: ["clínicas", "pacientes", "marketing"], pricing: { model: "oneTime", amountMinor: 4_900 }, deliverable: { fileName: "curso-marketing-clinicas.zip", sizeBytes: 48_000_000 } }), 1);
  const agent = publish(nova, "aiAgent", baseContent({ name: "Asistente de seguimiento", summary: "Prepara y recuerda el seguimiento de cada prospecto.", category: "sales", tags: ["seguimiento", "ventas", "ia"], pricing: { model: "subscription", amountMinor: 2_900, interval: "month" }, permissions: { capabilities: ["receiveMessages", "sendMessages"], readsPersonalData: true, writesExternally: true }, privacyPolicyUrl: "https://nova.example/privacidad", supportContact: "soporte@nova.example" }), 1);
  const templates = publish(vida, "digitalResource", baseContent({ name: "Plantillas de WhatsApp", summary: "Mensajes listos para citas y recordatorios.", category: "support", tags: ["whatsapp", "mensajes", "citas"], pricing: { model: "free" }, deliverable: { fileName: "plantillas-whatsapp.pdf", sizeBytes: 900_000 } }), 2);
  const app = publish(mar, "app", baseContent({ name: "Reservas rápidas", summary: "Reservas y calendario para hoteles pequeños.", category: "operations", tags: ["reservas", "calendario", "hoteles"], pricing: { model: "subscription", amountMinor: 12_000, interval: "year" }, permissions: { capabilities: ["readCalendar", "writeCalendar"], readsPersonalData: true, writesExternally: true }, privacyPolicyUrl: "https://mar.example/privacidad", supportContact: "ayuda@mar.example" }), 2);
  for (const id of [course, agent, templates, app]) approve(id, 3);

  // A service waiting in the moderation queue, and a draft prepared by NEX (Level 1) that nobody has submitted yet.
  publish(vida, "service", baseContent({ name: "Auditoría comercial", summary: "Revisión de su proceso de ventas en una semana.", category: "sales", tags: ["auditoría", "ventas"], pricing: { model: "oneTime", amountMinor: 25_000 } }), 4);
  send({ tenantId: "tenant-nova", actor: "worker:nex", at: day(4), type: "listing.create", kind: "automation", content: baseContent({ name: "Aviso de prospecto caliente", summary: "Avisa al equipo cuando un prospecto sube de nivel.", category: "sales", tags: ["automatización"], pricing: { model: "oneTime", amountMinor: 1_500 }, permissions: { capabilities: ["receiveMessages"], readsPersonalData: false, writesExternally: false }, deliverable: { fileName: "aviso-caliente.json", sizeBytes: 12_000 } }) });

  // Buying (simulated), downloading, favoriting and reviewing.
  send({ ...vida, at: day(5), type: "purchase.create", listingId: course });
  send({ ...mar, at: day(5), type: "purchase.create", listingId: course });
  send({ ...vida, at: day(8), type: "purchase.create", listingId: agent });
  send({ ...nova, at: day(5), type: "purchase.create", listingId: app });
  send({ ...mar, at: day(6), type: "purchase.create", listingId: templates });
  send({ ...nova, at: day(6), type: "purchase.create", listingId: templates });
  send({ ...vida, at: day(6), type: "download.record", purchaseId: purchase("tenant-vida", "Marketing para clínicas") });
  send({ ...vida, at: day(7), type: "download.record", purchaseId: purchase("tenant-vida", "Marketing para clínicas") });
  send({ ...mar, at: day(6), type: "download.record", purchaseId: purchase("tenant-mar", "Plantillas de WhatsApp") });
  send({ ...vida, at: day(7), type: "favorite.toggle", listingId: app });
  send({ ...mar, at: day(7), type: "favorite.toggle", listingId: agent });
  send({ ...vida, at: day(9), type: "review.submit", purchaseId: purchase("tenant-vida", "Marketing para clínicas"), rating: 5, body: "Muy práctico: aplicamos el primer módulo la misma semana." });
  send({ ...mar, at: day(9), type: "review.submit", purchaseId: purchase("tenant-mar", "Marketing para clínicas"), rating: 4, body: "Buen contenido, le faltan ejemplos de hoteles." });
  send({ ...nova, at: day(9), type: "review.reply", reviewId: state.reviews.find((review) => review.buyerTenantId === "tenant-mar")?.id ?? "", text: "Gracias: agregaremos casos de hoteles en la próxima versión." });
  send({ ...nova, at: day(9), type: "review.submit", purchaseId: purchase("tenant-nova", "Reservas rápidas"), rating: 1, body: "COMPRE AHORA ofertas en un sitio dudoso" });
  send({ ...adminBruno, at: day(10), type: "review.hide", reviewId: state.reviews.at(-1)?.id ?? "", reason: "Spam" });

  // Settling Nova's earnings: one admin requests, the other approves, and the payment is recorded with an outside reference.
  send({ ...adminAna, at: day(12), type: "settlement.request", sellerTenantId: "tenant-nova", currency: "USD" });
  const novaSettlement = state.settlements.at(-1)?.id ?? "";
  send({ ...adminBruno, at: day(13), type: "settlement.decide", settlementId: novaSettlement, approve: true });
  send({ ...adminBruno, at: day(14), type: "settlement.markPaid", settlementId: novaSettlement, paymentRef: "TRANSFERENCIA-M-0001" });

  // Revenue share is Level 3: Ana proposes a lower share for the agent, Bruno approves; it only affects later charges.
  send({ ...adminAna, at: day(15), type: "share.request", scope: { type: "listing", listingId: agent }, toBps: 1_000, reason: "Plan de lanzamiento para vendedores nuevos" });
  send({ ...adminBruno, at: day(16), type: "share.decide", changeId: state.shareChanges.at(-1)?.id ?? "", approve: true });
  send({ ...adminAna, at: day(17), type: "share.request", scope: { type: "default" }, toBps: 2_000, reason: "Cubrir costos de moderación" }); // left waiting for a second admin
  send({ tenantId: PLATFORM_TENANT, actor: "system", at: "2026-11-09T10:00:00.000Z", type: "purchase.renew", purchaseId: purchase("tenant-vida", "Asistente de seguimiento") }); // the monthly renewal, now at the new 10 % share
  // Hotel Mar's earnings wait for a decision.
  send({ ...adminAna, at: day(18), type: "settlement.request", sellerTenantId: "tenant-mar", currency: "USD" });
  return { state, errors };
}

export const demoOk = (): MarketState => {
  const { state, errors } = demoMarketState();
  if (errors.length) throw new Error(errors.join("; "));
  return state;
};

