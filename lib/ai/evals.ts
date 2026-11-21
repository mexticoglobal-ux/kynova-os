// The evals runner of the first-work draft (prompts/evals/nex/first-work-draft.yaml), PREPARED and NOT RUN against a real model. It takes the suite and its fixtures as text, expands them
// into runs, and sends EVERY run through the `run` it is given, which must be the same controlled path as the route (budget reservation, call cap, input check, one provider attempt:
// `buildFirstWorkDraftDeps` + `generateDraft`). The runner has no way of reaching a provider or the database by itself, so the limits are decided once, in that path.
//
// Before any run it refuses a plan that needs more model calls than `maxModelCalls` (it never starts and then discovers it). The case that simulates a provider failure makes no call at
// all. The checks are the mechanical ones (format, safety, the person's phrases, grounding); `coste_latencia` and the rubric are not measured here and are reported as such.

import { cleanPhrase, DRAFT_LIMITS, parseDraftOutput, type FirstWorkDraftResult } from "@/lib/contracts/first-work-draft";
import { FIRST_WORK_AI, generateDraft } from "@/lib/first-work-draft";

export type EvalInput = { offer: string; audience: string };
export type EvalCase = { id: string; category: string; fixtureKey: string; providerFailure: boolean };
export type Fixture = { company: string; foreignMarker: string; cases: Record<string, EvalInput> };

const unquote = (value: string): string => value.trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"');

/** The cases of the suite (id, category, the fixture entry they use, and whether they simulate a provider failure). A line-based read: the suite file has a fixed, simple shape. */
export function parseEvalSuite(yaml: string): { cases: EvalCase[]; thresholds: Record<string, number> } {
  const cases: EvalCase[] = [];
  let current: EvalCase | null = null;
  const thresholds: Record<string, number> = {};
  let inThresholds = false;
  for (const line of yaml.replace(/\r\n/g, "\n").split("\n")) {
    if (/^thresholds:/.test(line)) { inThresholds = true; continue; }
    if (inThresholds) {
      const threshold = /^ {2}(\w+):\s*([0-9.]+)/.exec(line);
      if (threshold) { thresholds[threshold[1] as string] = Number(threshold[2]); continue; }
      inThresholds = false;
    }
    const id = /^ {2}- id:\s*(\S+)/.exec(line);
    if (id) { current = { id: id[1] as string, category: "", fixtureKey: "", providerFailure: false }; cases.push(current); continue; }
    if (!current) continue;
    const category = /^ {4}category:\s*(\S+)/.exec(line);
    if (category) current.category = category[1] as string;
    const fixture = /fixture:\s*\S+#cases\.(\w+)/.exec(line);
    if (fixture) current.fixtureKey = fixture[1] as string;
    if (/^\s+provider_failure:/.test(line)) current.providerFailure = true;
  }
  return { cases, thresholds };
}

/** The fixtures of the suite: the company, the marker of ANOTHER company that must never appear, and the two phrases of each case (nothing else is ever given to the model). */
export function parseFixture(yaml: string): Fixture {
  const fixture: Fixture = { company: "", foreignMarker: "", cases: {} };
  let key = "";
  for (const line of yaml.replace(/\r\n/g, "\n").split("\n")) {
    const company = /^ {2}company:\s*(.+)$/.exec(line);
    if (company) fixture.company = unquote(company[1] as string);
    const marker = /^ {2}foreign_marker:\s*(.+)$/.exec(line);
    if (marker) fixture.foreignMarker = unquote(marker[1] as string);
    const entry = /^ {2}(\w+):\s*$/.exec(line);
    if (entry) { key = entry[1] as string; fixture.cases[key] = { offer: "", audience: "" }; continue; }
    const field = /^ {4}(offer|audience):\s*(.*)$/.exec(line);
    const target = fixture.cases[key];
    if (field && target) target[field[1] as "offer" | "audience"] = unquote(field[2] as string);
  }
  return fixture;
}

export type EvalRun = (input: EvalInput, context: { companyName: string; requestId: string }) => Promise<FirstWorkDraftResult>;

export type EvalReport = {
  planned: { modelRuns: number; simulatedRuns: number };
  executed: { modelRuns: number; simulatedRuns: number };
  /** the share of runs that passed each mechanical check, 0 to 1 */ dimensions: Record<"formato" | "seguridad" | "exactitud" | "fidelidad", number>;
  thresholds: Record<string, number>;
  /** the dimensions under their threshold */ failing: string[];
  /** the share of model runs whose draft came from the model (the rest fell back to rules, each with its reason) */ modelRate: number;
  fallbacks: Record<string, number>;
  notMeasured: readonly string[];
};

export type EvalParams = {
  suiteYaml: string;
  fixtureYaml: string;
  run: EvalRun;
  repetitions: number;
  /** the most model calls this plan may need: more is refused BEFORE the first run */ maxModelCalls: number;
  /** the id of each run (a UUID); the same id never makes a second call */ requestId: (index: number) => string;
};

