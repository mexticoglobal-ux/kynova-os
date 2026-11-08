"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { conversationsOf, draftsOf, grantsOf, type ConvStatus, type Draft } from "@/lib/contracts/platform/comms-center";
import { DEMO_PERSONAS } from "@/lib/contracts/platform/comms-demo";
import { label } from "@/lib/contracts/platform/comms-messages";
import { entriesOf } from "@/lib/contracts/platform/koe-comms";
import { Section } from "./InsightsCharts";
import type { CommsTabProps } from "./CommsCenter";
import { INPUT_FULL } from "@/components/ui/form";

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const who = (actor: string) => (actor === "" ? "Sin responsable" : actor.startsWith("worker:") ? "NEX (IA)" : actor === "system" ? "Plataforma" : actor);
const DRAFT_TONE: Record<Draft["status"], BadgeTone> = { draft: "warning", ready: "success", discarded: "neutral" };
const STATUS_TONE: Record<ConvStatus, BadgeTone> = { open: "accent", pending: "warning", resolved: "success", archived: "neutral" };

// ---------------------------------------------------------------- draft center
function DraftCard({ draft, props }: { draft: Draft; props: CommsTabProps }) {
  const conversation = props.state.conversations.find((item) => item.id === draft.conversationId);
  const lastRevision = draft.revisions[draft.revisions.length - 1];
  const [body, setBody] = useState(lastRevision.body);
  return (
    <Card as="li" aria-label={`Borrador ${conversation?.contact.name ?? ""} ${label("draftKind", draft.kind)}`} className="space-y-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="primary">{label("draftKind", draft.kind)}</Badge><Badge tone={DRAFT_TONE[draft.status]}>{label("draftStatus", draft.status)}</Badge>
        <span className="font-medium">{conversation?.contact.name}</span><span className="text-xs text-ink-muted">{conversation?.subject} · preparado por {who(draft.createdBy)} · {when(draft.createdAt)}</span>
      </div>
      {lastRevision.subject && <p className="text-sm"><span className="text-ink-muted">Asunto:</span> {lastRevision.subject}</p>}
      {draft.status === "draft" ? <textarea aria-label={`Texto del borrador de ${conversation?.contact.name ?? ""}`} rows={5} className={INPUT_FULL} value={body} onChange={(event) => setBody(event.target.value)} /> : <p className="whitespace-pre-line rounded-xl bg-raised p-3 text-sm text-ink-soft">{lastRevision.body}</p>}
      <p className="text-xs text-ink-muted">{draft.reason}</p>
      <details className="text-sm"><summary className="cursor-pointer text-ink-muted">Revisiones ({draft.revisions.length}); ninguna se pierde</summary>
        <ol className="mt-1 space-y-1">{draft.revisions.map((revision, index) => <li key={index} className="rounded-xl bg-raised p-2 text-xs text-ink-soft"><span className="text-ink-muted">{when(revision.at)} · {who(revision.by)}</span><br />{revision.body}</li>)}</ol>
      </details>
      {draft.status === "draft" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={body === lastRevision.body} onClick={() => props.send({ type: "draft.revise", draftId: draft.id, body })}>Guardar como nueva revisión</Button>
          <Button size="sm" onClick={() => props.send({ type: "draft.ready", draftId: draft.id })}>Marcar como lista</Button>
          <Button size="sm" variant="ghost" onClick={() => props.send({ type: "draft.discard", draftId: draft.id })}>Descartar</Button>
        </div>
      )}
      {draft.status === "ready" && <p className="text-xs text-success">Lista: una persona puede enviarla ahora, fuera de la plataforma. La plataforma no la envía.</p>}
    </Card>
  );
}

export function DraftsTab(props: CommsTabProps) {
  const { state, persona, selected, select, send } = props;
  const conversations = conversationsOf(state, persona.tenantId);
  const current = conversations.find((item) => item.id === selected) ?? conversations[0];
  const drafts = draftsOf(state, persona.tenantId);
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">NEX prepara borradores de correo, WhatsApp, Messenger, Instagram, chat y formulario. <strong>Nunca se envían:</strong> una persona los revisa, los marca como listos y los envía ella misma, fuera de la plataforma.</p>
      <Card className="flex flex-wrap items-end gap-3 p-4" aria-label="Preparar un borrador">
        <label className="min-w-64 space-y-1 text-sm text-ink-muted">Conversación
          <select aria-label="Conversación del borrador" className={INPUT_FULL} value={current?.id ?? ""} onChange={(event) => select(event.target.value)}>{conversations.map((item) => <option key={item.id} value={item.id}>{item.contact.name} · {label("channel", item.channel)} · {item.subject}</option>)}</select>
        </label>
        <Button size="sm" variant="secondary" disabled={!current} onClick={() => current && send({ type: "draft.create", conversationId: current.id })}>Preparar borrador</Button>
      </Card>
      {drafts.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay borradores.</p>}
      <ul className="grid gap-3 lg:grid-cols-2" aria-label="Borradores">{drafts.map((draft) => <DraftCard key={`${draft.id}-${draft.status}-${draft.revisions.length}`} draft={draft} props={props} />)}</ul>
    </div>
  );
}

