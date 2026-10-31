import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const varsPath = path.join(root, ".dev.vars");
const vars = await readFile(varsPath, "utf8").catch(() => "");
const line = vars.split(/\r?\n/).find((entry) => /^\s*SPIKE_SECRET_CANARY\s*=/.test(entry));
const canary = process.env.SPIKE_SECRET_CANARY?.trim() || line?.slice(line.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "");

if (!canary) {
  process.stderr.write("Canary check could not run: SPIKE_SECRET_CANARY is missing from .dev.vars.\n");
  process.exit(2);
}

const roots = [path.join(root, ".next", "static"), path.join(root, ".open-next", "assets")];
let scanned = 0;

async function scan(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await scan(target);
    else {
      const content = await readFile(target).catch(() => null);
      if (content) {
        scanned += 1;
        if (content.includes(Buffer.from(canary))) {
          process.stderr.write("Canary check failed: the canary appears in a browser asset.\n");
          process.exit(1);
        }
      }
    }
  }
}

for (const directory of roots) await scan(directory);
if (scanned === 0) {
  process.stderr.write("Canary check could not run: no browser assets were found. Build the app first.\n");
  process.exit(2);
}

process.stdout.write(`Canary check passed: scanned ${scanned} browser assets; no value was printed.\n`);
