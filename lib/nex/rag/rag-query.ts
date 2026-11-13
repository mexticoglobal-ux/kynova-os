// Query Analyzer: turns a question into its meaningful words and says what it is about (information, customer, company, document, workflow, finance, sales, marketing, operations,
// preferences, history). Rule based, so the same question always gets the same analysis, whatever the case, the accents or the order of the words.

import { tokenize } from "@/lib/nex/memory";
import { INTENTS, type Intent, type QueryAnalysis } from "./rag-types";

const WORDS: Readonly<Record<Exclude<Intent, "information">, readonly string[]>> = {
  customer: ["cliente", "clientes", "customer", "customers", "comprador", "contacto", "lead", "prospecto", "cuenta", "usuario"],
  company: ["empresa", "compañía", "negocio", "organización", "company", "business", "equipo", "misión", "visión", "horario", "servicio", "servicios", "oficina"],
  document: ["documento", "documentos", "manual", "archivo", "contrato", "propuesta", "política", "guía", "document", "file", "contract", "proposal", "informe"],
  workflow: ["proceso", "procesos", "flujo", "workflow", "automatización", "automatizar", "paso", "pasos", "procedimiento", "process", "automation", "onboarding"],
  finance: ["factura", "facturas", "pago", "pagos", "cobro", "precio", "precios", "costo", "costos", "presupuesto", "finanzas", "ingreso", "gasto", "invoice", "payment", "price", "budget", "billing", "cotización"],
  sales: ["venta", "ventas", "vender", "oferta", "descuento", "cierre", "pipeline", "oportunidad", "sales", "deal", "quote"],
  marketing: ["marketing", "campaña", "campañas", "anuncio", "contenido", "redes", "publicidad", "seo", "campaign", "ads", "social"],
  operations: ["operación", "operaciones", "tarea", "tareas", "entrega", "inventario", "logística", "soporte", "operations", "task", "support"],
  preferences: ["prefiere", "prefieren", "preferencia", "preferencias", "gusta", "tono", "estilo", "formal", "preference", "prefers", "likes"],
  history: ["historial", "histórico", "antes", "anterior", "pasado", "previo", "último", "última", "history", "previous", "last", "anteriormente", "hace"],
};
/** The same folding the memory index uses, so a word in the question and the same word in a memory become the same term. */
const LEXICON: ReadonlyMap<Exclude<Intent, "information">, ReadonlySet<string>> = new Map(
  (Object.keys(WORDS) as Exclude<Intent, "information">[]).map((intent) => [intent, new Set(WORDS[intent].flatMap((word) => tokenize(word)))]),
);

const MAX_INTENTS = 3;

export function analyzeQuery(text: string): QueryAnalysis {
  const terms = [...new Set(tokenize(text))];
  const scored = INTENTS.filter((intent): intent is Exclude<Intent, "information"> => intent !== "information")
    .map((intent) => ({ intent, score: terms.filter((term) => LEXICON.get(intent)?.has(term)).length }))
    .filter((row) => row.score > 0);
  // the intent that matches the most words first; a tie keeps the fixed order of INTENTS
  scored.sort((a, b) => b.score - a.score || INTENTS.indexOf(a.intent) - INTENTS.indexOf(b.intent));
  const intents: Intent[] = scored.slice(0, MAX_INTENTS).map((row) => row.intent);
  if (intents.length === 0) intents.push("information");
  return { terms, intents, primary: intents[0] as Intent, history: intents.includes("history") };
}

/** The question as the cache sees it: its terms in a fixed order, so word order, case and accents do not matter. */
export const canonicalTerms = (analysis: QueryAnalysis): string => [...analysis.terms].sort().join(" ");
