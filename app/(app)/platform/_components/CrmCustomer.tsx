"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { hiddenNote, latest } from "@/lib/contracts/platform/display";
import { PERSON_KINDS, customersOf, leadsOf, tasksOf, type Task } from "@/lib/contracts/platform/crm-center";
import { label } from "@/lib/contracts/platform/crm-messages";
import { customer360, timelineOf } from "@/lib/contracts/platform/koe-crm";
import { Kpi, Section, money, num } from "./InsightsCharts";
import type { CrmTabProps } from "./CrmCenter";

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const who = (actor: string) => (actor.startsWith("worker:") ? "NEX (IA)" : actor === "system" ? "Plataforma" : actor);
const inputClass = "w-full rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink";
const KIND_TONE: Record<string, BadgeTone> = { email: "primary", whatsapp: "success", call: "accent", note: "neutral", meeting: "warning", automation: "neutral", worker: "neutral", audit: "accent", nex: "primary" };

// ---------------------------------------------------------------- timeline
export function TimelineTab({ state, persona, selected, select, send }: CrmTabProps) {
  const leads = leadsOf(state, persona.tenantId);
  const lead = leads.find((item) => item.id === selected) ?? leads[0];
  const [kind, setKind] = useState<(typeof PERSON_KINDS)[number]>("call");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [summary, setSummary] = useState("");
  if (!lead) return <p className="text-sm text-ink-muted">Todavía no hay prospectos.</p>;
  const story = latest(timelineOf(state, persona.tenantId, { kind: "lead", id: lead.id }), 60); // the newest 60, newest first
  const ordered = [...story.shown].reverse();
  return (
    <div className="space-y-4">
      <label className="block max-w-sm space-y-1 text-sm text-ink-muted">Prospecto
        <select aria-label="Prospecto" className={inputClass} value={lead.id} onChange={(event) => select(event.target.value)}>{leads.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.company}</option>)}</select>
      </label>
      <Card className="space-y-2 p-4" aria-label="Registrar contacto">
        <h2 className="font-semibold">Registrar un contacto</h2>
        <p className="text-xs text-ink-muted">Lo registra una persona. Las automatizaciones, los Workers, los Business Audit y NEX aparecen solos, y nada de lo registrado se borra.</p>
        <div className="grid gap-2 sm:grid-cols-4">
          <select aria-label="Tipo de contacto" className={inputClass} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>{PERSON_KINDS.map((item) => <option key={item} value={item}>{label("timelineKind", item)}</option>)}</select>
          <select aria-label="Dirección" className={inputClass} value={direction} onChange={(event) => setDirection(event.target.value as "out" | "in")}><option value="out">Salida (lo hicimos nosotros)</option><option value="in">Entrada (nos escribieron)</option></select>
          <input aria-label="Resumen del contacto" placeholder="Qué pasó" className={`${inputClass} sm:col-span-2`} value={summary} onChange={(event) => setSummary(event.target.value)} />
        </div>
        <Button size="sm" variant="secondary" onClick={() => { if (!send({ type: "interaction.record", subject: { kind: "lead", id: lead.id }, kind, direction, summary })) setSummary(""); }}>Registrar</Button>
      </Card>
      <ol className="space-y-2" aria-label="Línea de tiempo">
        {ordered.map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-baseline gap-2 border-l-2 border-line pl-3 text-sm">
            <span className="text-xs text-ink-muted">{when(entry.at)}</span><Badge tone={KIND_TONE[entry.kind] ?? "neutral"}>{label("timelineKind", entry.kind)}</Badge>
            {entry.direction && <span className="text-xs text-ink-muted">{entry.direction === "in" ? "entrada" : "salida"}</span>}
            <span className="text-ink-soft">{entry.summary}</span><span className="text-xs text-ink-muted">· {who(entry.actor)}</span>
          </li>
        ))}
      </ol>
      {hiddenNote(story.hidden) && <p className="text-xs text-ink-muted">{hiddenNote(story.hidden)}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- tasks
export function TasksTab({ state, persona, send, select }: CrmTabProps) {
  const tasks = tasksOf(state, persona.tenantId);
  const nameOf = (id: string) => leadsOf(state, persona.tenantId).find((item) => item.id === id)?.name ?? id;
  const groups: Task["status"][] = ["proposed", "accepted", "done", "dismissed"];
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">NEX propone; una persona decide. «Aceptada» significa que una persona se compromete a hacerla; «Hecha» que ya la hizo fuera de la plataforma. <strong>Nada se envía ni se ejecuta desde aquí.</strong></p>
      {tasks.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay tareas. Pida a NEX que las prepare desde «Oportunidad».</p>}
      {groups.map((status) => {
        const list = tasks.filter((task) => task.status === status);
        if (list.length === 0) return null;
        return (
          <Section key={status} title={`${label("taskStatus", status)} (${list.length})`}>
            <ul className="space-y-2">
              {list.map((task) => (
                <Card as="li" key={task.id} aria-label={`Tarea ${task.title}`} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone="primary">{label("taskKind", task.kind)}</Badge><span className="font-medium">{task.title}</span><span className="text-xs text-ink-muted">para {when(task.dueAt)} · propuesta de {who(task.proposedBy)}</span></div>
                  <p className="text-sm text-ink-soft">Motivo: {task.reason}</p>
                  {task.draft && <details className="text-sm"><summary className="cursor-pointer text-ink-muted">Borrador preparado por NEX (no enviado)</summary><p className="mt-1 whitespace-pre-line rounded-xl bg-raised p-3 text-ink-soft">{task.draft}</p></details>}
                  <div className="flex flex-wrap gap-2">
                    {task.status === "proposed" && <Button size="sm" onClick={() => send({ type: "task.accept", taskId: task.id })}>Aceptar</Button>}
                    {(task.status === "proposed" || task.status === "accepted") && <Button size="sm" variant="secondary" onClick={() => send({ type: "task.complete", taskId: task.id })}>Marcar como hecha</Button>}
                    {(task.status === "proposed" || task.status === "accepted") && <Button size="sm" variant="ghost" onClick={() => send({ type: "task.dismiss", taskId: task.id })}>Descartar</Button>}
                    <Button size="sm" variant="ghost" onClick={() => select(task.leadId, "opportunity")}>Ver {nameOf(task.leadId)}</Button>
                  </div>
                </Card>
              ))}
            </ul>
          </Section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- customer 360
export function CustomerTab({ state, asOf, persona, selected, select, send }: CrmTabProps) {
  const customers = customersOf(state, persona.tenantId);
  const customer = customers.find((item) => item.id === selected) ?? customers[0];
  const unconverted = leadsOf(state, persona.tenantId).filter((lead) => lead.stage === "won" && !state.customers.some((item) => item.leadId === lead.id));
  const [contact, setContact] = useState({ name: "", role: "", email: "" });
  const view = customer ? customer360(state, persona.tenantId, customer.id, asOf) : null;
  return (
    <div className="space-y-5">
      {unconverted.length > 0 && (
        <Card className="space-y-2 p-4" aria-label="Ventas ganadas sin convertir">
          <h2 className="font-semibold">Ventas ganadas por convertir en cliente</h2>
          <ul className="space-y-1 text-sm">{unconverted.map((lead) => <li key={lead.id} className="flex flex-wrap items-center gap-2"><span>{lead.name} · {lead.company}</span><Button size="sm" onClick={() => send({ type: "customer.convert", leadId: lead.id })}>Convertir en cliente</Button></li>)}</ul>
          <p className="text-xs text-ink-muted">Convertir en cliente es una decisión de una persona.</p>
        </Card>
      )}
      {!view || !customer ? <p className="text-sm text-ink-muted">Todavía no hay clientes.</p> : (
        <>
          <label className="block max-w-sm space-y-1 text-sm text-ink-muted">Cliente
            <select aria-label="Cliente" className={inputClass} value={customer.id} onChange={(event) => select(event.target.value)}>{customers.map((item) => <option key={item.id} value={item.id}>{item.company}</option>)}</select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Empresa" value={view.company} hint={`Cliente desde ${customer.since.slice(0, 10)}`} />
            <Kpi label="Pagado" value={money(view.paidMicros)} hint="Total de pagos (sin datos bancarios)" tone="good" />
            <Kpi label="Contactos" value={num(view.contacts.length)} />
            <Kpi label="Servicios" value={num(view.links.product.length)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="space-y-2 p-4" aria-label="Lista de contactos"><h2 className="font-semibold">Contactos</h2>
              <ul className="space-y-1 text-sm">{view.contacts.map((item) => <li key={item.id}><strong>{item.name}</strong> · {item.role}{item.email ? ` · ${item.email}` : ""}{item.phone ? ` · ${item.phone}` : ""}</li>)}</ul>
              <div className="grid gap-2 sm:grid-cols-3"><input aria-label="Nombre del contacto" placeholder="Nombre" className={inputClass} value={contact.name} onChange={(event) => setContact({ ...contact, name: event.target.value })} /><input aria-label="Cargo del contacto" placeholder="Cargo" className={inputClass} value={contact.role} onChange={(event) => setContact({ ...contact, role: event.target.value })} /><input aria-label="Correo del contacto" placeholder="Correo" className={inputClass} value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /></div>
              <Button size="sm" variant="secondary" onClick={() => { if (!send({ type: "contact.add", customerId: customer.id, name: contact.name, role: contact.role, ...(contact.email ? { email: contact.email } : {}) })) setContact({ name: "", role: "", email: "" }); }}>Añadir contacto</Button>
            </Card>
            <Card className="space-y-2 p-4" aria-label="Pipeline del cliente"><h2 className="font-semibold">Pipeline</h2>
              {view.pipeline ? <><p className="text-sm">Etapa final: <strong>{label("stage", view.pipeline.stage)}</strong> · valor {money(view.pipeline.valueMicros)}</p>
                <ol className="space-y-0.5 text-sm text-ink-soft">{view.pipeline.stageHistory.map((change, index) => <li key={index}>{when(change.at)} · {change.from ? `${label("stage", change.from)} → ` : ""}{label("stage", change.to)} · {who(change.by)}{change.mode === "auto" ? " (automático)" : ""}</li>)}</ol></> : <p className="text-sm text-ink-muted">Sin historial de pipeline.</p>}
            </Card>
          </div>
          <Section title="Todo lo que KOE conecta de este cliente">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Conexiones del cliente">
              {(["product", "academy", "marketplace", "automation", "worker", "payment", "referral"] as const).map((kind) => (
                <Card key={kind} className="space-y-1 p-3" aria-label={`Conexión ${label("linkKind", kind)}`}>
                  <p className="text-xs uppercase tracking-wide text-ink-muted">{label("linkKind", kind)}</p>
                  {view.links[kind].length === 0 && <p className="text-sm text-ink-muted">Nada todavía.</p>}
                  <ul className="space-y-0.5 text-sm">{view.links[kind].map((link) => <li key={link.id}>{link.label}{link.amountMicros !== undefined ? ` · ${money(link.amountMicros)}` : ""}</li>)}</ul>
                </Card>
              ))}
            </div>
          </Section>
          {view.messages.length > 0 && <Section title="Asistente de ventas"><ul className="space-y-1 text-sm">{view.messages.map((item) => <li key={item.id}><strong>{item.text}</strong> <span className="text-ink-muted">{item.reason}</span></li>)}</ul></Section>}
          <Section title="Historia del cliente">
            <ol className="space-y-1.5 text-sm" aria-label="Historia del cliente">{view.timeline.slice(-12).map((entry) => <li key={entry.id}><span className="text-xs text-ink-muted">{when(entry.at)}</span> <Badge tone={KIND_TONE[entry.kind] ?? "neutral"}>{label("timelineKind", entry.kind)}</Badge> <span className="text-ink-soft">{entry.summary}</span></li>)}</ol>
          </Section>
        </>
      )}
    </div>
  );
}
