"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { CHANNELS, conversationsOf, latestRouting, routingsOf, type Channel, type ConvStatus } from "@/lib/contracts/platform/comms-center";
import { label } from "@/lib/contracts/platform/comms-messages";
import { CHANNELS_INFO, FUTURE_CONNECTORS, analyzeConversation, commsStats, customerContext, entriesOf, formatWait, inbox, linkHint, omnichannelTimeline, type InboxFilter } from "@/lib/contracts/platform/koe-comms";
import { formatCostMicros } from "@/lib/contracts/platform/koe-registry";
import { Kpi, Section, money, num, pct } from "./InsightsCharts";
import type { CommsTabProps } from "./CommsCenter";
import { INPUT_FULL } from "@/components/ui/form";

const PRIORITY_TONE: Record<string, BadgeTone> = { low: "neutral", normal: "primary", high: "warning", critical: "danger" };
const STATUS_TONE: Record<ConvStatus, BadgeTone> = { open: "accent", pending: "warning", resolved: "success", archived: "neutral" };
const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const who = (actor: string) => (actor === "" ? "Sin responsable" : actor.startsWith("worker:") ? "NEX (IA)" : actor === "system" ? "Plataforma" : actor === "customer" ? "Cliente" : actor);
const selectedOf = (props: CommsTabProps) => conversationsOf(props.state, props.persona.tenantId).find((item) => item.id === props.selected) ?? conversationsOf(props.state, props.persona.tenantId)[0];

function ConversationPicker({ props }: { props: CommsTabProps }) {
  const items = conversationsOf(props.state, props.persona.tenantId);
  const current = selectedOf(props);
  return (
    <label className="block max-w-lg space-y-1 text-sm text-ink-muted">Conversación
      <select aria-label="Conversación" className={INPUT_FULL} value={current?.id ?? ""} onChange={(event) => props.select(event.target.value)}>
        {items.map((item) => <option key={item.id} value={item.id}>{item.contact.name} · {label("channel", item.channel)} · {item.subject}</option>)}
      </select>
    </label>
  );
}

