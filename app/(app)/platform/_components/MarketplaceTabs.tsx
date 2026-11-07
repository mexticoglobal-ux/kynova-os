"use client";

import { useState, type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { CURRENCY_CODES, formatMinor, isCrypto, parseMajor, type CurrencyCode } from "@/lib/contracts/platform/currency";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import type { ratingOf} from "@/lib/contracts/platform/marketplace-center";
import {
  CATEGORIES, ITEM_KINDS, adminDashboard, moderationQueue, objectiveIssues, purchasesOf, searchCatalog, sellerDashboard,
  type Category, type CatalogQuery, type ItemKind, type Listing, type ListingContent, type ListingStatus, type MarketPricing,
} from "@/lib/contracts/platform/marketplace-center";
import { label } from "@/lib/contracts/platform/marketplace-messages";
import type { MarketTabProps } from "./MarketplaceCenter";

const input = "w-full rounded-xl border border-line bg-raised px-3 py-2 text-sm";
const STATUS_TONE: Record<ListingStatus, BadgeTone> = { draft: "neutral", pending: "warning", published: "success", rejected: "danger", suspended: "danger", retired: "neutral" };
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "—");
const money = (minor: number, currency: string) => formatMinor({ amountMinor: minor, currency });

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-ink-muted">{name}</span>
      {children}
    </label>
  );
}
const Empty = ({ title, children }: { title: string; children?: string }) => <EmptyState icon={Inbox} title={title}>{children}</EmptyState>;
const AdminOnly = () => <Empty title="Solo administración">Elija una persona de la administración en «Actuar como».</Empty>;

function priceLabel(content: ListingContent): string {
  const { pricing, currency } = content;
  if (pricing.model === "free") return label("pricingModel", "free");
  const amount = money(pricing.amountMinor, currency);
  return pricing.model === "oneTime" ? amount : `${amount}/${pricing.interval === "month" ? "mes" : "año"}`;
}
function MoneyMap({ amounts }: { amounts: Record<string, number> }) {
  const entries = Object.entries(amounts);
  return entries.length === 0 ? <p className="text-xl font-semibold">—</p> : <ul>{entries.map(([currency, minor]) => <li key={currency} className="text-xl font-semibold">{money(minor, currency)}</li>)}</ul>;
}
const Stars = ({ rating }: { rating: ReturnType<typeof ratingOf> }) => <span className="text-xs text-ink-muted">{rating.average === null ? "Sin reseñas" : `★ ${rating.average} (${rating.count})`}</span>;

