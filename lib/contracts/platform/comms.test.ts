import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHANNELS, conversationsOf, customerVisible, draftsOf, grantsOf, latestRouting, newCommsState, reduceComms, routingsOf, validateOpen, type CommsEnv, type CommsEvent, type CommsState, type Conversation, type Entry, type OpenInput,
} from "./comms-center";
import { DEMO_NOW, DEMO_PERSONAS, demoCommsOk } from "./comms-demo";
import { ERROR_CODES, label, message } from "./comms-messages";
import { cardOf, contextOf, customer360 } from "./koe-crm";
import {
  CHANNELS_INFO, FUTURE_CONNECTORS, LEXICON, analyzeConversation, commsStats, customerContext, draftReply, entriesOf, formatWait, inbox, omnichannelTimeline, routeConversation,
} from "./koe-comms";
import { BASE_MODELS, STARTER_WORKERS } from "./koe-registry";
import { ACTION_LEVELS } from "./workers";

const ANA = { tenantId: "tenant-nova", actor: "ana" };
const PABLO = { tenantId: "tenant-nova", actor: "pablo" };
const NEX = { tenantId: "tenant-nova", actor: "worker:nex" };
const SYSTEM = { tenantId: "tenant-nova", actor: "system" };
const LUCIA = { tenantId: "tenant-vida", actor: "lucia" };
const NOW = Date.parse(DEMO_NOW);
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const source = demoCommsOk();
const ENV: CommsEnv = source.env;
const demo = source.state;
const NO_MODELS: CommsEnv = { ...ENV, models: BASE_MODELS.map((model) => ({ ...model, enabled: false })) };

const step = (state: CommsState, event: CommsEvent, env: CommsEnv = ENV) => reduceComms(state, event, env);
const must = (state: CommsState, event: CommsEvent, env: CommsEnv = ENV): CommsState => { const result = reduceComms(state, event, env); expect(result.error, event.type).toBeUndefined(); return result.state; };
const open = (state = newCommsState(), over: Partial<OpenInput> = {}, minutesAgo = 30, tenantId = "tenant-nova") => {
  const next = must(state, { tenantId, actor: "system", at: ago(minutesAgo), type: "conversation.open", input: { channel: "email", subject: "Consulta", contact: { name: "Ana Prueba", handle: "ana@prueba.test" }, company: "Empresa", text: "Hola, ¿cuánto cuesta el plan anual?", ...over } });
  return { state: next, id: next.conversations.at(-1)?.id ?? "" };
};
const conv = (state: CommsState, subject: string, tenantId = "tenant-nova") => state.conversations.find((item) => item.subject === subject && item.tenantId === tenantId) as Conversation;
const insightOf = (text: string, over: Partial<Conversation> = {}, minutesAgo = 30, hint?: { leadOpen: boolean; customer: boolean }) => {
  const c: Conversation = { id: "cv_x", tenantId: "tenant-nova", channel: "email", subject: "x", contact: { name: "Ana Prueba", handle: "ana@x.test" }, company: "", status: "open", assignee: "ana", tags: [], link: {}, createdAt: ago(minutesAgo), lastActivityAt: ago(minutesAgo), ...over };
  const e: Entry[] = [{ id: "en_1", tenantId: "tenant-nova", conversationId: "cv_x", at: ago(minutesAgo), kind: "email", direction: "in", text, actor: "customer", internal: false }];
  return analyzeConversation(c, e, DEMO_NOW, hint);
};

describe("the sample loads without a refusal and shows every channel", () => {
  it("has conversations in every channel and every state, drafts, routings, notes and an authorization", () => {
    expect(source.errors).toEqual([]);
    const rows = inbox(demo, "tenant-nova", DEMO_NOW, {}, ENV.crm);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((row) => row.channel))).toEqual(new Set(["email", "whatsapp", "messenger", "instagram", "webchat", "webform"]));
    expect(new Set(rows.map((row) => row.status))).toEqual(new Set(["open", "pending", "resolved", "archived"]));
    expect(draftsOf(demo, "tenant-nova")).toHaveLength(4);
    expect(draftsOf(demo, "tenant-nova").map((item) => item.status).sort()).toEqual(["draft", "draft", "draft", "ready"]);
    expect(routingsOf(demo, "tenant-nova").length).toBeGreaterThan(10);
    expect(demo.entries.filter((entry) => entry.kind === "note")).toHaveLength(2);
    expect(grantsOf(demo, "tenant-nova")).toHaveLength(1);
    expect(DEMO_PERSONAS).toHaveLength(4);
  });
});