// ---------------------------------------------------------------- assignments
export function AssignmentsTab(props: CommsTabProps) {
  const { state, persona, selected, select, send } = props;
  const conversations = conversationsOf(state, persona.tenantId);
  const current = conversations.find((item) => item.id === selected) ?? conversations[0];
  const grant = grantsOf(state, persona.tenantId).find((item) => item.status === "active");
  const people = DEMO_PERSONAS.filter((item) => item.tenantId === persona.tenantId && !item.actor.startsWith("worker:")).map((item) => item.actor);
  const history = current ? entriesOf(state, persona.tenantId, current.id).filter((item) => item.kind === "assignment" || item.kind === "status") : [];
  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">Asignar, cambiar de responsable, marcar pendiente, resolver y archivar: siempre con historial. Resolver y archivar los decide una persona; una conversación nunca se cierra sola ni se borra.</p>
      <label className="block max-w-lg space-y-1 text-sm text-ink-muted">Conversación
        <select aria-label="Conversación" className={INPUT_FULL} value={current?.id ?? ""} onChange={(event) => select(event.target.value)}>{conversations.map((item) => <option key={item.id} value={item.id}>{item.contact.name} · {label("channel", item.channel)} · {item.subject}</option>)}</select>
      </label>
      {current && (
        <Card className="space-y-3 p-4" aria-label="Asignación">
          <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{current.contact.name}</span><Badge tone={STATUS_TONE[current.status]}>{label("status", current.status)}</Badge><span className="text-sm text-ink-muted">Responsable: {who(current.assignee)}</span></div>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="Responsable nuevo" className="rounded-xl border border-line bg-raised px-3 py-1.5 text-sm text-ink" value="" onChange={(event) => { if (event.target.value !== "__none__") send({ type: "conversation.assign", conversationId: current.id, assignee: event.target.value === "__nobody__" ? "" : event.target.value }); }}>
              <option value="__none__">Asignar a…</option>{people.map((person) => <option key={person} value={person}>{person}</option>)}<option value="__nobody__">Dejar sin responsable</option>
            </select>
            {(["pending", "resolved", "archived", "open"] as const).map((status) => <Button key={status} size="sm" variant="secondary" disabled={current.status === status} onClick={() => send({ type: "status.set", conversationId: current.id, to: status })}>{status === "pending" ? "Marcar pendiente" : status === "resolved" ? "Marcar resuelta" : status === "archived" ? "Archivar" : "Reabrir"}</Button>)}
          </div>
        </Card>
      )}
      <Card className="space-y-2 p-4" aria-label="Autorización para reasignar">
        <h2 className="font-semibold">Autorización para reasignar (Nivel 2)</h2>
        <p className="text-sm text-ink-muted">NEX puede reasignar una conversación solo con una autorización vigente de una persona, con sus límites. Sin ella, la reasignación se rechaza.</p>
        {grant
          ? <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="success">Vigente</Badge><span>{grant.maxPerDay ? `hasta ${grant.maxPerDay} reasignaciones por día` : "sin límite diario"} · concedida por {who(grant.grantedBy)}</span><Button size="sm" variant="ghost" onClick={() => send({ type: "authorization.revoke", grantId: grant.id })}>Revocar autorización</Button></div>
          : <div className="flex flex-wrap items-center gap-2 text-sm"><Badge tone="warning">Sin autorización</Badge><Button size="sm" variant="secondary" onClick={() => send({ type: "authorization.grant", maxPerDay: 3 })}>Conceder autorización (3 por día)</Button></div>}
      </Card>
      <Section title="Historial de asignaciones y estados">
        {history.length === 0 && <p className="text-sm text-ink-muted">Todavía no hay cambios.</p>}
        <ol className="space-y-1 text-sm" aria-label="Historial de asignaciones">{history.map((item) => <li key={item.id}><span className="text-xs text-ink-muted">{when(item.at)}</span> <Badge tone="neutral">{label("entryKind", item.kind)}</Badge> <span className="text-ink-soft">{item.text}</span></li>)}</ol>
      </Section>
    </div>
  );
}