// ---------------------------------------------------------------- catalog, categories, search, filters
export function CatalogTab({ state, send, persona }: MarketTabProps) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<ItemKind | "">("");
  const [category, setCategory] = useState<Category | "">("");
  const [pricing, setPricing] = useState<NonNullable<CatalogQuery["pricing"]> | "">("");
  const [sort, setSort] = useState<NonNullable<CatalogQuery["sort"]>>("relevance");
  const [minRating, setMinRating] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const viewer = { tenantId: persona.tenantId, userId: persona.actor };
  const query: CatalogQuery = { text, kinds: kind ? [kind] : undefined, category: category || undefined, pricing: pricing || undefined, minRating: minRating ? Number(minRating) : undefined, sort };
  const items = searchCatalog(state, query, viewer);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Field name="Buscar"><input aria-label="Buscar" className={input} value={text} onChange={(event) => setText(event.target.value)} placeholder="curso, agente, plantilla…" /></Field>
          <Field name="Tipo"><select aria-label="Tipo" className={input} value={kind} onChange={(event) => setKind(event.target.value as ItemKind | "")}><option value="">Todos</option>{ITEM_KINDS.map((item) => <option key={item} value={item}>{label("itemKind", item)}</option>)}</select></Field>
          <Field name="Categoría"><select aria-label="Categoría" className={input} value={category} onChange={(event) => setCategory(event.target.value as Category | "")}><option value="">Todas</option>{CATEGORIES.map((item) => <option key={item} value={item}>{label("category", item)}</option>)}</select></Field>
          <Field name="Precio"><select aria-label="Precio" className={input} value={pricing} onChange={(event) => setPricing(event.target.value as typeof pricing)}><option value="">Cualquiera</option><option value="free">Gratis</option><option value="paid">De pago</option><option value="oneTime">Precio único</option><option value="subscription">Suscripción</option></select></Field>
          <Field name="Calificación mínima"><select aria-label="Calificación mínima" className={input} value={minRating} onChange={(event) => setMinRating(event.target.value)}><option value="">Cualquiera</option><option value="4">4 o más</option><option value="3">3 o más</option></select></Field>
          <Field name="Ordenar"><select aria-label="Ordenar" className={input} value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>{(["relevance", "newest", "rating", "popular", "priceAsc", "priceDesc"] as const).map((item) => <option key={item} value={item}>{label("sort", item)}</option>)}</select></Field>
        </div>
        <p className="text-xs text-ink-muted">{items.length} resultados</p>
      </Card>
      {items.length === 0 ? <Empty title="Sin resultados">Pruebe con otras palabras o quite algún filtro.</Empty> : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map(({ listing, rating, sales, isFavorite }) => (
            <Card as="li" key={listing.id} className="space-y-2 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge tone="primary">{label("itemKind", listing.kind)}</Badge>
                <Badge>{label("category", listing.content.category)}</Badge>
              </div>
              <h2 className="font-semibold">{listing.content.name}</h2>
              <p className="text-sm text-ink-muted">{listing.content.summary}</p>
              <p className="text-sm font-medium">{priceLabel(listing.content)}</p>
              <div className="flex items-center justify-between"><Stars rating={rating} /><span className="text-xs text-ink-muted">{sales} ventas</span></div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={selected === listing.id ? "primary" : "secondary"} onClick={() => setSelected(selected === listing.id ? null : listing.id)}>{selected === listing.id ? "Cerrar" : "Ver detalle"}</Button>
                <Button size="sm" variant="ghost" onClick={() => send({ type: "favorite.toggle", listingId: listing.id })}>{isFavorite ? "Quitar de favoritos" : "Guardar en favoritos"}</Button>
              </div>
            </Card>
          ))}
        </ul>
      )}
      {selected && <Detail id={selected} state={state} send={send} persona={persona} />}
    </div>
  );
}