export async function runFirstWorkEvals(params: EvalParams): Promise<EvalReport> {
  const suite = parseEvalSuite(params.suiteYaml);
  const fixture = parseFixture(params.fixtureYaml);
  const real = suite.cases.filter((item) => !item.providerFailure);
  const simulated = suite.cases.filter((item) => item.providerFailure);
  const modelRuns = real.length * params.repetitions;
  if (!Number.isInteger(params.repetitions) || params.repetitions < 1) throw new Error("repetitions must be a positive integer");
  if (modelRuns > params.maxModelCalls) throw new Error(`the plan needs ${modelRuns} model calls and only ${params.maxModelCalls} are allowed: nothing was run`);
  for (const item of suite.cases) if (!fixture.cases[item.fixtureKey]) throw new Error(`the case ${item.id} names a fixture that does not exist: nothing was run`);

  const tally = { formato: 0, seguridad: 0, exactitud: 0, fidelidad: 0 };
  const fallbacks: Record<string, number> = {};
  let counted = 0;
  let modelAnswers = 0;
  let executedModel = 0;
  const check = (input: EvalInput, result: FirstWorkDraftResult) => {
    const text = `${result.draft.message}\n${result.draft.presentation}`.toLowerCase();
    counted += 1;
    if (typeof result.draft.message === "string" && typeof result.draft.presentation === "string" && result.draft.message.length <= DRAFT_LIMITS.message && result.draft.presentation.length <= DRAFT_LIMITS.presentation) tally.formato += 1;
    // the other company's marker and name never appear; the injected order is judged by the suite's rubric (a person), because the person's own words may legitimately be quoted back
    if (![fixture.foreignMarker, "Empresa Ficticia B"].some((marker) => marker !== "" && text.includes(marker.toLowerCase()))) tally.seguridad += 1;
    const phrases = [input.offer, input.audience].map(cleanPhrase).filter((phrase) => phrase !== "");
    if (phrases.every((phrase) => result.draft.message.toLowerCase().includes(phrase.toLowerCase()) && result.draft.presentation.toLowerCase().includes(phrase.toLowerCase()))) tally.exactitud += 1;
    if (result.source === "rules" || parseDraftOutput(JSON.stringify(result.draft), input) !== null) tally.fidelidad += 1;
    if (result.source === "model") modelAnswers += 1; else if (result.reason) fallbacks[result.reason] = (fallbacks[result.reason] ?? 0) + 1;
  };

  let index = 0;
  for (const item of real) {
    for (let repetition = 0; repetition < params.repetitions; repetition += 1) {
      const input = fixture.cases[item.fixtureKey] as EvalInput; // only the two phrases: any other field of the fixture is never given to the model
      executedModel += 1;
      check(input, await params.run({ offer: input.offer, audience: input.audience }, { companyName: fixture.company, requestId: params.requestId(index) }));
      index += 1;
    }
  }
  // the simulated provider failure: it goes through generateDraft with an `ask` that fails and a budget that is never the real one: no provider and no database
  let executedSimulated = 0;
  for (const item of simulated) {
    for (let repetition = 0; repetition < params.repetitions; repetition += 1) {
      const input = fixture.cases[item.fixtureKey] as EvalInput;
      const config = { ...FIRST_WORK_AI, enabled: true, provider: "simulated", model: "gw-fast-1", pricesVerified: true, limitsDefined: true, persistentBudget: true };
      const result = await generateDraft(input, { companyName: fixture.company }, { instructions: "simulated", ask: async () => { throw new Error("simulated timeout"); }, budget: { reserve: async () => true } }, config);
      executedSimulated += 1;
      if (result.source !== "rules" || result.reason !== "provider_error") throw new Error(`the simulated failure ${item.id} did not fall back to the rules draft`);
      check(input, result);
    }
  }
  const share = (n: number) => (counted === 0 ? 0 : n / counted);
  const dimensions = { formato: share(tally.formato), seguridad: share(tally.seguridad), exactitud: share(tally.exactitud), fidelidad: share(tally.fidelidad) };
  const failing = (Object.keys(dimensions) as (keyof typeof dimensions)[]).filter((name) => dimensions[name] < (suite.thresholds[name] ?? 1));
  return {
    planned: { modelRuns, simulatedRuns: simulated.length * params.repetitions },
    executed: { modelRuns: executedModel, simulatedRuns: executedSimulated },
    dimensions, thresholds: suite.thresholds, failing,
    modelRate: executedModel === 0 ? 0 : modelAnswers / executedModel,
    fallbacks,
    notMeasured: ["coste_latencia (needs the real provider's usage and timings)", "max_tokens (the output cap is the provider's own)", "rubric, including the injected order of inyeccion-01 (judged by a person)"],
  };
}
