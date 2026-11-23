// The command line of the first-work evals. By default it is a DRY-RUN: it validates the suite and the fixtures, prints the plan and makes no call of any kind.
// The real mode needs `--real` AND an explicit confirmation variable (see lib/ai/evals-cli.ts and docs/modules/nex-primera-prueba-ia.md). Run it with: npm run evals:first-work [-- --real]
import { readFileSync } from "node:fs";
import { runEvalsCli } from "@/lib/ai/evals-cli";

const read = (path: string): string => readFileSync(path, "utf8");
const code = await runEvalsCli({
  argv: process.argv.slice(2),
  env: process.env,
  suiteYaml: read("prompts/evals/nex/first-work-draft.yaml"),
  fixtureYaml: read("prompts/evals/fixtures/first-work-draft.yaml"),
  io: { out: (line) => process.stdout.write(`${line}\n`), err: (line) => console.error(line) },
});
process.exit(code);