describe("Unified Inbox and Conversation Center", () => {
  const rows = inbox(demo, "tenant-nova", DEMO_NOW, {}, ENV.crm);
  const row = (name: string) => rows.find((item) => item.contactName === name);

  it("lists one row per conversation, with customer, company, channel, state, owner, priority, waiting time, last activity and tags", () => {
    const marta = row("Marta Solís");
    expect(marta).toMatchObject({ company: "Clínica Dental Sol", channel: "email", status: "open", assignee: "ana", waitMinutes: 130, waiting: true });
    expect(marta?.priority).toBeDefined();
    expect(marta?.lastActivityAt).toBeDefined();
    expect(marta?.tags).toEqual(expect.arrayContaining(["categoría:sales", "intención:buy", "seguimiento"]));
    expect(formatWait(marta?.waitMinutes ?? 0)).toBe("2 h 10 min");
    expect(marta?.preview).toContain("cotización final");
    expect(row("Visitante 213")).toMatchObject({ channel: "webchat", assignee: "" });
  });

  it("puts what is waiting first, most urgent first, and what is closed last", () => {
    expect(rows[0].contactName).toBe("Luis Prado"); // critical: wants to cancel and has waited three days
    expect(rows[0].priority).toBe("critical");
    const waiting = rows.filter((item) => item.waiting);
    expect(rows.slice(0, waiting.length).every((item) => item.waiting)).toBe(true);
    const order = ["critical", "high", "normal", "low"];
    expect(waiting.map((item) => order.indexOf(item.priority))).toEqual([...waiting.map((item) => order.indexOf(item.priority))].sort());
    expect(rows.at(-1)?.status).not.toBe("open");
  });

  it("filters by channel, state, responsible (or nobody), label and text without caring about accents", () => {
    const pick = (filter: Parameters<typeof inbox>[3]) => inbox(demo, "tenant-nova", DEMO_NOW, filter, ENV.crm).map((item) => item.contactName);
    expect(pick({ channel: "whatsapp" }).sort()).toEqual(["Diego Luna", "Elena Vargas"]);
    expect(pick({ status: "archived" })).toEqual(["Proveedor Sur"]);
    expect(pick({ assignee: "unassigned" }).sort()).toEqual(expect.arrayContaining(["Elena Vargas", "Luis Prado", "Visitante 213"]));
    expect(pick({ assignee: "ana" })).toEqual(["Marta Solís"]);
    expect(pick({ tag: "seguimiento" })).toEqual(["Marta Solís"]);
    expect(pick({ search: "cotizacion" })).toContain("Marta Solís");
    expect(pick({ search: "ELENA" })).toEqual(["Elena Vargas"]);
    expect(pick({ search: "nada que ver" })).toEqual([]);
  });

  it("counts by state, channel, what waits, what has no owner and the average wait", () => {
    const stats = commsStats(demo, "tenant-nova", DEMO_NOW, ENV.crm);
    expect(stats).toMatchObject({ total: 10, byStatus: { open: 7, pending: 1, resolved: 1, archived: 1 }, critical: 1 });
    expect(stats.byChannel).toMatchObject({ email: 3, whatsapp: 2, messenger: 1, instagram: 1, webchat: 2, webform: 1, sms: 0 });
    expect(stats.waiting).toBe(rows.filter((item) => item.waiting).length);
    expect(stats.averageWaitMinutes).toBe(Math.round(rows.filter((item) => item.waiting).reduce((sum, item) => sum + item.waitMinutes, 0) / stats.waiting));
    expect(stats.unassigned).toBe(rows.filter((item) => item.assignee === "" && ["open", "pending"].includes(item.status)).length);
  });
});