function Detail({ id, state, send, persona }: { id: string; state: MarketTabProps["state"]; send: MarketTabProps["send"]; persona: MarketTabProps["persona"] }) {
  const listing = state.listings.find((item) => item.id === id);
  const purchase = state.purchases.find((item) => item.listingId === id && item.buyerTenantId === persona.tenantId && item.status === "active");
  const reviews = state.reviews.filter((review) => review.listingId === id && !review.hidden);
  if (!listing) return null;
  const { content } = listing;
  const buyLabel = content.pricing.model === "free" ? "Obtener gratis" : content.pricing.model === "oneTime" ? "Comprar (simulado)" : "Suscribirse (simulado)";
  return (
    <Card as="section" aria-label={`Detalle de ${content.name}`} className="space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{content.name}</h2>
        <Badge tone="success">{priceLabel(content)}</Badge>
      </div>
      <p className="text-sm text-ink-muted">{content.description}</p>
      <p className="text-xs text-ink-muted">Versión {content.version} · {label("itemKind", listing.kind)} · {label("category", content.category)}{content.tags.length ? ` · ${content.tags.join(", ")}` : ""}</p>
      <div className="flex flex-wrap gap-1.5">
        {content.permissions.capabilities.map((capability) => <Badge key={capability} tone="accent">{capability}</Badge>)}
        {content.permissions.readsPersonalData && <Badge tone="warning">Lee datos personales</Badge>}
        {content.permissions.writesExternally && <Badge tone="danger">Actúa fuera de la plataforma</Badge>}
        {content.permissions.capabilities.length === 0 && <Badge>Sin permisos especiales</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        {purchase ? (
          <>
            <Badge tone="success">Ya lo tiene</Badge>
            {content.deliverable && <Button size="sm" variant="secondary" onClick={() => send({ type: "download.record", purchaseId: purchase.id })}>Descargar {content.deliverable.fileName}</Button>}
          </>
        ) : (
          <Button size="sm" variant="primary" onClick={() => send({ type: "purchase.create", listingId: id })}>{buyLabel}</Button>
        )}
      </div>
      <h3 className="text-sm font-semibold">Reseñas ({reviews.length})</h3>
      {reviews.length === 0 ? <p className="text-xs text-ink-muted">Todavía no hay reseñas.</p> : (
        <ul className="space-y-2 text-sm">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-xl bg-raised px-3 py-2">
              <p className="font-medium">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)} <span className="text-xs text-ink-muted">· {review.user}</span></p>
              {review.body && <p className="text-ink-muted">{review.body}</p>}
              {review.reply && <p className="mt-1 text-xs text-ink-muted">Respuesta del vendedor: {review.reply.text}</p>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- purchases, downloads and reviews
export function PurchasesTab({ state, send, persona }: MarketTabProps) {
  const mine = purchasesOf(state, persona.tenantId);
  const [drafts, setDrafts] = useState<Record<string, { rating: string; body: string }>>({});
  if (mine.length === 0) return <Empty title="Sin compras">Lo que compre o descargue aparece aquí, solo para su empresa.</Empty>;
  return (
    <ul className="space-y-3">
      {[...mine].reverse().map((purchase) => {
        const listing = state.listings.find((item) => item.id === purchase.listingId);
        const review = state.reviews.find((item) => item.purchaseId === purchase.id);
        const draft = drafts[purchase.id] ?? { rating: "5", body: "" };
        const downloads = state.downloads.filter((item) => item.purchaseId === purchase.id).length;
        return (
          <Card as="li" key={purchase.id} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium">{listing?.content.name ?? purchase.listingId} · {label("pricingModel", purchase.pricing.model)}</p>
              <Badge tone={purchase.status === "active" ? "success" : "neutral"}>{label("purchaseStatus", purchase.status)}</Badge>
            </div>
            <p className="text-xs text-ink-muted">Comprado {day(purchase.createdAt)} · {downloads} descargas{purchase.nextRenewalAt ? ` · renueva ${day(purchase.nextRenewalAt)}` : ""}</p>
            <div className="flex flex-wrap gap-2">
              {listing?.content.deliverable && <Button size="sm" variant="secondary" onClick={() => send({ type: "download.record", purchaseId: purchase.id })}>Descargar</Button>}
              {purchase.pricing.model === "subscription" && purchase.status === "active" && <Button size="sm" variant="ghost" onClick={() => send({ type: "purchase.renew", purchaseId: purchase.id, at: purchase.nextRenewalAt })}>Simular renovación</Button>}
              {purchase.pricing.model !== "oneTime" && purchase.status === "active" && <Button size="sm" variant="ghost" onClick={() => send({ type: "purchase.cancel", purchaseId: purchase.id })}>Cancelar</Button>}
            </div>
            {review ? <p className="text-xs text-ink-muted">Su reseña: {"★".repeat(review.rating)}{review.hidden ? " (oculta por moderación)" : ""}</p> : (
              <div className="grid gap-2 sm:grid-cols-4">
                <select aria-label={`Calificación de ${purchase.id}`} className={input} value={draft.rating} onChange={(event) => setDrafts({ ...drafts, [purchase.id]: { ...draft, rating: event.target.value } })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} estrellas</option>)}</select>
                <input aria-label={`Reseña de ${purchase.id}`} className={`${input} sm:col-span-2`} placeholder="Cuente su experiencia" value={draft.body} onChange={(event) => setDrafts({ ...drafts, [purchase.id]: { ...draft, body: event.target.value } })} />
                <Button size="sm" variant="secondary" onClick={() => send({ type: "review.submit", purchaseId: purchase.id, rating: Number(draft.rating), body: draft.body })}>Publicar reseña</Button>
              </div>
            )}
          </Card>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------- favorites
export function FavoritesTab({ state, send, persona }: MarketTabProps) {
  const viewer = { tenantId: persona.tenantId, userId: persona.actor };
  const items = searchCatalog(state, { favoritesOf: viewer }, viewer);
  if (items.length === 0) return <Empty title="Sin favoritos">Guarde publicaciones desde el catálogo para encontrarlas aquí.</Empty>;
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map(({ listing, rating }) => (
        <Card as="li" key={listing.id} className="space-y-2 p-5">
          <h2 className="font-semibold">{listing.content.name}</h2>
          <p className="text-sm text-ink-muted">{priceLabel(listing.content)} · <Stars rating={rating} /></p>
          <Button size="sm" variant="ghost" onClick={() => send({ type: "favorite.toggle", listingId: listing.id })}>Quitar de favoritos</Button>
        </Card>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- seller dashboard and listings
const PRESETS = {
  none: { label: "Sin permisos especiales", capabilities: [], reads: false, writes: false },
  read: { label: "Lee mensajes", capabilities: ["receiveMessages"], reads: true, writes: false },
  send: { label: "Lee y envía mensajes (actúa fuera)", capabilities: ["receiveMessages", "sendMessages"], reads: true, writes: true },
  calendar: { label: "Lee y escribe el calendario (actúa fuera)", capabilities: ["readCalendar", "writeCalendar"], reads: true, writes: true },
} as const;

export function SellTab({ state, send, persona }: MarketTabProps) {
  const dash = sellerDashboard(state, persona.tenantId);
  const mine = state.listings.filter((listing) => listing.sellerTenantId === persona.tenantId);
  const [kind, setKind] = useState<ItemKind>("digitalResource");
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<Category>("marketing");
  const [model, setModel] = useState<MarketPricing["model"]>("free");
  const [amount, setAmount] = useState("");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [currency, setCurrency] = useState<CurrencyCode>("USD");
  const [tags, setTags] = useState("");
  const [file, setFile] = useState("");
  const [preset, setPreset] = useState<keyof typeof PRESETS>("none");
  const [privacy, setPrivacy] = useState("");
  const [support, setSupport] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [newPrice, setNewPrice] = useState<Record<string, string>>({});
  const [replies, setReplies] = useState<Record<string, string>>({});

  const create = () => {
    const minor = model === "free" ? 0 : parseMajor(amount, currency);
    if (minor === null) return setFormError("Precio inválido: solo números y los decimales de la moneda.");
    setFormError(null);
    const pricing: MarketPricing = model === "free" ? { model: "free" } : model === "oneTime" ? { model, amountMinor: minor } : { model, amountMinor: minor, interval };
    const chosen = PRESETS[preset];
    send({ type: "listing.create", kind, content: {
      name, summary, description, category, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), version: "1.0.0", pricing, currency,
      permissions: { capabilities: chosen.capabilities, readsPersonalData: chosen.reads, writesExternally: chosen.writes },
      privacyPolicyUrl: privacy.trim() || undefined, supportContact: support.trim() || undefined, deliverable: file.trim() ? { fileName: file.trim(), sizeBytes: 1_000_000 } : undefined,
    } });
  };
  const toAnswer = state.reviews.filter((review) => !review.hidden && !review.reply && mine.some((listing) => listing.id === review.listingId));

  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[["Ingresos brutos", dash.gross], ["Comisión de la plataforma", dash.platformFees], ["Neto para usted", dash.net], ["Por liquidar", dash.toSettle]].map(([title, amounts]) => (
          <Card as="li" key={title as string} className="space-y-1 p-5"><h2 className="text-sm text-ink-muted">{title as string}</h2><MoneyMap amounts={amounts as Record<string, number>} /></Card>
        ))}
      </ul>
      <Card className="flex flex-wrap gap-2 p-5">
        <Badge tone="success">{dash.listings.published} publicadas</Badge>
        <Badge tone={dash.listings.pending ? "warning" : "neutral"}>{dash.listings.pending} en revisión</Badge>
        <Badge>{dash.listings.draft} borradores</Badge>
        <Badge>{dash.sales} ventas</Badge>
        <Badge>{dash.activeSubscriptions} suscripciones activas</Badge>
        <Badge>{dash.downloads} descargas</Badge>
        <Badge>{dash.favorites} favoritos</Badge>
        <Badge>{dash.averageRating === null ? "Sin calificación" : `★ ${dash.averageRating}`}</Badge>
        <Badge tone={dash.reviewsToAnswer ? "warning" : "neutral"}>{dash.reviewsToAnswer} reseñas por responder</Badge>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Nueva publicación</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="Tipo"><select aria-label="Tipo de publicación" className={input} value={kind} onChange={(event) => setKind(event.target.value as ItemKind)}>{ITEM_KINDS.map((item) => <option key={item} value={item}>{label("itemKind", item)}</option>)}</select></Field>
          <Field name="Nombre"><input aria-label="Nombre de la publicación" className={input} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field name="Categoría"><select aria-label="Categoría de la publicación" className={input} value={category} onChange={(event) => setCategory(event.target.value as Category)}>{CATEGORIES.map((item) => <option key={item} value={item}>{label("category", item)}</option>)}</select></Field>
          <Field name="Resumen"><input aria-label="Resumen" className={input} value={summary} onChange={(event) => setSummary(event.target.value)} /></Field>
          <Field name="Descripción"><input aria-label="Descripción" className={input} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <Field name="Etiquetas (separadas por comas)"><input aria-label="Etiquetas" className={input} value={tags} onChange={(event) => setTags(event.target.value)} /></Field>
          <Field name="Precio"><select aria-label="Modelo de precio" className={input} value={model} onChange={(event) => setModel(event.target.value as MarketPricing["model"])}><option value="free">Gratis</option><option value="oneTime">Precio único</option><option value="subscription">Suscripción</option></select></Field>
          <Field name="Importe"><input aria-label="Importe" className={input} inputMode="decimal" disabled={model === "free"} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field name="Moneda"><select aria-label="Moneda de la publicación" className={input} value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>{CURRENCY_CODES.filter((code) => !isCrypto(code)).map((code) => <option key={code} value={code}>{code}</option>)}</select></Field>
          {model === "subscription" && <Field name="Periodo"><select aria-label="Periodo de la suscripción" className={input} value={interval} onChange={(event) => setInterval(event.target.value as "month" | "year")}><option value="month">Mensual</option><option value="year">Anual</option></select></Field>}
          <Field name="Archivo para descargar (opcional)"><input aria-label="Archivo" className={input} value={file} onChange={(event) => setFile(event.target.value)} /></Field>
          <Field name="Permisos que declara"><select aria-label="Permisos" className={input} value={preset} onChange={(event) => setPreset(event.target.value as keyof typeof PRESETS)}>{Object.entries(PRESETS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></Field>
          <Field name="Política de privacidad (https)"><input aria-label="Política de privacidad" className={input} value={privacy} onChange={(event) => setPrivacy(event.target.value)} /></Field>
          <Field name="Contacto de soporte"><input aria-label="Contacto de soporte" className={input} value={support} onChange={(event) => setSupport(event.target.value)} /></Field>
        </div>
        {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
        <Button size="sm" variant="primary" onClick={create}>Crear borrador</Button>
        <p className="text-xs text-ink-muted">Nada se publica solo: el borrador se envía a revisión y lo aprueba una persona de la administración.</p>
      </Card>

      {mine.length === 0 ? <Empty title="Sin publicaciones">Cree la primera: libre, de precio único o por suscripción.</Empty> : (
        <ul className="space-y-3">
          {[...mine].reverse().map((listing) => {
            const last = listing.moderation.at(-1);
            const priced = listing.content.pricing.model !== "free";
            return (
              <Card as="li" key={listing.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{listing.content.name} · {label("itemKind", listing.kind)} · {priceLabel(listing.content)}</p>
                  <div className="flex gap-1.5">{listing.pendingRevision && <Badge tone="warning">Cambio en revisión</Badge>}<Badge tone={STATUS_TONE[listing.status]}>{label("listingStatus", listing.status)}</Badge></div>
                </div>
                {last?.reason && <p className="text-xs text-ink-muted">Última decisión: {last.action} · {last.reason}</p>}
                <p className="text-xs text-ink-muted">Creada por {listing.createdBy}{listing.createdBy.startsWith("worker:") ? " (borrador preparado por NEX)" : ""}</p>
                <div className="flex flex-wrap gap-2">
                  {(listing.status === "draft" || listing.status === "rejected") && <Button size="sm" variant="primary" onClick={() => send({ type: "listing.submit", listingId: listing.id })}>Enviar a revisión</Button>}
                  {listing.status !== "retired" && <Button size="sm" variant="ghost" onClick={() => send({ type: "listing.retire", listingId: listing.id })}>Retirar</Button>}
                </div>
                {priced && (listing.status === "published" || listing.status === "draft") && (
                  <div className="grid gap-2 sm:grid-cols-3">
                    <input aria-label={`Nuevo precio de ${listing.id}`} className={input} placeholder="Nuevo precio" inputMode="decimal" value={newPrice[listing.id] ?? ""} onChange={(event) => setNewPrice({ ...newPrice, [listing.id]: event.target.value })} />
                    <Button size="sm" variant="secondary" onClick={() => {
                      const minor = parseMajor(newPrice[listing.id] ?? "", listing.content.currency);
                      const pricing: MarketPricing = listing.content.pricing.model === "subscription" ? { ...listing.content.pricing, amountMinor: minor ?? 0 } : { model: "oneTime", amountMinor: minor ?? 0 };
                      send({ type: "listing.edit", listingId: listing.id, content: { ...listing.content, pricing } });
                    }}>{listing.status === "published" ? "Proponer cambio de precio" : "Cambiar precio"}</Button>
                  </div>
                )}
              </Card>
            );
          })}
        </ul>
      )}

      {toAnswer.length > 0 && (
        <Card className="space-y-2 p-5">
          <h2 className="font-semibold">Reseñas por responder</h2>
          <ul className="space-y-2">
            {toAnswer.map((review) => (
              <li key={review.id} className="space-y-1 text-sm">
                <p>{"★".repeat(review.rating)} · {review.body || "Sin comentario"}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <input aria-label={`Respuesta a ${review.id}`} className={`${input} sm:col-span-2`} value={replies[review.id] ?? ""} onChange={(event) => setReplies({ ...replies, [review.id]: event.target.value })} />
                  <Button size="sm" variant="secondary" onClick={() => send({ type: "review.reply", reviewId: review.id, text: replies[review.id] ?? "" })}>Responder</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <SellerSettlements {...{ state, persona }} />
    </div>
  );
}

function SellerSettlements({ state, persona }: Pick<MarketTabProps, "state" | "persona">) {
  const mine = state.settlements.filter((settlement) => settlement.sellerTenantId === persona.tenantId);
  if (mine.length === 0) return null;
  return (
    <Card className="space-y-2 p-5">
      <h2 className="font-semibold">Liquidaciones</h2>
      <ul className="space-y-1 text-sm">{mine.map((settlement) => <li key={settlement.id}>{settlement.id} · {formatMinor(settlement.total)} · {label("settlementStatus", settlement.status)}{settlement.paymentRef ? ` · ${settlement.paymentRef}` : ""}</li>)}</ul>
    </Card>
  );
}

// ---------------------------------------------------------------- moderation (administrators)
export function ModerationTab({ state, send, admin, tenantName }: MarketTabProps) {
  const [reason, setReason] = useState("");
  if (!admin) return <AdminOnly />;
  const queue = moderationQueue(state);
  const published = state.listings.filter((listing) => listing.status === "published");
  const suspended = state.listings.filter((listing) => listing.status === "suspended");
  const visibleReviews = state.reviews.filter((review) => !review.hidden);
  const row = (listing: Listing, extra: ReactNode) => (
    <Card as="li" key={listing.id} className="space-y-2 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{listing.content.name} · {tenantName(listing.sellerTenantId)} · {label("itemKind", listing.kind)}</p>
        <Badge tone={STATUS_TONE[listing.status]}>{label("listingStatus", listing.status)}</Badge>
      </div>
      {extra}
    </Card>
  );
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">Motivo</h2>
        <input aria-label="Motivo" className={input} placeholder="Obligatorio para rechazar, suspender u ocultar" value={reason} onChange={(event) => setReason(event.target.value)} />
        <p className="text-xs text-ink-muted">Quien envió una publicación no puede aprobarla. Reponer una suspendida también necesita una segunda aprobación.</p>
      </Card>
      <h2 className="font-semibold">Cola de revisión ({queue.length})</h2>
      {queue.length === 0 ? <Empty title="Cola vacía">Las publicaciones nuevas y los cambios aparecen aquí.</Empty> : (
        <ul className="space-y-3">
          {queue.map((listing) => {
            const revision = listing.pendingRevision;
            const issues = objectiveIssues(listing.kind, revision ? revision.content : listing.content);
            return row(listing, (
              <>
                {revision && <p className="text-xs text-ink-muted">Cambio propuesto: {listing.content.name} ({priceLabel(listing.content)}) → {revision.content.name} ({priceLabel(revision.content)}) · enviado por {revision.submittedBy}</p>}
                {!revision && <p className="text-xs text-ink-muted">Enviada por {listing.submittedBy} · {listing.content.summary}</p>}
                <div className="flex flex-wrap gap-1.5">{issues.length === 0 ? <Badge tone="success">Cumple los requisitos</Badge> : issues.map((issue) => <Badge key={issue} tone="danger">Falta: {issue}</Badge>)}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => send({ type: "moderation.decide", listingId: listing.id, approve: true })}>Aprobar</Button>
                  <Button size="sm" variant="ghost" onClick={() => send({ type: "moderation.decide", listingId: listing.id, approve: false, reason })}>Rechazar</Button>
                </div>
              </>
            ));
          })}
        </ul>
      )}
      <h2 className="font-semibold">Publicadas ({published.length})</h2>
      <ul className="space-y-3">{published.map((listing) => row(listing, <Button size="sm" variant="ghost" onClick={() => send({ type: "moderation.suspend", listingId: listing.id, reason })}>Suspender</Button>))}</ul>
      {suspended.length > 0 && (
        <>
          <h2 className="font-semibold">Suspendidas ({suspended.length})</h2>
          <ul className="space-y-3">{suspended.map((listing) => row(listing, <Button size="sm" variant="secondary" onClick={() => send({ type: "moderation.reinstate", listingId: listing.id })}>Solicitar reposición</Button>))}</ul>
        </>
      )}
      <h2 className="font-semibold">Reseñas</h2>
      {visibleReviews.length === 0 ? <p className="text-xs text-ink-muted">No hay reseñas visibles.</p> : (
        <ul className="space-y-2">
          {visibleReviews.map((review) => (
            <li key={review.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{"★".repeat(review.rating)} · {review.body || "Sin comentario"}</span>
              <Button size="sm" variant="ghost" onClick={() => send({ type: "review.hide", reviewId: review.id, reason })}>Ocultar reseña</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- administration: dashboard, revenue share, settlements
export function AdminTab({ state, send, admin, tenantName }: MarketTabProps) {
  const [scope, setScope] = useState("default");
  const [percent, setPercent] = useState("");
  const [why, setWhy] = useState("");
  const [refs, setRefs] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  if (!admin) return <AdminOnly />;
  const dash = adminDashboard(state);
  const owed = new Map<string, number>();
  for (const charge of state.charges) if (charge.status === "accrued") owed.set(`${charge.sellerTenantId}|${charge.sellerNet.currency}`, (owed.get(`${charge.sellerTenantId}|${charge.sellerNet.currency}`) ?? 0) + charge.sellerNet.amountMinor);

  const propose = () => {
    const bps = parseMajor(percent, "USD"); // 12.5 → 1250 basis points
    if (bps === null) return setFormError("Porcentaje inválido.");
    setFormError(null);
    send({ type: "share.request", scope: scope === "default" ? { type: "default" } : { type: "listing", listingId: scope }, toBps: bps, reason: why });
  };
  const shareText = (bps: number) => `${bps / 100} %`;
  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[["Volumen bruto", dash.gross], ["Comisión de la plataforma", dash.commission], ["Por pagar a vendedores", dash.owedToSellers]].map(([title, amounts]) => (
          <Card as="li" key={title as string} className="space-y-1 p-5"><h2 className="text-sm text-ink-muted">{title as string}</h2><MoneyMap amounts={amounts as Record<string, number>} /></Card>
        ))}
        <Card as="li" className="space-y-1 p-5"><h2 className="text-sm text-ink-muted">Reparto por defecto</h2><p className="text-xl font-semibold">{shareText(dash.defaultShareBps)}</p><p className="text-xs text-ink-muted">para la plataforma</p></Card>
      </ul>
      <Card className="flex flex-wrap gap-2 p-5">
        <Badge tone={dash.moderationQueue ? "warning" : "neutral"}>{dash.moderationQueue} por moderar</Badge>
        <Badge>{dash.listingsByStatus.published} publicadas</Badge>
        <Badge tone={dash.listingsByStatus.suspended ? "danger" : "neutral"}>{dash.listingsByStatus.suspended} suspendidas</Badge>
        <Badge>{dash.sellers} vendedores</Badge>
        <Badge>{dash.buyers} compradores</Badge>
        <Badge tone={dash.pendingShareChanges ? "warning" : "neutral"}>{dash.pendingShareChanges} cambios de reparto por aprobar</Badge>
        <Badge tone={dash.settlementsToDecide ? "warning" : "neutral"}>{dash.settlementsToDecide} liquidaciones por decidir</Badge>
        <Badge tone={dash.settlementsToPay ? "accent" : "neutral"}>{dash.settlementsToPay} por registrar como pagadas</Badge>
        <Badge>{dash.hiddenReviews} reseñas ocultas</Badge>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Reparto de ingresos</h2><Badge tone="danger">Nivel 3</Badge></div>
        <p className="text-sm text-ink-muted">Un administrador propone y otro distinto aprueba. Aplica solo a cobros futuros; lo ya cobrado conserva su reparto.</p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="Alcance"><select aria-label="Alcance del reparto" className={input} value={scope} onChange={(event) => setScope(event.target.value)}><option value="default">Todas (por defecto)</option>{state.listings.filter((l) => l.status === "published").map((listing) => <option key={listing.id} value={listing.id}>{listing.content.name}</option>)}</select></Field>
          <Field name="Nuevo % para la plataforma"><input aria-label="Nuevo porcentaje" className={input} inputMode="decimal" value={percent} onChange={(event) => setPercent(event.target.value)} /></Field>
          <Field name="Motivo"><input aria-label="Motivo del cambio" className={input} value={why} onChange={(event) => setWhy(event.target.value)} /></Field>
          <div className="flex items-end"><Button size="sm" variant="primary" onClick={propose}>Proponer cambio</Button></div>
        </div>
        {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
        <ul className="space-y-2">
          {[...state.shareChanges].reverse().map((change) => (
            <li key={change.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{change.id} · {change.scope.type === "default" ? "Todas" : state.listings.find((l) => l.id === (change.scope as { listingId: string }).listingId)?.content.name} · {shareText(change.fromBps)} → {shareText(change.toBps)} · {label("shareStatus", change.status)} · propone {change.requestedBy}</span>
              {change.status === "requested" && (
                <span className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => send({ type: "share.decide", changeId: change.id, approve: true })}>Aprobar cambio</Button>
                  <Button size="sm" variant="ghost" onClick={() => send({ type: "share.decide", changeId: change.id, approve: false })}>Rechazar cambio</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card className="space-y-3 p-5">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Liquidaciones a vendedores</h2><Badge tone="danger">Nivel 3</Badge></div>
        <p className="text-sm text-ink-muted">Se solicita, otro administrador aprueba, y quien paga fuera de la plataforma registra la referencia. Aquí no se mueve dinero.</p>
        {[...owed.entries()].map(([key, minor]) => {
          const [seller, currency] = key.split("|");
          return (
            <div key={key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{tenantName(seller)} · {money(minor, currency)} por liquidar</span>
              <Button size="sm" variant="secondary" onClick={() => send({ type: "settlement.request", sellerTenantId: seller, currency })}>Solicitar liquidación de {tenantName(seller)}</Button>
            </div>
          );
        })}
        <ul className="space-y-3">
          {[...state.settlements].reverse().map((settlement) => (
            <li key={settlement.id} className="space-y-2 rounded-xl bg-raised p-3 text-sm">
              <p>{settlement.id} · {tenantName(settlement.sellerTenantId)} · {formatMinor(settlement.total)} · {label("settlementStatus", settlement.status)} · solicita {settlement.requestedBy}{settlement.paymentRef ? ` · ${settlement.paymentRef}` : ""}</p>
              {settlement.status === "requested" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => send({ type: "settlement.decide", settlementId: settlement.id, approve: true })}>Aprobar liquidación</Button>
                  <Button size="sm" variant="ghost" onClick={() => send({ type: "settlement.decide", settlementId: settlement.id, approve: false })}>Rechazar liquidación</Button>
                </div>
              )}
              {settlement.status === "approved" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input aria-label={`Referencia de ${settlement.id}`} className={input} placeholder="Referencia del pago hecho fuera" value={refs[settlement.id] ?? ""} onChange={(event) => setRefs({ ...refs, [settlement.id]: event.target.value })} />
                  <Button size="sm" variant="secondary" onClick={() => send({ type: "settlement.markPaid", settlementId: settlement.id, paymentRef: refs[settlement.id] ?? "" })}>Marcar como pagada</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- audit and logs
export function ActivityTab({ state }: MarketTabProps) {
  const feeds = [
    { title: "Auditoría", empty: "Sin cambios", rows: state.audit.map((entry) => `${day(entry.at)} · ${entry.tenantId} · ${entry.actor} · ${entry.action}${entry.detail ? ` · ${entry.detail}` : ""}`) },
    { title: "Registros", empty: "Sin registros", rows: state.logs.map((entry) => `${entry.level.toUpperCase()} · ${entry.event}`) },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {feeds.map((feed) => {
        const { shown, hidden } = latest(feed.rows);
        return (
          <Card key={feed.title} className="space-y-2 p-5">
            <h2 className="font-semibold">{feed.title} ({feed.rows.length})</h2>
            {feed.rows.length === 0 ? <p className="text-xs text-ink-muted">{feed.empty}</p> : <ul className="max-h-96 space-y-1 overflow-auto text-xs text-ink-muted">{shown.map((row, index) => <li key={`${row}-${index}`}>{row}</li>)}</ul>}
            {hiddenNote(hidden) && <p className="text-xs text-ink-muted">{hiddenNote(hidden)}</p>}
          </Card>
        );
      })}
    </div>
  );
}
