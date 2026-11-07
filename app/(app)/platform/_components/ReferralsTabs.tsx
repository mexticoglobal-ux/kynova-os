"use client";

import { useState, type ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { CURRENCY_CODES, formatMinor, isCrypto, parseMajor, type CurrencyCode } from "@/lib/contracts/platform/currency";
import { BURST_LIMIT, summarizeReferrals, type CommissionStatus, type ProgramInput, type ProgramStatus, type ReferralStatus } from "@/lib/contracts/platform/referral-center";
import { DEMO_PROGRAM } from "@/lib/contracts/platform/referral-demo";
import { label } from "@/lib/contracts/platform/referral-messages";
import type { ReferralTabProps } from "./ReferralsCenter";

const input = "w-full rounded-xl border border-line bg-raised px-3 py-2 text-sm";
const COMMISSION_TONE: Record<CommissionStatus, BadgeTone> = { pending: "warning", held: "danger", approved: "success", inPayout: "accent", paid: "success", rejected: "neutral", reversed: "neutral" };
const REFERRAL_TONE: Record<ReferralStatus, BadgeTone> = { clicked: "neutral", signedUp: "primary", qualified: "accent", converted: "success", rejected: "neutral", expired: "neutral" };
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "—");
const percent = (value: number | null) => (value === null ? "—" : `${(value * 100).toFixed(1)} %`);

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-ink-muted">{name}</span>
      {children}
    </label>
  );
}
const Empty = ({ title, children }: { title: string; children?: string }) => <EmptyState icon={Inbox} title={title}>{children}</EmptyState>;
const currencyOf = (state: ReferralTabProps["state"]): CurrencyCode => state.program?.currency ?? "USD";
const money = (minor: number, currency: string) => formatMinor({ amountMinor: minor, currency });
const affiliateName = (state: ReferralTabProps["state"], id: string) => state.affiliates.find((affiliate) => affiliate.id === id)?.name ?? id;