describe("Conversation Intelligence: computed by KOE, simulated, explained", () => {
  it("reads the intent, category and a simulated sentiment from what the customer wrote", () => {
    expect(insightOf("Hola, ¿cuánto cuesta el plan anual? Quisiera una cotización")).toMatchObject({ intent: "buy", category: "sales", sentiment: "neutral" });
    expect(insightOf("El sitio no funciona, da error al subir fotos")).toMatchObject({ intent: "support", category: "support", sentiment: "negative" });
    expect(insightOf("Me cobraron dos veces mi factura")).toMatchObject({ intent: "billing", category: "billing" });
    expect(insightOf("Tengo una queja, estoy molesto con el servicio")).toMatchObject({ intent: "complain", category: "complaint", sentiment: "negative" });
    expect(insightOf("Quiero cancelar y darme de baja")).toMatchObject({ intent: "cancel", category: "complaint" });
    expect(insightOf("Gracias, excelente atención")).toMatchObject({ intent: "thanks", sentiment: "positive", category: "general" });
    expect(insightOf("Gracias, pero estoy molesto con la demora")).toMatchObject({ sentiment: "mixed" });
    expect(insightOf("¿Cuál es su horario de atención?")).toMatchObject({ intent: "info" });
    expect(insightOf("asdf qwer")).toMatchObject({ intent: "unknown", category: "general", sentiment: "neutral" });
    expect(insightOf("Hola").sentimentSimulated).toBe(true);
  });

  it("sets the urgency from how long it has waited, the words, the sentiment, the intent and the channel, and says why", () => {
    const quiet = insightOf("Hola, ¿tienen información?", {}, 20);
    expect(quiet).toMatchObject({ urgency: "low", urgencyScore: 0, waitMinutes: 20, priority: "low" });
    expect(insightOf("Hola, ¿tienen información?", {}, 300).urgency).toBe("normal"); // 240+ minutes: 20 points
    const urgent = insightOf("El sitio no funciona, es urgente, ya mismo", {}, 400);
    expect(urgent.urgencyScore).toBe(20 + 20 + 15 + 8); // two urgent expressions, six hours (the 4-hour tier), negative, support
    expect(urgent.urgency).toBe("high");
    const cancelling = insightOf("Quiero cancelar, estoy molesto, nadie me respondió, es urgente", {}, 3 * 1_440);
    expect(cancelling.urgency).toBe("critical");
    expect(cancelling.priority).toBe("critical");
    const chat = insightOf("Necesito ayuda", { channel: "webchat" }, 12);
    expect(chat.urgencyScore).toBe(15 + 8); // a web chat expects speed
    expect(insightOf("Necesito ayuda", { channel: "email" }, 12).urgencyScore).toBe(8);
    expect(urgent.reasons.join()).toContain("espera hace 6 h 40 min");
    expect(insightOf("Hola", { status: "resolved" }, 3 * 1_440).urgency).toBe("low"); // a closed conversation waits for nobody
  });

  it("estimates the probability of a sale and of a support case, using what the CRM knows through KOE", () => {
    const base = insightOf("Quisiera una cotización del precio, quiero contratar");
    expect(base.saleProbability).toBeGreaterThan(0.6);
    const withDeal = insightOf("Quisiera una cotización del precio, quiero contratar", {}, 30, { leadOpen: true, customer: false });
    expect(withDeal.saleProbability).toBeGreaterThan(base.saleProbability);
    expect(withDeal.reasons.join()).toContain("negocio abierto");
    const support = insightOf("Tengo un problema, error, no puedo entrar", {}, 30, { leadOpen: false, customer: true });
    expect(support.supportProbability).toBeGreaterThan(insightOf("Tengo un problema, error, no puedo entrar").supportProbability);
    for (const item of [base, withDeal, support, insightOf("Hola")]) for (const value of [item.saleProbability, item.supportProbability]) { expect(value).toBeGreaterThanOrEqual(0.02); expect(value).toBeLessThanOrEqual(0.98); }
    expect(insightOf("Hola").saleProbability).toBe(0.08);
  });

  it("recommends the next best action with its reason: assign, reply, escalate, wait, resolve", () => {
    expect(insightOf("¿Cuánto cuesta?", { assignee: "" }, 90).nextBest).toMatchObject({ kind: "assign", reason: expect.stringContaining("Nadie la atiende") });
    expect(insightOf("¿Cuánto cuesta?", { assignee: "ana" }, 90).nextBest).toMatchObject({ kind: "reply", reason: expect.stringContaining("con la cotización") });
    expect(insightOf("Quiero cancelar", { assignee: "ana" }, 90).nextBest.kind).toBe("escalate");
    expect(insightOf("Gracias, excelente", { assignee: "ana" }, 90).nextBest.kind).toBe("resolve");
    expect(insightOf("Gracias", { status: "archived" }, 90).nextBest).toMatchObject({ kind: "wait", reason: expect.stringContaining("cerrada") });
    const answered = analyzeConversation({ ...conv(demo, "Re: Propuesta de 9 000 USD") }, entriesOf(demo, "tenant-nova", conv(demo, "Re: Propuesta de 9 000 USD").id), DEMO_NOW);
    expect(answered).toMatchObject({ waitMinutes: 0, nextBest: { kind: "wait" } });
  });

  it("is the one place that holds these rules: the lexicon lives only in koe-comms.ts and the screens only format", () => {
    expect(LEXICON.buy.length).toBeGreaterThan(5);
    const owners = readdirSync(__dirname).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts")).filter((name) => /LEXICON|URGENCY_LEVELS|WAIT_POINTS|urgencyScore\s*=/.test(readFileSync(join(__dirname, name), "utf8")));
    expect(owners).toEqual(["koe-comms.ts"]);
    const dir = join(__dirname, "../../../app/(app)/platform/_components");
    const screens = readdirSync(dir).filter((name) => /^Comms.*\.tsx$/.test(name) && !name.endsWith(".test.tsx"));
    expect(screens.length).toBeGreaterThanOrEqual(3);
    for (const name of screens) expect(readFileSync(join(dir, name), "utf8"), name).not.toMatch(/\.reduce\(|Math\.round|routeConversation|LEXICON/);
  });
});

describe("Smart Routing: KOE decides, never the screen", () => {
  it("chooses the Worker, the specialty, the priority and the model, and records them with the reason", () => {
    const sale = latestRouting(demo, "tenant-nova", conv(demo, "Propuesta de automatización: cotización final").id);
    expect(sale).toMatchObject({ specialty: "sales", workerId: "sales", workerName: "Asistente comercial", model: { id: "m-fast-a", label: "Rápido A" }, trigger: "classify" });
    expect(sale?.reason).toContain("especialidad «sales»");
    expect(sale?.snapshot).toMatchObject({ intent: "buy", category: "sales" });
    expect(sale?.estimatedCostMicros).toBeGreaterThan(0);
    expect(latestRouting(demo, "tenant-nova", conv(demo, "Soporte del sitio web").id)).toMatchObject({ specialty: "followup", workerId: "followup", priority: "high" });
    expect(latestRouting(demo, "tenant-nova", conv(demo, "Chat con el visitante 213").id)).toMatchObject({ specialty: "collections", workerId: "collections" });
    expect(latestRouting(demo, "tenant-nova", conv(demo, "Formulario de contacto de Luis Prado").id)).toMatchObject({ specialty: "followup", priority: "critical" });
  });

  it("routes by category through the engine alone, and says so when no Worker has the specialty", () => {
    const insight = insightOf("Me cobraron dos veces la factura");
    expect(routeConversation(ENV, "tenant-nova", insight)).toMatchObject({ specialty: "collections", workerId: "collections", priority: insight.priority });
    const onlySales = { ...ENV, workers: STARTER_WORKERS.filter((item) => item.id === "sales") };
    const fallback = routeConversation(onlySales, "tenant-nova", insight);
    expect("problem" in fallback ? fallback.problem : fallback.reason).toContain("no hay un Worker con esa especialidad");
    expect(routeConversation(NO_MODELS, "tenant-nova", insight)).toHaveProperty("problem");
  });

  it("routes every new message, and appends a decision each time: nothing is overwritten", () => {
    const made = open();
    expect(routingsOf(made.state, "tenant-nova", made.id)).toHaveLength(1);
    expect(latestRouting(made.state, "tenant-nova", made.id)?.trigger).toBe("receive");
    const again = must(made.state, { ...SYSTEM, at: ago(10), type: "message.receive", conversationId: made.id, text: "¿Alguien me puede ayudar? Es urgente" });
    expect(routingsOf(again, "tenant-nova", made.id)).toHaveLength(2);
    expect(routingsOf(again, "tenant-nova", made.id)[0]).toEqual(routingsOf(made.state, "tenant-nova", made.id)[0]);
    expect(again.entries.some((entry) => entry.kind === "routing" && entry.actor.startsWith("worker:"))).toBe(true);
  });

  it("never loses a message when KOE has no Worker or model, and refuses to classify", () => {
    const stored = must(newCommsState(), { ...SYSTEM, at: ago(30), type: "conversation.open", input: { channel: "email", subject: "x", contact: { name: "A", handle: "a@x.test" }, company: "", text: "Hola" } }, NO_MODELS);
    expect(stored.conversations).toHaveLength(1);
    expect(stored.entries.filter((entry) => entry.kind === "email")).toHaveLength(1);
    expect(stored.routings).toHaveLength(0);
    expect(stored.audit.some((item) => item.action === "routing.pending")).toBe(true);
    const refused = step(stored, { ...NEX, at: ago(5), type: "conversation.classify", conversationId: stored.conversations[0].id }, NO_MODELS);
    expect(refused.errorCode).toBe("noWorker");
    expect(refused.state.routings).toHaveLength(0);
  });
});

describe("Draft Center: NEX prepares, nothing is ever sent", () => {
  const sample = (channel: OpenInput["channel"], text = "¿Cuánto cuesta el plan anual?") => { const made = open(newCommsState(), { channel, text, subject: "Plan anual" }); const draft = step(made.state, { ...NEX, at: ago(5), type: "draft.create", conversationId: made.id }); return { made, draft }; };

  it("prepares a draft for each channel in its own shape: email, WhatsApp, Messenger, Instagram, chat reply, form reply", () => {
    const kinds = Object.fromEntries((["email", "whatsapp", "messenger", "instagram", "webchat", "webform"] as const).map((channel) => [channel, sample(channel).draft.state.drafts[0]]));
    expect(Object.values(kinds).map((item) => item.kind)).toEqual(["email", "whatsapp", "messenger", "instagram", "chat", "form"]);
    expect(kinds.email.revisions[0].subject).toBe("Re: Plan anual");
    expect(kinds.email.revisions[0].body).toContain("Hola Ana,");
    expect(kinds.whatsapp.revisions[0].body.length).toBeLessThan(kinds.email.revisions[0].body.length);
    expect(kinds.webchat.revisions[0].subject).toBeUndefined();
    expect(kinds.webform.revisions[0].subject).toContain("Respuesta a su formulario");
    for (const draft of Object.values(kinds)) { expect(draft).toMatchObject({ status: "draft", createdBy: "worker:nex" }); expect(draft.revisions[0].body).toContain("cotización"); }
  });

  it("writes the reply for the intent: a sale, a problem, a billing question, a complaint, a cancellation", () => {
    const body = (text: string) => sample("whatsapp", text).draft.state.drafts[0].revisions[0].body;
    expect(body("Quiero una cotización")).toContain("cotización");
    expect(body("El sitio no funciona, error")).toContain("inconveniente");
    expect(body("Me cobraron dos veces la factura")).toContain("cobro");
    expect(body("Tengo una queja, estoy molesto")).toContain("molestia");
    expect(body("Quiero cancelar")).toContain("cancelar");
  });

  it("has no draft for SMS (future), and never reads an internal note", () => {
    expect(draftReply({ ...conv(demo, "Soporte del sitio web"), channel: "sms" }, [], insightOf("Hola"))).toBeNull();
    const made = open(newCommsState(), { text: "Hola, quisiera una cotización" });
    const noted = must(made.state, { ...ANA, at: ago(20), type: "note.add", conversationId: made.id, text: "SECRETO-INTERNO: ofrecer 30 % de descuento" });
    const drafted = must(noted, { ...NEX, at: ago(5), type: "draft.create", conversationId: made.id });
    expect(JSON.stringify(drafted.drafts)).not.toContain("SECRETO-INTERNO");
    expect(JSON.stringify(customerVisible(drafted, "tenant-nova", made.id))).not.toContain("SECRETO-INTERNO");
    expect(customerVisible(noted, "tenant-nova", made.id).every((entry) => !entry.internal)).toBe(true);
  });

  it("keeps every revision, lets only a person decide, and a decided draft is final", () => {
    const { made, draft } = sample("email");
    const id = draft.state.drafts[0].id;
    const revised = must(draft.state, { ...NEX, at: ago(4), type: "draft.revise", draftId: id, body: "Hola Ana, le enviamos la cotización adjunta." });
    expect(revised.drafts[0].revisions).toHaveLength(2);
    expect(revised.drafts[0].revisions[0]).toEqual(draft.state.drafts[0].revisions[0]); // the first text is still there
    expect(step(revised, { ...NEX, at: ago(3), type: "draft.ready", draftId: id }).errorCode).toBe("personRequired");
    expect(step(revised, { ...NEX, at: ago(3), type: "draft.discard", draftId: id }).errorCode).toBe("personRequired");
    expect(step(revised, { ...ANA, at: ago(3), type: "draft.revise", draftId: id, body: " " }).errorCode).toBe("invalid");
    expect(step(revised, { ...ANA, at: ago(3), type: "draft.revise", draftId: id, body: "clave sk_live_abcdef123456" }).errorCode).toBe("invalid");
    const ready = must(revised, { ...ANA, at: ago(3), type: "draft.ready", draftId: id });
    expect(ready.drafts[0]).toMatchObject({ status: "ready", decidedBy: "ana" });
    expect(label("draftStatus", "ready")).toContain("una persona la envíe");
    for (const event of [{ ...ANA, at: ago(2), type: "draft.ready", draftId: id }, { ...ANA, at: ago(2), type: "draft.discard", draftId: id }, { ...NEX, at: ago(2), type: "draft.revise", draftId: id, body: "x" }] as CommsEvent[]) expect(step(ready, event).errorCode).toBe("draftClosed");
    expect(step(ready, { ...LUCIA, at: ago(2), type: "draft.discard", draftId: id }).errorCode).toBe("notYours");
    expect(made.id).toBeTruthy();
  });

  it("has no event that sends a message or deletes anything", () => {
    const events = readFileSync(join(__dirname, "comms-center.ts"), "utf8").match(/type: "([a-z.]+)"/g)?.map((item) => item.slice(7, -1)) ?? [];
    expect(events.length).toBeGreaterThan(14);
    expect(events.some((item) => /send|delete|remove\b|erase|overwrite|clear|purge/.test(item.replace("tag.remove", "")))).toBe(false);
    expect([ACTION_LEVELS["comms.draft"], ACTION_LEVELS["comms.classify"], ACTION_LEVELS["comms.assign.auto"], ACTION_LEVELS["comms.send"], ACTION_LEVELS["comms.close"]]).toEqual([1, 1, 2, 3, 3]);
  });
});

describe("Constitution: NEX prepares, an authorization lets it reassign, a person decides", () => {
  const base = () => { const made = open(); return { ...made, ana: must(made.state, { ...ANA, at: ago(100), type: "authorization.grant", maxPerDay: 2 }) }; };

  it("lets NEX classify, label, route and prepare drafts (Level 1)", () => {
    const { state, id } = base();
    const classified = must(state, { ...NEX, at: ago(5), type: "conversation.classify", conversationId: id });
    expect(conv(classified, "Consulta").tags).toEqual(["categoría:sales", "intención:buy"]);
    expect(routingsOf(classified, "tenant-nova", id).at(-1)?.trigger).toBe("classify");
    expect(must(classified, { ...NEX, at: ago(4), type: "tag.add", conversationId: id, tag: "vip" }).conversations[0].tags).toContain("vip");
    expect(step(must(classified, { ...NEX, at: ago(4), type: "tag.add", conversationId: id, tag: "vip" }), { ...NEX, at: ago(3), type: "tag.add", conversationId: id, tag: "vip" }).errorCode).toBe("alreadyThere");
    expect(step(classified, { ...NEX, at: ago(4), type: "tag.add", conversationId: id, tag: "Etiqueta Mala!" }).errorCode).toBe("invalid");
  });

  it("refuses NEX everything that decides: resolve, archive, notes, links, removing labels, recording replies, decisions on drafts, authorizations", () => {
    const { ana: state, id } = base();
    const events: CommsEvent[] = [
      { ...NEX, at: ago(5), type: "status.set", conversationId: id, to: "resolved" }, { ...NEX, at: ago(5), type: "status.set", conversationId: id, to: "archived" }, { ...NEX, at: ago(5), type: "status.set", conversationId: id, to: "pending" },
      { ...NEX, at: ago(5), type: "note.add", conversationId: id, text: "x" }, { ...NEX, at: ago(5), type: "message.record", conversationId: id, text: "x" }, { ...NEX, at: ago(5), type: "tag.remove", conversationId: id, tag: "x" },
      { ...NEX, at: ago(5), type: "conversation.link", conversationId: id, leadId: "ld_1" }, { ...NEX, at: ago(5), type: "draft.ready", draftId: "dr_1" }, { ...NEX, at: ago(5), type: "draft.discard", draftId: "dr_1" },
      { ...NEX, at: ago(5), type: "authorization.grant" }, { ...NEX, at: ago(5), type: "authorization.revoke", grantId: "gr_00001" },
    ];
    for (const event of events) expect(step(state, event).errorCode, event.type).toBe("personRequired");
  });

  it("brings customers' messages only through the platform: not a person, not NEX", () => {
    const input: OpenInput = { channel: "email", subject: "x", contact: { name: "A", handle: "a@x.test" }, company: "", text: "Hola" };
    for (const who of [ANA, NEX]) expect(step(newCommsState(), { ...who, at: ago(5), type: "conversation.open", input }).errorCode).toBe("systemOnly");
    const { id, state } = open();
    for (const who of [ANA, NEX]) expect(step(state, { ...who, at: ago(5), type: "message.receive", conversationId: id, text: "x" }).errorCode).toBe("systemOnly");
    expect(step(state, { ...ANA, at: ago(5), type: "timeline.record", conversationId: id, kind: "worker", text: "x" }).errorCode).toBe("systemOnly");
    expect(step(state, { ...SYSTEM, at: ago(5), type: "message.receive", conversationId: id, text: " " }).errorCode).toBe("invalid");
  });

  it("reassigns automatically only with a vigente authorization, and only to a person", () => {
    const { id, state, ana } = base();
    const reassign = (s: CommsState, at = ago(5), assignee = "pablo") => step(s, { ...NEX, at, type: "conversation.assign", conversationId: id, assignee });
    expect(reassign(state).errorCode).toBe("needsAuthorization"); // no authorization yet
    const moved = reassign(ana);
    expect(moved.error).toBeUndefined();
    expect(moved.state.conversations[0].assignee).toBe("pablo");
    expect(moved.state.entries.at(-1)).toMatchObject({ kind: "assignment", actor: "worker:nex" });
    expect(moved.state.entries.at(-1)?.text).toContain("antes: nadie");
    expect(reassign(ana, ago(5), "worker:nex").errorCode).toBe("invalid");
    expect(reassign(ana, ago(5), "system").errorCode).toBe("invalid");
    const second = must(moved.state, { ...PABLO, at: ago(4), type: "conversation.assign", conversationId: id, assignee: "ana" }); // a person needs no authorization
    expect(second.conversations[0].assignee).toBe("ana");
    const third = step(second, { ...NEX, at: ago(3), type: "conversation.assign", conversationId: id, assignee: "pablo" });
    expect(third.error).toBeUndefined(); // the second use of the day
    expect(step(third.state, { ...NEX, at: ago(2), type: "conversation.assign", conversationId: id, assignee: "ana" }).errorCode).toBe("needsAuthorization"); // the limit is two a day
    const revoked = must(ana, { ...PABLO, at: ago(50), type: "authorization.revoke", grantId: grantsOf(ana, "tenant-nova")[0].id });
    expect(reassign(revoked).errorCode).toBe("needsAuthorization");
    const expiring = must(state, { ...ANA, at: ago(100), type: "authorization.grant", expiresAt: ago(10) });
    expect(reassign(expiring, ago(5)).errorCode).toBe("needsAuthorization");
    expect(step(state, { ...ANA, at: ago(100), type: "authorization.grant", maxPerDay: 0 }).errorCode).toBe("invalid");
    expect(step(state, { ...ANA, at: ago(100), type: "authorization.grant", expiresAt: ago(200) }).errorCode).toBe("invalid");
    expect(step(ana, { ...LUCIA, at: ago(5), type: "authorization.revoke", grantId: "gr_00002" }).errorCode).toBe("notFound");
  });

  it("never closes a case on its own: a new message reopens a resolved conversation, and only a person resolves or archives", () => {
    const { id, state } = open();
    const resolved = must(state, { ...ANA, at: ago(20), type: "status.set", conversationId: id, to: "resolved" });
    expect(conv(resolved, "Consulta").status).toBe("resolved");
    const reopened = must(resolved, { ...SYSTEM, at: ago(5), type: "message.receive", conversationId: id, text: "Perdón, una última duda" });
    expect(conv(reopened, "Consulta").status).toBe("open");
    expect(reopened.entries.some((entry) => entry.kind === "status" && entry.text.includes("Reabierta por un mensaje nuevo"))).toBe(true);
    const archived = must(resolved, { ...ANA, at: ago(15), type: "status.set", conversationId: id, to: "archived" });
    expect(conv(must(archived, { ...SYSTEM, at: ago(5), type: "message.receive", conversationId: id, text: "Hola otra vez" }), "Consulta").status).toBe("open");
    expect(conversationsOf(archived, "tenant-nova")).toHaveLength(1); // archived is not deleted
    expect(step(archived, { ...ANA, at: ago(10), type: "conversation.assign", conversationId: id, assignee: "ana" }).errorCode).toBe("closedConversation");
  });
});

describe("Assignments, always with history", () => {
  it("assigns, reassigns, unassigns, marks pending, resolves, archives and restores, writing who and when", () => {
    const made = open();
    const id = made.id;
    let state = made.state;
    state = must(state, { ...ANA, at: ago(20), type: "conversation.assign", conversationId: id, assignee: "ana" });
    state = must(state, { ...ANA, at: ago(19), type: "conversation.assign", conversationId: id, assignee: "pablo" });
    state = must(state, { ...PABLO, at: ago(18), type: "status.set", conversationId: id, to: "pending" });
    state = must(state, { ...PABLO, at: ago(17), type: "status.set", conversationId: id, to: "resolved" });
    state = must(state, { ...PABLO, at: ago(16), type: "status.set", conversationId: id, to: "archived" });
    state = must(state, { ...ANA, at: ago(15), type: "status.set", conversationId: id, to: "open" });
    state = must(state, { ...ANA, at: ago(14), type: "conversation.assign", conversationId: id, assignee: "" });
    const history = state.entries.filter((entry) => entry.kind === "assignment" || entry.kind === "status").map((entry) => entry.text);
    expect(history).toEqual([
      "ana asignó la conversación a ana (antes: nadie).", "ana asignó la conversación a pablo (antes: ana).",
      "pablo cambió el estado de «abierta» a «pendiente».", "pablo cambió el estado de «pendiente» a «resuelta».", "pablo cambió el estado de «resuelta» a «archivada».", "ana cambió el estado de «archivada» a «abierta».",
      "ana dejó la conversación sin responsable (antes: pablo).",
    ]);
    expect(state.audit.filter((item) => item.action === "assign" || item.action === "status.set")).toHaveLength(7);
    expect(step(state, { ...ANA, at: ago(13), type: "conversation.assign", conversationId: id, assignee: "" }).errorCode).toBe("alreadyThere");
    expect(step(state, { ...ANA, at: ago(13), type: "status.set", conversationId: id, to: "open" }).errorCode).toBe("alreadyThere");
    expect(step(state, { ...ANA, at: ago(13), type: "status.set", conversationId: id, to: "borrada" as never }).errorCode).toBe("invalid");
  });
});

describe("Internal Notes: audited and never visible to the customer", () => {
  it("lets only a person add one, marks it internal, audits it and validates it", () => {
    const { id, state } = open();
    const noted = must(state, { ...ANA, at: ago(10), type: "note.add", conversationId: id, text: "Cliente exigente: responder con detalle." });
    const entry = noted.entries.at(-1);
    expect(entry).toMatchObject({ kind: "note", internal: true, actor: "ana", text: "Cliente exigente: responder con detalle." });
    expect(noted.audit.at(-1)).toMatchObject({ action: "note.add", actor: "ana" });
    expect(customerVisible(noted, "tenant-nova", id).some((item) => item.kind === "note")).toBe(false);
    expect(step(state, { ...ANA, at: ago(10), type: "note.add", conversationId: id, text: " " }).errorCode).toBe("invalid");
    expect(step(state, { ...ANA, at: ago(10), type: "note.add", conversationId: id, text: "x".repeat(1_001) }).errorCode).toBe("invalid");
    expect(step(state, { ...ANA, at: ago(10), type: "note.add", conversationId: id, text: "la clave es sk_live_abcdef123456" }).errorCode).toBe("invalid");
    expect(step(state, { ...LUCIA, at: ago(10), type: "note.add", conversationId: id, text: "x" }).errorCode).toBe("notYours");
    const noteEntries = demo.entries.filter((item) => item.kind === "note");
    expect(noteEntries.every((item) => item.internal)).toBe(true);
    expect(entriesOf(demo, "tenant-nova", conv(demo, "Soporte del sitio web").id).filter((item) => !item.internal).every((item) => item.kind !== "note")).toBe(true);
  });
});

describe("Omnichannel Timeline: one line for everything about a person", () => {
  it("shows emails, WhatsApp, Messenger, Instagram, chat, notes, Workers, automations, Business Audit and the CRM in order", () => {
    const marta = conv(demo, "Propuesta de automatización: cotización final");
    const timeline = omnichannelTimeline(demo, ENV.crm, "tenant-nova", marta.id);
    const kinds = new Set(timeline.map((item) => item.kind));
    for (const kind of ["email", "note", "worker", "automation", "audit", "routing", "assignment", "crm", "nex"]) expect(kinds.has(kind as never), kind).toBe(true);
    expect(timeline.map((item) => item.at)).toEqual([...timeline.map((item) => item.at)].sort());
    expect(timeline.some((item) => item.source === "crm")).toBe(true);
    expect(timeline.some((item) => item.source === "comms" && item.channel === "email")).toBe(true);
  });

  it("joins the conversations of the same customer across channels", () => {
    const first = open(newCommsState(), { channel: "email", contact: { name: "Marta Solís", handle: "marta@dentalsol.test" } }, 500);
    const id = first.id;
    let state = first.state;
    const whatsapp = open(state, { channel: "whatsapp", subject: "WhatsApp de Marta", contact: { name: "Marta Solís", handle: "88881234" }, text: "Hola, soy Marta" }, 400);
    state = whatsapp.state;
    const leadId = ENV.crm?.leads.find((item) => item.name === "Marta Solís")?.id ?? "";
    state = must(state, { ...ANA, at: ago(300), type: "conversation.link", conversationId: id, leadId });
    state = must(state, { ...ANA, at: ago(299), type: "conversation.link", conversationId: whatsapp.id, leadId });
    const timeline = omnichannelTimeline(state, ENV.crm, "tenant-nova", id);
    expect(new Set(timeline.filter((item) => item.source === "comms" && item.direction === "in").map((item) => item.channel))).toEqual(new Set(["email", "whatsapp"]));
    expect(omnichannelTimeline(state, ENV.crm, "tenant-vida", id)).toEqual([]);
  });
});

describe("Customer Context: opened from the conversation, never copied into it", () => {
  const marta = conv(demo, "Propuesta de automatización: cotización final");
  const elena = conv(demo, "Soporte del sitio web");

  it("brings the pipeline, the Business Audit and the Customer 360 from KOE's CRM module, identical to what the CRM says", () => {
    const crm = ENV.crm;
    if (!crm) throw new Error("the sample has a CRM");
    const context = customerContext(demo, crm, "tenant-nova", marta.id, DEMO_NOW);
    const lead = crm.leads.find((item) => item.id === marta.link.leadId);
    expect(context?.pipeline).toEqual(lead ? cardOf(contextOf(crm, lead), DEMO_NOW) : null);
    expect(context?.audits).toHaveLength(crm.audits.filter((item) => item.leadId === lead?.id).length);
    expect(context?.audits.length).toBeGreaterThan(0);
    expect(context?.customer).toBeNull(); // Marta is still a prospect
    const customerContext360 = customerContext(demo, crm, "tenant-nova", elena.id, DEMO_NOW);
    expect(customerContext360?.customer).toEqual(customer360(crm, "tenant-nova", elena.link.customerId ?? "", DEMO_NOW));
    expect(Object.keys(customerContext360?.customer?.links ?? {})).toEqual(["product", "academy", "marketplace", "automation", "worker", "payment", "referral"]);
    expect(customerContext360?.customer?.paidMicros).toBe(3_500_000_000);
  });

  it("stores only references: no payment, product or course data is copied into the conversations", () => {
    const text = JSON.stringify(demo);
    expect(text).not.toMatch(/Pago de implementación|Sitio web|Ventas para clínicas|Refirió a|paidMicros|amountMicros/);
    expect(demo.conversations.every((item) => Object.keys(item.link).every((key) => key === "leadId" || key === "customerId"))).toBe(true);
  });

  it("links only to a prospect or customer of the same company that exists", () => {
    const { id, state } = open();
    const link = (who: { tenantId: string; actor: string }, over: { leadId?: string; customerId?: string }) => step(state, { ...who, at: ago(5), type: "conversation.link", conversationId: id, ...over });
    const lead = ENV.crm?.leads.find((item) => item.tenantId === "tenant-nova")?.id ?? "";
    expect(link(ANA, { leadId: lead }).error).toBeUndefined();
    expect(link(ANA, {}).errorCode).toBe("invalid");
    expect(link(ANA, { leadId: "ld_99999" }).errorCode).toBe("invalid");
    expect(link(ANA, { customerId: "cu_99999" }).errorCode).toBe("invalid");
    const vidaLead = ENV.crm?.leads.find((item) => item.tenantId === "tenant-vida")?.id ?? "";
    expect(link(ANA, { leadId: vidaLead }).errorCode).toBe("invalid"); // another company's prospect
    expect(customerContext(demo, ENV.crm as never, "tenant-vida", marta.id, DEMO_NOW)).toBeNull();
  });
});

describe("channels: SMS is future architecture", () => {
  it("refuses SMS and unknown channels, and validates what is opened", () => {
    expect(CHANNELS).toHaveLength(7);
    expect(CHANNELS_INFO.sms.future).toBe(true);
    expect(CHANNELS.filter((channel) => !CHANNELS_INFO[channel].future)).toHaveLength(6);
    const input: OpenInput = { channel: "email", subject: "x", contact: { name: "A", handle: "a@x.test" }, company: "", text: "Hola" };
    expect(step(newCommsState(), { ...SYSTEM, at: ago(5), type: "conversation.open", input: { ...input, channel: "sms" } }).errorCode).toBe("channelFuture");
    expect(step(newCommsState(), { ...SYSTEM, at: ago(5), type: "conversation.open", input: { ...input, channel: "fax" as never } }).errorCode).toBe("invalid");
    expect(validateOpen({ ...input, subject: " " })[0]).toContain("asunto");
    expect(validateOpen({ ...input, contact: { name: "", handle: "x" } })[0]).toContain("nombre");
    expect(validateOpen({ ...input, text: "" })[0]).toContain("mensaje");
    expect(validateOpen(input)).toEqual([]);
  });
});

describe("one company never sees or changes another's conversations", () => {
  it("scopes the inbox, the stats and the context to its company", () => {
    const vida = inbox(demo, "tenant-vida", DEMO_NOW, {}, ENV.crm);
    expect(vida.map((row) => row.contactName).sort()).toEqual(["Rosa Pineda", "Tomás Ruiz"]);
    expect(commsStats(demo, "tenant-vida", DEMO_NOW, ENV.crm).total).toBe(2);
    expect(JSON.stringify(vida)).not.toMatch(/Marta|Elena|cotización final/);
    expect(demo.routings.filter((item) => item.tenantId === "tenant-vida").every((item) => conversationsOf(demo, "tenant-vida").some((c) => c.id === item.conversationId))).toBe(true);
  });

  it("is unchanged by any amount of another company's conversations", () => {
    const before = JSON.stringify([inbox(demo, "tenant-vida", DEMO_NOW, {}, ENV.crm), commsStats(demo, "tenant-vida", DEMO_NOW, ENV.crm)]);
    let noisy = demo;
    for (let n = 0; n < 6; n += 1) noisy = open(noisy, { subject: `Ruido ${n}`, text: "Quiero cancelar, es urgente, estoy molesto" }, 3_000).state;
    expect(JSON.stringify([inbox(noisy, "tenant-vida", DEMO_NOW, {}, ENV.crm), commsStats(noisy, "tenant-vida", DEMO_NOW, ENV.crm)])).toBe(before);
  });

  it("refuses every change on another company's conversation", () => {
    const id = conv(demo, "Soporte del sitio web").id;
    const draftId = demo.drafts[0].id;
    const events: CommsEvent[] = [
      { ...LUCIA, at: ago(5), type: "conversation.classify", conversationId: id }, { ...LUCIA, at: ago(5), type: "tag.add", conversationId: id, tag: "x" }, { ...LUCIA, at: ago(5), type: "draft.create", conversationId: id },
      { ...LUCIA, at: ago(5), type: "draft.ready", draftId }, { ...LUCIA, at: ago(5), type: "conversation.assign", conversationId: id, assignee: "lucia" }, { ...LUCIA, at: ago(5), type: "status.set", conversationId: id, to: "archived" },
      { ...LUCIA, at: ago(5), type: "message.record", conversationId: id, text: "x" }, { ...LUCIA, at: ago(5), type: "conversation.link", conversationId: id, leadId: "ld_1" },
      { tenantId: "tenant-vida", actor: "system", at: ago(5), type: "message.receive", conversationId: id, text: "x" }, { tenantId: "tenant-vida", actor: "system", at: ago(5), type: "timeline.record", conversationId: id, kind: "worker", text: "x" },
    ];
    for (const event of events) expect(step(demo, event).errorCode, event.type).toBe("notYours");
  });
});

describe("the future is declared and not built", () => {
  it("lists WhatsApp Business API, Meta Messenger, Instagram Graph, Gmail, Microsoft 365, Twilio, telephony and video calls, all through KOE and unbuilt", () => {
    expect(FUTURE_CONNECTORS.map((item) => item.id)).toEqual(["whatsappBusiness", "metaMessenger", "instagramGraph", "gmail", "microsoft365", "twilio", "telephony", "videoCalls"]);
    for (const item of FUTURE_CONNECTORS) expect(item).toMatchObject({ status: "notBuilt", goesThrough: "KOE", direct: false });
    const code = ["koe-comms.ts", "comms-center.ts"].map((name) => readFileSync(join(__dirname, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")).join("\n");
    expect(code).not.toMatch(/fetch\(|XMLHttpRequest|process\.env|import\(|lib\/ai|new WebSocket|twilio\.|graph\.facebook/i);
    expect(code).not.toMatch(/function\s+(send|connect|dial|call)/i);
  });
});

describe("language", () => {
  it("has a message for every error code and Spanish labels", () => {
    for (const code of ERROR_CODES) expect(message(code, { detail: "x", status: "cerrada" }), code).not.toMatch(/\{\w+\}/);
    expect(label("channel", "messenger")).toBe("Facebook Messenger");
    expect(label("channel", "sms")).toContain("arquitectura futura");
    expect(label("status", "resolved")).toBe("Resuelta");
    expect(label("nextBest", "escalate")).toBe("Escalar");
    expect(label("tabs", "intelligence")).toBe("Inteligencia");
    expect(message("closedConversation", { status: "archivada" })).toBe("La conversación está archivada; reábrala antes de cambiarla.");
  });
});