// ---------------------------------------------------------------- inbox
export function InboxTab(props: CommsTabProps) {
  const { state, env, asOf, persona, select, sendAsPlatform } = props;
  const [filter, setFilter] = useState<InboxFilter>({});
  const [sim, setSim] = useState<{ channel: Channel; name: string; text: string }>({ channel: "webchat", name: "Visitante 300", text: "Hola, necesito ayuda con mi pedido" });
  const stats = commsStats(state, persona.tenantId, asOf, env.crm);
  const rows = inbox(state, persona.tenantId, asOf, filter, env.crm);
  const people = [...new Set(conversationsOf(state, persona.tenantId).map((item) => item.assignee).filter(Boolean))];
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Conversaciones" value={num(stats.total)} />
        <Kpi label="Esperando respuesta" value={num(stats.waiting)} tone={stats.waiting > 0 ? "warn" : undefined} />
        <Kpi label="Sin responsable" value={num(stats.unassigned)} />
        <Kpi label="Críticas" value={num(stats.critical)} tone={stats.critical > 0 ? "warn" : undefined} />
        <Kpi label="Espera promedio" value={stats.averageWaitMinutes === null ? "—" : formatWait(stats.averageWaitMinutes)} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5" aria-label="Filtros de la bandeja">
        <select aria-label="Canal" className={INPUT_FULL} value={filter.channel ?? ""} onChange={(event) => setFilter({ ...filter, channel: (event.target.value || undefined) as Channel | undefined })}>
          <option value="">Todos los canales</option>{CHANNELS.filter((channel) => !CHANNELS_INFO[channel].future).map((channel) => <option key={channel} value={channel}>{label("channel", channel)} ({stats.byChannel[channel]})</option>)}
        </select>
        <select aria-label="Estado" className={INPUT_FULL} value={filter.status ?? ""} onChange={(event) => setFilter({ ...filter, status: (event.target.value || undefined) as ConvStatus | undefined })}>
          <option value="">Todos los estados</option>{(["open", "pending", "resolved", "archived"] as const).map((status) => <option key={status} value={status}>{label("status", status)} ({stats.byStatus[status]})</option>)}
        </select>
        <select aria-label="Responsable" className={INPUT_FULL} value={filter.assignee ?? ""} onChange={(event) => setFilter({ ...filter, assignee: event.target.value || undefined })}>
          <option value="">Todos los responsables</option><option value="unassigned">Sin responsable</option>{people.map((person) => <option key={person} value={person}>{person}</option>)}
        </select>
        <input aria-label="Etiqueta" placeholder="Etiqueta" className={INPUT_FULL} value={filter.tag ?? ""} onChange={(event) => setFilter({ ...filter, tag: event.target.value || undefined })} />
        <input aria-label="Buscar" placeholder="Buscar cliente, empresa o texto" className={INPUT_FULL} value={filter.search ?? ""} onChange={(event) => setFilter({ ...filter, search: event.target.value || undefined })} />
      </div>
      {rows.length === 0 && <p className="text-sm text-ink-muted">No hay conversaciones con esos filtros.</p>}
      <ul className="space-y-2" aria-label="Bandeja unificada">
        {rows.map((row) => (
          <Card as="li" key={row.id} aria-label={`Conversación ${row.contactName}`} className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="primary">{label("channel", row.channel)}</Badge>
              <span className="font-semibold">{row.contactName}</span>{row.company && <span className="text-sm text-ink-muted">· {row.company}</span>}
              <Badge tone={STATUS_TONE[row.status]}>{label("status", row.status)}</Badge>
              <Badge tone={PRIORITY_TONE[row.priority]}>Prioridad {label("urgency", row.priority)}</Badge>
              {row.waiting && <Badge tone="warning">Espera {formatWait(row.waitMinutes)}</Badge>}
            </div>
            <p className="text-sm"><span className="font-medium">{row.subject}</span> <span className="text-ink-muted">— {row.preview}</span></p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
              <span>Responsable: {who(row.assignee)}</span><span>· Última actividad {when(row.lastActivityAt)}</span>
              {row.tags.map((tag) => <Badge key={tag} tone="neutral">#{tag}</Badge>)}
              <span>· KOE recomienda: <strong>{label("nextBest", row.nextBest.kind)}</strong></span>
            </div>
            <Button size="sm" variant="secondary" onClick={() => select(row.id, "conversation")}>Abrir</Button>
          </Card>
        ))}
      </ul>
      <Card className="space-y-2 p-4" aria-label="Simular un mensaje entrante">
        <h2 className="font-semibold">Simular un mensaje entrante</h2>
        <p className="text-xs text-ink-muted">Los mensajes de los clientes llegan a través de la plataforma y KOE los enruta; ni una persona ni NEX los escriben. Esto simula esa llegada.</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <select aria-label="Canal del mensaje simulado" className={INPUT_FULL} value={sim.channel} onChange={(event) => setSim({ ...sim, channel: event.target.value as Channel })}>{CHANNELS.map((channel) => <option key={channel} value={channel}>{label("channel", channel)}</option>)}</select>
          <input aria-label="Nombre del cliente simulado" className={INPUT_FULL} value={sim.name} onChange={(event) => setSim({ ...sim, name: event.target.value })} />
          <input aria-label="Texto del mensaje simulado" className={`${INPUT_FULL} sm:col-span-2`} value={sim.text} onChange={(event) => setSim({ ...sim, text: event.target.value })} />
        </div>
        <Button size="sm" variant="secondary" onClick={() => sendAsPlatform({ type: "conversation.open", input: { channel: sim.channel, subject: `Mensaje de ${sim.name}`, contact: { name: sim.name, handle: sim.name.toLowerCase().replace(/\s+/g, "-") }, company: "", text: sim.text } })}>Recibir mensaje (plataforma)</Button>
      </Card>
      <Section title="Arquitectura preparada, todavía no construida" aside="Cada conector irá a través de KOE, nunca directo a un proveedor">
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Conectores futuros">
          {FUTURE_CONNECTORS.map((item) => <Card as="li" key={item.id} className="space-y-1 p-3"><div className="flex items-center gap-2"><span className="font-medium">{item.label}</span><Badge tone="neutral">No construido</Badge></div><p className="text-xs text-ink-muted">Necesita: {item.needs}</p></Card>)}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------- conversation
export function ConversationTab(props: CommsTabProps) {
  const { state, env, asOf, persona, send } = props;
  const conversation = selectedOf(props);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [tag, setTag] = useState("");
  if (!conversation) return <p className="text-sm text-ink-muted">Todavía no hay conversaciones.</p>;
  const entries = entriesOf(state, persona.tenantId, conversation.id);
  const insight = analyzeConversation(conversation, entries.filter((item) => !item.internal), asOf, linkHint(env.crm, conversation));
  const thread = entries.filter((item) => !item.internal);
  const notes = entries.filter((item) => item.kind === "note");
  const context = env.crm ? customerContext(state, env.crm, persona.tenantId, conversation.id, asOf) : null;
  const leads = env.refs.leads.filter((item) => item.tenantId === persona.tenantId);
  const customers = env.refs.customers.filter((item) => item.tenantId === persona.tenantId);
  const nameOfLead = (id: string) => env.crm?.leads.find((item) => item.id === id)?.name ?? id;
  const nameOfCustomer = (id: string) => env.crm?.customers.find((item) => item.id === id)?.company ?? id;
  return (
    <div className="space-y-5">
      <ConversationPicker props={props} />
      <Card className="space-y-3 p-4" aria-label="Datos de la conversación">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">{conversation.contact.name}</h2>{conversation.company && <span className="text-ink-muted">· {conversation.company}</span>}
          <Badge tone="primary">{label("channel", conversation.channel)}</Badge><Badge tone={STATUS_TONE[conversation.status]}>{label("status", conversation.status)}</Badge>
          <Badge tone={PRIORITY_TONE[insight.priority]}>Prioridad {label("urgency", insight.priority)}</Badge>
        </div>
        <p className="text-sm text-ink-soft">{conversation.subject}</p>
        <p className="text-xs text-ink-muted">Contacto: {conversation.contact.handle} · Responsable: {who(conversation.assignee)} · Tiempo de espera: {insight.needsReply ? formatWait(insight.waitMinutes) : "nadie espera"} · Última actividad {when(conversation.lastActivityAt)}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {conversation.tags.map((item) => <Badge key={item} tone="neutral">#{item} <button type="button" aria-label={`Quitar etiqueta ${item}`} className="ml-1 text-xs" onClick={() => send({ type: "tag.remove", conversationId: conversation.id, tag: item })}>×</button></Badge>)}
          <input aria-label="Nueva etiqueta" placeholder="Nueva etiqueta" className="w-36 rounded-xl border border-line bg-raised px-2 py-1 text-xs text-ink" value={tag} onChange={(event) => setTag(event.target.value)} />
          <Button size="sm" variant="ghost" onClick={() => { if (!send({ type: "tag.add", conversationId: conversation.id, tag })) setTag(""); }}>Etiquetar</Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => send({ type: "conversation.classify", conversationId: conversation.id })}>Clasificar y enrutar con KOE</Button>
          <Button size="sm" variant="secondary" onClick={() => send({ type: "draft.create", conversationId: conversation.id })}>Preparar borrador</Button>
        </div>
      </Card>

      <Section title="Conversación" aside="Solo lo que el cliente puede ver">
        <ol className="space-y-2" aria-label="Mensajes">
          {thread.filter((item) => item.direction).map((item) => (
            <li key={item.id} className={`max-w-xl rounded-xl p-3 text-sm ${item.direction === "in" ? "bg-raised" : "ml-auto bg-primary/10"}`}>
              <p className="text-xs text-ink-muted">{item.direction === "in" ? "Cliente" : who(item.actor)} · {label("entryKind", item.kind)} · {when(item.at)}</p><p>{item.text}</p>
            </li>
          ))}
        </ol>
        <div className="space-y-2">
          <textarea aria-label="Respuesta enviada" rows={2} placeholder="Registre aquí la respuesta que usted envió fuera de la plataforma" className={INPUT_FULL} value={reply} onChange={(event) => setReply(event.target.value)} />
          <Button size="sm" variant="secondary" onClick={() => { if (!send({ type: "message.record", conversationId: conversation.id, text: reply })) setReply(""); }}>Registrar respuesta enviada</Button>
          <p className="text-xs text-ink-muted">La plataforma no envía nada: esto solo deja constancia de lo que una persona respondió.</p>
        </div>
      </Section>

      <Section title="Notas internas" aside="Nunca las ve el cliente; quedan auditadas">
        {notes.length === 0 && <p className="text-sm text-ink-muted">No hay notas.</p>}
        <ul className="space-y-1 text-sm" aria-label="Notas internas">{notes.map((item) => <li key={item.id} className="rounded-xl bg-warning/10 px-3 py-1.5"><span className="text-xs text-ink-muted">{when(item.at)} · {who(item.actor)}</span> {item.text}</li>)}</ul>
        <div className="flex flex-wrap gap-2"><input aria-label="Nota interna" placeholder="Escriba una nota para el equipo" className={`${INPUT_FULL} max-w-xl`} value={note} onChange={(event) => setNote(event.target.value)} /><Button size="sm" variant="secondary" onClick={() => { if (!send({ type: "note.add", conversationId: conversation.id, text: note })) setNote(""); }}>Agregar nota</Button></div>
      </Section>

      <Section title="Contexto del cliente" aside="Se consulta al CRM de KOE; no se copia aquí">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>Vinculada con:</span>
          {context?.linked.leadId && <Badge tone="accent">Prospecto: {nameOfLead(context.linked.leadId)}</Badge>}
          {context?.linked.customerId && <Badge tone="success">Cliente: {nameOfCustomer(context.linked.customerId)}</Badge>}
          {!context?.linked.leadId && !context?.linked.customerId && <span className="text-ink-muted">nada todavía</span>}
          <select aria-label="Vincular con el CRM" className="rounded-xl border border-line bg-raised px-2 py-1 text-sm text-ink" defaultValue="" onChange={(event) => { const value = event.target.value; if (!value) return; const [kind, id] = value.split(":"); send(kind === "lead" ? { type: "conversation.link", conversationId: conversation.id, leadId: id } : { type: "conversation.link", conversationId: conversation.id, customerId: id }); event.target.value = ""; }}>
            <option value="">Vincular con…</option>
            {leads.map((item) => <option key={item.id} value={`lead:${item.id}`}>Prospecto: {nameOfLead(item.id)}</option>)}
            {customers.map((item) => <option key={item.id} value={`customer:${item.id}`}>Cliente: {nameOfCustomer(item.id)}</option>)}
          </select>
        </div>
        {context?.pipeline && (
          <Card className="space-y-1 p-3" aria-label="Pipeline del cliente"><h3 className="text-sm font-semibold">Pipeline</h3>
            <p className="text-sm">{context.pipeline.name} · etapa <strong>{label2(context.pipeline.stage)}</strong> · valor {money(context.pipeline.valueMicros)} · oportunidad {context.pipeline.opportunityScore} · riesgo {context.pipeline.risk}</p>
          </Card>
        )}
        {context && context.audits.length > 0 && (
          <Card className="space-y-1 p-3" aria-label="Business Audit del cliente"><h3 className="text-sm font-semibold">Business Audit</h3>
            <ul className="text-sm text-ink-soft">{context.audits.map((audit) => <li key={audit.id}>{when(audit.at)} · ajuste {audit.fitScore}/100 · recomienda {audit.recommended.join(", ")}</li>)}</ul>
          </Card>
        )}
        {context?.customer && (
          <Card className="space-y-2 p-3" aria-label="Customer 360"><h3 className="text-sm font-semibold">Customer 360 · {context.customer.company}</h3>
            <p className="text-sm">Pagado: <strong>{money(context.customer.paidMicros)}</strong> · {num(context.customer.contacts.length)} contacto(s)</p>
            <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              {(["payment", "product", "academy", "marketplace", "referral", "worker", "automation"] as const).map((kind) => <li key={kind}><span className="text-ink-muted">{kindName(kind)}: </span>{context.customer?.links[kind].map((link) => link.label).join("; ") || "nada todavía"}</li>)}
            </ul>
          </Card>
        )}
      </Section>
    </div>
  );
}
const label2 = (stage: string) => ({ prospect: "Prospecto", qualified: "Calificado", meeting: "Reunión", proposal: "Propuesta", negotiation: "Negociación", won: "Ganado", lost: "Perdido" })[stage] ?? stage;
const kindName = (kind: string) => ({ payment: "Pagos", product: "Productos", academy: "Academia", marketplace: "Marketplace", referral: "Referidos", worker: "Workers", automation: "Automatizaciones" })[kind] ?? kind;

// ---------------------------------------------------------------- omnichannel timeline
export function TimelineTab(props: CommsTabProps) {
  const { state, env, persona } = props;
  const conversation = selectedOf(props);
  if (!conversation) return <p className="text-sm text-ink-muted">Todavía no hay conversaciones.</p>;
  const items = latest(omnichannelTimeline(state, env.crm, persona.tenantId, conversation.id), 80);
  const ordered = [...items.shown].reverse();
  return (
    <div className="space-y-4">
      <ConversationPicker props={props} />
      <p className="text-sm text-ink-muted">Una sola línea de tiempo de este cliente: todos sus canales, las notas, lo que hicieron los Workers y las automatizaciones, el Business Audit y el CRM, en orden.</p>
      <ol className="space-y-2" aria-label="Línea de tiempo omnicanal">
        {ordered.map((item) => (
          <li key={`${item.source}-${item.id}`} className="flex flex-wrap items-baseline gap-2 border-l-2 border-line pl-3 text-sm">
            <span className="text-xs text-ink-muted">{when(item.at)}</span><Badge tone={item.internal ? "neutral" : "primary"}>{label("entryKind", item.kind)}</Badge>
            {item.channel && item.source === "comms" && !item.internal && <span className="text-xs text-ink-muted">{label("channel", item.channel)}</span>}
            {item.source === "crm" && <span className="text-xs text-ink-muted">CRM</span>}
            <span className="text-ink-soft">{item.text}</span><span className="text-xs text-ink-muted">· {who(item.actor)}{item.internal ? " · interno" : ""}</span>
          </li>
        ))}
      </ol>
      {hiddenNote(items.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(items.hidden)}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- conversation intelligence
export function IntelligenceTab(props: CommsTabProps) {
  const { state, env, asOf, persona, send } = props;
  const conversation = selectedOf(props);
  if (!conversation) return <p className="text-sm text-ink-muted">Todavía no hay conversaciones.</p>;
  const insight = analyzeConversation(conversation, entriesOf(state, persona.tenantId, conversation.id).filter((item) => !item.internal), asOf, linkHint(env.crm, conversation));
  const last = latestRouting(state, persona.tenantId, conversation.id);
  const history = routingsOf(state, persona.tenantId, conversation.id);
  return (
    <div className="space-y-5">
      <ConversationPicker props={props} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Inteligencia de la conversación">
        <Kpi label="Urgencia" value={label("urgency", insight.urgency)} hint={`${insight.urgencyScore} de 100 puntos`} tone={insight.urgency === "high" || insight.urgency === "critical" ? "warn" : undefined} />
        <Kpi label="Sentimiento (simulado)" value={label("sentiment", insight.sentiment)} />
        <Kpi label="Intención" value={label("intent", insight.intent)} />
        <Kpi label="Categoría" value={label("category", insight.category)} />
        <Kpi label="Probabilidad de venta" value={pct(insight.saleProbability)} />
        <Kpi label="Probabilidad de soporte" value={pct(insight.supportProbability)} />
        <Kpi label="Tiempo de espera" value={insight.needsReply ? formatWait(insight.waitMinutes) : "—"} />
        <Kpi label="Próxima mejor acción" value={label("nextBest", insight.nextBest.kind)} />
      </div>
      <Card className="space-y-2 p-4" aria-label="Motivo de la recomendación">
        <h2 className="font-semibold">Motivo</h2>
        <p className="text-sm text-ink-soft">{insight.nextBest.reason}</p>
        <ul className="list-disc space-y-0.5 pl-5 text-sm text-ink-muted">{insight.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
        <p className="text-xs text-ink-muted">Todo lo calcula KOE con reglas simuladas; el sentimiento es una estimación simulada, no una lectura real.</p>
      </Card>
      <Card className="space-y-2 p-4" aria-label="Enrutamiento de KOE">
        <h2 className="font-semibold">Enrutamiento de KOE</h2>
        {last ? (
          <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="inline text-ink-muted">Worker que la atiende: </dt><dd className="inline font-medium">{last.workerName}</dd></div>
            <div><dt className="inline text-ink-muted">Especialidad: </dt><dd className="inline font-medium">{last.specialty}</dd></div>
            <div><dt className="inline text-ink-muted">Prioridad: </dt><dd className="inline"><Badge tone={PRIORITY_TONE[last.priority]}>{label("urgency", last.priority)}</Badge></dd></div>
            <div><dt className="inline text-ink-muted">Modelo seleccionado por KOE: </dt><dd className="inline font-medium">{last.model.label}</dd></div>
            <div className="sm:col-span-2"><dt className="inline text-ink-muted">Motivo: </dt><dd className="inline">{last.reason}</dd></div>
            <div><dt className="inline text-ink-muted">Costo estimado: </dt><dd className="inline">{formatCostMicros(last.estimatedCostMicros)}</dd></div>
          </dl>
        ) : <p className="text-sm text-ink-muted">KOE todavía no ha enrutado esta conversación.</p>}
        <Button size="sm" variant="secondary" onClick={() => send({ type: "conversation.classify", conversationId: conversation.id })}>Clasificar y enrutar con KOE</Button>
        <h3 className="pt-2 text-sm font-semibold">Historial de decisiones (nunca se sobrescribe)</h3>
        <ul className="space-y-0.5 text-sm text-ink-soft" aria-label="Historial de enrutamiento">
          {[...history].reverse().slice(0, 6).map((item) => <li key={item.id}>{when(item.at)} · {item.workerName} · {item.specialty} · prioridad {label("urgency", item.priority)} · {item.trigger === "receive" ? "mensaje nuevo" : "clasificación"}</li>)}
        </ul>
      </Card>
    </div>
  );
}