// ---------------------------------------------------------------- dashboard
export function OverviewTab({ state }: ReferralTabProps) {
  const summary = summarizeReferrals(state);
  const currency = currencyOf(state);
  const { commissions, funnel, todo } = summary;
  const tiles = [
    { title: "Comisiones pendientes", value: commissions.pending, tone: "warning" as const },
    { title: "Retenidas por fraude", value: commissions.held, tone: "danger" as const },
    { title: "Aprobadas", value: commissions.approved, tone: "success" as const },
    { title: "En pago", value: commissions.inPayout, tone: "accent" as const },
    { title: "Pagadas", value: commissions.paid, tone: "success" as const },
  ];
  return (
    <div className="space-y-4">
      {!state.program && <Empty title="Aún no hay programa">Configure el programa o cargue los datos de ejemplo.</Empty>}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {tiles.map((tile) => (
          <Card as="li" key={tile.title} className="space-y-2 p-5">
            <h2 className="text-sm text-ink-muted">{tile.title}</h2>
            <p className="text-xl font-semibold">{money(tile.value, currency)}</p>
          </Card>
        ))}
      </ul>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Embudo de conversión</h2>
        <ul className="grid gap-2 sm:grid-cols-4">
          {[["Clics", funnel.clicks], ["Registrados", funnel.signedUp], ["Calificados", funnel.qualified], ["Convertidos", funnel.converted]].map(([name, value]) => (
            <li key={name as string} className="rounded-xl bg-raised px-3 py-2 text-sm"><span className="text-ink-muted">{name}</span><p className="text-lg font-semibold">{value}</p></li>
          ))}
        </ul>
        <p className="text-xs text-ink-muted">Registro {percent(summary.rates.signup)} · conversión total {percent(summary.rates.conversion)} · cierre {percent(summary.rates.closing)} · {funnel.rejected} rechazados · {funnel.expired} vencidos</p>
      </Card>
      <Card className="flex flex-wrap gap-2 p-5">
        <Badge tone={todo.toReview ? "warning" : "neutral"}>{todo.toReview} comisiones por revisar</Badge>
        <Badge tone={todo.payoutsToDecide ? "warning" : "neutral"}>{todo.payoutsToDecide} pagos por decidir</Badge>
        <Badge tone={todo.payoutsToPay ? "accent" : "neutral"}>{todo.payoutsToPay} pagos aprobados por registrar</Badge>
        <Badge>{summary.affiliates.active} de {summary.affiliates.total} afiliados activos</Badge>
        {commissions.clawback > 0 && <Badge tone="danger">{commissions.clawback} por recuperar</Badge>}
      </Card>
      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">Mejores afiliados</h2>
        {summary.leaderboard.length === 0 ? <p className="text-xs text-ink-muted">Sin afiliados todavía.</p> : (
          <ol className="space-y-1 text-sm">
            {summary.leaderboard.map((row) => <li key={row.affiliateId} className="flex justify-between"><span>{row.name} · {row.converted} conversiones</span><span>{money(row.earnedMinor, currency)}</span></li>)}
          </ol>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- program, rules and levels
export function ProgramTab({ state, send, actor }: ReferralTabProps) {
  const program = state.program;
  const initial = program ?? { ...DEMO_PROGRAM, name: "" };
  const [name, setName] = useState(initial.name);
  const [currency, setCurrency] = useState<CurrencyCode>(initial.currency);
  const [kind, setKind] = useState<"percent" | "fixed">(initial.reward.kind);
  const [value, setValue] = useState(initial.reward.kind === "percent" ? String(initial.reward.basisPoints / 100) : String(initial.reward.amount.amountMinor / 100));
  const [windowDays, setWindowDays] = useState(String(initial.attributionWindowDays));
  const [minSale, setMinSale] = useState(String(initial.minSaleMinor / 100));
  const [holdDays, setHoldDays] = useState(String(initial.approval.holdDays));
  const [autoMax, setAutoMax] = useState(String(initial.approval.autoApproveMaxMinor / 100));
  const [minPayout, setMinPayout] = useState(String(initial.approval.minPayoutMinor / 100));
  const [linkBase, setLinkBase] = useState(initial.linkBase);
  const [formError, setFormError] = useState<string | null>(null);

  const save = () => {
    const amount = parseMajor(value, "USD"); // two decimals: a percent in basis points, or a fixed amount in cents
    const min = parseMajor(minSale, currency);
    const auto = parseMajor(autoMax, currency);
    const payout = parseMajor(minPayout, currency);
    if (amount === null || min === null || auto === null || payout === null) return setFormError("Revise los montos: solo números y los decimales de la moneda.");
    setFormError(null);
    const reward: ProgramInput["reward"] = kind === "percent" ? { kind: "percent", basisPoints: amount, currency } : { kind: "fixed", amount: { amountMinor: parseMajor(value, currency) ?? 0, currency } };
    send({ type: "program.save", actor, program: { name, status: program?.status ?? "draft", currency, reward, levels: program?.levels ?? [], levelsEnabled: false, attributionWindowDays: Number(windowDays), minSaleMinor: min, approval: { holdDays: Number(holdDays), autoApproveMaxMinor: auto, minPayoutMinor: payout }, linkBase } });
  };
  return (
    <div className="space-y-4">
      <ActorNote />
      <Card className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Programa de afiliados</h2>
          {program && <Badge tone={program.status === "active" ? "success" : "neutral"}>{label("programStatus", program.status)}</Badge>}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="Nombre"><input aria-label="Nombre del programa" className={input} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field name="Moneda"><select aria-label="Moneda del programa" className={input} value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode)}>{CURRENCY_CODES.filter((code) => !isCrypto(code)).map((code) => <option key={code} value={code}>{code}</option>)}</select></Field>
          <Field name="Comisión"><select aria-label="Tipo de comisión" className={input} value={kind} onChange={(event) => setKind(event.target.value as "percent" | "fixed")}><option value="percent">Porcentaje</option><option value="fixed">Monto fijo</option></select></Field>
          <Field name={kind === "percent" ? "Porcentaje (%)" : "Monto fijo"}><input aria-label="Valor de la comisión" className={input} inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} /></Field>
          <Field name="Ventana de atribución (días)"><input aria-label="Ventana de atribución" className={input} inputMode="numeric" value={windowDays} onChange={(event) => setWindowDays(event.target.value)} /></Field>
          <Field name="Venta mínima"><input aria-label="Venta mínima" className={input} inputMode="decimal" value={minSale} onChange={(event) => setMinSale(event.target.value)} /></Field>
        </div>
        <h3 className="pt-2 text-sm font-semibold">Reglas de aprobación</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="Espera antes de aprobar (días)"><input aria-label="Espera en días" className={input} inputMode="numeric" value={holdDays} onChange={(event) => setHoldDays(event.target.value)} /></Field>
          <Field name="Aprobación automática hasta"><input aria-label="Aprobación automática hasta" className={input} inputMode="decimal" value={autoMax} onChange={(event) => setAutoMax(event.target.value)} /></Field>
          <Field name="Mínimo para pedir un pago"><input aria-label="Mínimo de pago" className={input} inputMode="decimal" value={minPayout} onChange={(event) => setMinPayout(event.target.value)} /></Field>
          <Field name="Base de los enlaces"><input aria-label="Base de los enlaces" className={input} value={linkBase} onChange={(event) => setLinkBase(event.target.value)} /></Field>
        </div>
        <p className="text-xs text-ink-muted">Lo pequeño y sin señales de fraude se aprueba solo al pasar la espera; lo demás lo revisa una persona. El pago de comisiones nunca es automático.</p>
        {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={save}>Guardar programa</Button>
          {(["active", "paused", "ended"] as ProgramStatus[]).map((status) => (
            <Button key={status} size="sm" variant="ghost" disabled={!program} onClick={() => send({ type: "program.status", actor, status })}>{status === "active" ? "Activar" : status === "paused" ? "Pausar" : "Terminar"}</Button>
          ))}
        </div>
      </Card>
      <Card className="space-y-2 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Comisiones por niveles</h2>
          <Badge tone="warning">Preparado · desactivado</Badge>
        </div>
        <p className="text-sm text-ink-muted">El modelo ya soporta hasta dos niveles sobre quien patrocinó al afiliado, cada uno con su propia regla. Se activa en una fase futura; hoy solo gana quien hizo la venta.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled aria-label="Activar niveles" /> Activar niveles (próximamente)</label>
      </Card>
    </div>
  );
}

const ActorNote = () => <p className="text-xs text-ink-muted">Las acciones de esta pestaña las ejecuta la persona elegida en «Actuar como».</p>;

// ---------------------------------------------------------------- affiliates, codes and links
export function AffiliatesTab({ state, send, actor }: ReferralTabProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sponsor, setSponsor] = useState("");
  const summary = summarizeReferrals(state);
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Nuevo afiliado</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="Nombre"><input aria-label="Nombre del afiliado" className={input} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Field name="Correo"><input aria-label="Correo del afiliado" className={input} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field name="Código del patrocinador (opcional)"><input aria-label="Código del patrocinador" className={input} value={sponsor} onChange={(event) => setSponsor(event.target.value)} /></Field>
        </div>
        <Button size="sm" variant="primary" onClick={() => send({ type: "affiliate.enroll", actor, name, email, sponsorCode: sponsor || undefined })}>Inscribir y generar código</Button>
      </Card>
      {state.affiliates.length === 0 ? <Empty title="Sin afiliados">Cada afiliado recibe un código y un enlace únicos.</Empty> : (
        <ul className="space-y-3">
          {state.affiliates.map((affiliate) => {
            const row = summary.leaderboard.find((item) => item.affiliateId === affiliate.id);
            return (
              <Card as="li" key={affiliate.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{affiliate.name} · <span className="font-mono">{affiliate.code}</span></p>
                  <Badge tone={affiliate.status === "active" ? "success" : "danger"}>{label("affiliateStatus", affiliate.status)}</Badge>
                </div>
                <p className="break-all text-xs text-ink-muted">{affiliate.link}</p>
                <p className="text-xs text-ink-muted">{affiliate.email} · {row?.converted ?? 0} conversiones · ganado {money(row?.earnedMinor ?? 0, currencyOf(state))}{affiliate.sponsorId ? ` · patrocinado por ${affiliateName(state, affiliate.sponsorId)}` : ""}</p>
                <Button size="sm" variant="ghost" onClick={() => send({ type: affiliate.status === "active" ? "affiliate.suspend" : "affiliate.reactivate", actor, affiliateId: affiliate.id })}>{affiliate.status === "active" ? "Suspender" : "Reactivar"}</Button>
              </Card>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- referrals
export function ReferralsTab({ state, send }: ReferralTabProps) {
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [saleEmail, setSaleEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [saleRef, setSaleRef] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const currency = currencyOf(state);
  const open = state.referrals.filter((referral) => referral.status === "clicked" || referral.status === "signedUp" || referral.status === "qualified");

  const convert = () => {
    const minor = parseMajor(amount, currency);
    if (minor === null || minor === 0) return setFormError("Monto inválido.");
    setFormError(null);
    send({ type: "referral.convert", email: saleEmail, sale: { amountMinor: minor, currency }, saleRef });
  };
  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Simular un clic en un enlace</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="Código"><select aria-label="Código del afiliado" className={input} value={code} onChange={(event) => setCode(event.target.value)}><option value="">Elegir…</option>{state.affiliates.map((affiliate) => <option key={affiliate.id} value={affiliate.code}>{affiliate.name} · {affiliate.code}</option>)}</select></Field>
          <Field name="Correo del referido"><input aria-label="Correo del referido" className={input} value={email} onChange={(event) => setEmail(event.target.value)} /></Field>
          <Field name="Nombre"><input aria-label="Nombre del referido" className={input} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <div className="flex items-end"><Button size="sm" variant="primary" onClick={() => send({ type: "referral.click", code, email, name: name || undefined })}>Registrar clic</Button></div>
        </div>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Registrar una venta del referido</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field name="Referido"><select aria-label="Referido que compra" className={input} value={saleEmail} onChange={(event) => setSaleEmail(event.target.value)}><option value="">Elegir…</option>{[...new Set(open.map((referral) => referral.email))].map((item) => <option key={item} value={item}>{item}</option>)}</select></Field>
          <Field name={`Monto (${currency})`}><input aria-label="Monto de la venta" className={input} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <Field name="Referencia de la venta"><input aria-label="Referencia de la venta" className={input} value={saleRef} onChange={(event) => setSaleRef(event.target.value)} /></Field>
          <div className="flex items-end"><Button size="sm" variant="primary" onClick={convert}>Registrar venta</Button></div>
        </div>
        {formError && <p role="alert" className="text-sm text-danger-soft">{formError}</p>}
        <p className="text-xs text-ink-muted">Si varios afiliados tocaron a la misma persona, gana el último contacto dentro de la ventana.</p>
      </Card>
      {state.referrals.length === 0 ? <Empty title="Sin referidos">Aparecen cuando alguien entra por el enlace de un afiliado.</Empty> : (
        <ul className="space-y-3">
          {[...state.referrals].reverse().map((referral) => (
            <Card as="li" key={referral.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{referral.name} · {referral.email}</p>
                <Badge tone={REFERRAL_TONE[referral.status]}>{label("referralStatus", referral.status)}</Badge>
              </div>
              <p className="text-xs text-ink-muted">Afiliado: {affiliateName(state, referral.affiliateId)} · primer contacto {day(referral.createdAt)} · último {day(referral.lastTouchAt)}{referral.rejectReason ? ` · ${label("rejectReason", referral.rejectReason)}` : ""}</p>
              <div className="flex gap-2">
                {referral.status === "clicked" && <Button size="sm" variant="ghost" onClick={() => send({ type: "referral.signup", referralId: referral.id })}>Marcar registrado</Button>}
                {referral.status === "signedUp" && <Button size="sm" variant="ghost" onClick={() => send({ type: "referral.qualify", referralId: referral.id })}>Marcar calificado</Button>}
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- commissions
export function CommissionsTab({ state, send, actor }: ReferralTabProps) {
  const [filter, setFilter] = useState<CommissionStatus | "all">("all");
  const rows = state.commissions.filter((commission) => filter === "all" || commission.status === filter);
  const statuses: CommissionStatus[] = ["pending", "held", "approved", "inPayout", "paid", "rejected", "reversed"];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Field name="Estado">
          <select aria-label="Filtrar por estado" className={input} value={filter} onChange={(event) => setFilter(event.target.value as CommissionStatus | "all")}>
            <option value="all">Todas</option>
            {statuses.map((status) => <option key={status} value={status}>{label("commissionStatus", status)}</option>)}
          </select>
        </Field>
        <Button size="sm" variant="secondary" onClick={() => send({ type: "tick" })}>Aplicar aprobación automática</Button>
      </div>
      {rows.length === 0 ? <Empty title="Sin comisiones">Una venta de un referido genera la comisión según la regla vigente.</Empty> : (
        <ul className="space-y-3">
          {[...rows].reverse().map((commission) => (
            <Card as="li" key={commission.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{commission.id} · {affiliateName(state, commission.affiliateId)} · nivel {commission.level} · {formatMinor(commission.amount)}</p>
                <Badge tone={COMMISSION_TONE[commission.status]}>{label("commissionStatus", commission.status)}</Badge>
              </div>
              <p className="text-xs text-ink-muted">Venta {commission.saleRef} ({formatMinor(commission.sale)}) · elegible desde {day(commission.eligibleAt)}{commission.clawback ? " · por recuperar: la venta se reembolsó" : ""}</p>
              {commission.signals.length > 0 && <div className="flex flex-wrap gap-1.5">{commission.signals.map((signal) => <Badge key={signal} tone="danger">{label("fraudSignal", signal)}</Badge>)}</div>}
              <div className="flex flex-wrap gap-2">
                {(commission.status === "pending" || commission.status === "held") && (
                  <>
                    <Button size="sm" variant="primary" onClick={() => send({ type: "commission.review", actor, commissionId: commission.id, approve: true })}>Aprobar</Button>
                    <Button size="sm" variant="ghost" onClick={() => send({ type: "commission.review", actor, commissionId: commission.id, approve: false })}>Rechazar</Button>
                  </>
                )}
                {commission.level === 1 && <Button size="sm" variant="ghost" onClick={() => send({ type: "sale.refunded", saleRef: commission.saleRef })}>Simular reembolso de la venta</Button>}
              </div>
              <details className="text-xs text-ink-muted">
                <summary className="cursor-pointer">Historial ({commission.history.length})</summary>
                <ul className="mt-1 space-y-0.5">{commission.history.map((entry, index) => <li key={`${entry.at}-${index}`}>{day(entry.at)} · {entry.actor} · {entry.event}{entry.detail ? ` · ${entry.detail}` : ""}</li>)}</ul>
              </details>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- payouts (Level 3)
export function PayoutsTab({ state, send, actor }: ReferralTabProps) {
  const [refs, setRefs] = useState<Record<string, string>>({});
  const currency = currencyOf(state);
  const payable = state.affiliates
    .map((affiliate) => ({ affiliate, total: state.commissions.filter((c) => c.affiliateId === affiliate.id && c.status === "approved" && c.amount.currency === currency).reduce((sum, c) => sum + c.amount.amountMinor, 0) }))
    .filter((row) => row.total > 0);
  const tone = { requested: "warning", approved: "accent", paid: "success", rejected: "neutral" } as const;
  return (
    <div className="space-y-4">
      <Card className="space-y-1 p-5">
        <div className="flex items-center gap-2"><h2 className="font-semibold">Pagar comisiones</h2><Badge tone="danger">Nivel 3</Badge></div>
        <p className="text-sm text-ink-muted">Una persona solicita, otra aprueba, y quien paga fuera de la plataforma registra la referencia. NEX no puede solicitar, aprobar ni registrar pagos. Aquí no se mueve dinero.</p>
      </Card>
      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">Por solicitar</h2>
        {payable.length === 0 ? <p className="text-xs text-ink-muted">Ningún afiliado tiene comisiones aprobadas pendientes.</p> : (
          <ul className="space-y-2">
            {payable.map(({ affiliate, total }) => (
              <li key={affiliate.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{affiliate.name} · {money(total, currency)}</span>
                <Button size="sm" variant="secondary" onClick={() => send({ type: "payout.request", actor, affiliateId: affiliate.id, currency })}>Solicitar pago de {affiliate.name}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {state.payouts.length === 0 ? <Empty title="Sin pagos de comisiones">Los pagos solicitados aparecen aquí con su estado.</Empty> : (
        <ul className="space-y-3">
          {[...state.payouts].reverse().map((payout) => (
            <Card as="li" key={payout.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{payout.id} · {affiliateName(state, payout.affiliateId)} · {formatMinor(payout.total)}</p>
                <Badge tone={tone[payout.status]}>{label("payoutStatus", payout.status)}</Badge>
              </div>
              <p className="text-xs text-ink-muted">{payout.commissionIds.length} comisiones · solicitado por {payout.requestedBy}{payout.decidedBy ? ` · decidido por ${payout.decidedBy}` : ""}{payout.paymentRef ? ` · referencia ${payout.paymentRef}` : ""}</p>
              {payout.status === "requested" && (
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => send({ type: "payout.decide", actor, payoutId: payout.id, approve: true })}>Aprobar pago</Button>
                  <Button size="sm" variant="ghost" onClick={() => send({ type: "payout.decide", actor, payoutId: payout.id, approve: false })}>Rechazar pago</Button>
                </div>
              )}
              {payout.status === "approved" && (
                <div className="grid gap-2 sm:grid-cols-3">
                  <input aria-label={`Referencia del pago ${payout.id}`} className={input} placeholder="Referencia del pago hecho fuera" value={refs[payout.id] ?? ""} onChange={(event) => setRefs({ ...refs, [payout.id]: event.target.value })} />
                  <Button size="sm" variant="secondary" onClick={() => send({ type: "payout.markPaid", actor, payoutId: payout.id, paymentRef: refs[payout.id] ?? "" })}>Marcar como pagado</Button>
                </div>
              )}
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- fraud
export function FraudTab({ state, send, actor }: ReferralTabProps) {
  const held = state.commissions.filter((commission) => commission.status === "held");
  return (
    <div className="space-y-4">
      <Card className="space-y-2 p-5">
        <h2 className="font-semibold">Qué se vigila</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>Autorreferido o mismo correo que el afiliado.</li>
          <li>Mismo dispositivo que el afiliado.</li>
          <li>Ráfaga: {BURST_LIMIT} o más referidos de un mismo afiliado en una hora.</li>
          <li>Afiliado suspendido: la comisión se registra rechazada.</li>
          <li>Venta reembolsada: se revierte; si ya se pagó, queda marcada por recuperar.</li>
        </ul>
        <p className="text-xs text-ink-muted">Cualquier señal retiene la comisión: nunca se aprueba sola ni se paga sin que una persona la revise.</p>
      </Card>
      {held.length === 0 ? <Empty title="Nada retenido">Las comisiones con señales de fraude aparecen aquí.</Empty> : (
        <ul className="space-y-3">
          {held.map((commission) => (
            <Card as="li" key={commission.id} className="space-y-2 p-4">
              <p className="font-medium">{commission.id} · {affiliateName(state, commission.affiliateId)} · {formatMinor(commission.amount)}</p>
              <div className="flex flex-wrap gap-1.5">{commission.signals.map((signal) => <Badge key={signal} tone="danger">{label("fraudSignal", signal)}</Badge>)}</div>
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => send({ type: "commission.review", actor, commissionId: commission.id, approve: true })}>Liberar</Button>
                <Button size="sm" variant="ghost" onClick={() => send({ type: "commission.review", actor, commissionId: commission.id, approve: false })}>Rechazar</Button>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- audit and logs
export function ActivityTab({ state }: ReferralTabProps) {
  const feeds = [
    { title: "Auditoría", empty: "Sin cambios", rows: state.audit.map((entry) => `${day(entry.at)} · ${entry.actor} · ${entry.action}${entry.detail ? ` · ${entry.detail}` : ""}`) },
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
