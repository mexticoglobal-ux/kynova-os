// Stop: reminds once per change set to update docs/STATE.md when code changed and memory did not.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
if (input.stop_hook_active) process.exit(0);

const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  cwd: projectDir,
  encoding: 'utf8',
});
if (status.status !== 0) process.exit(0);

const changedPaths = status.stdout
  .split('\n')
  .filter(Boolean)
  .map((line) => line.slice(3).split(' -> ').pop().replace(/^"|"$/g, ''));

if (changedPaths.includes('docs/STATE.md')) process.exit(0);

const codePaths = changedPaths
  .filter((path) => /^(?:app|components|lib|config|types|supabase|prompts)\/|^middleware\.ts$/.test(path))
  .sort();
if (codePaths.length === 0) process.exit(0);

const marker = join(tmpdir(), `kaf-memory-${input.session_id || 'default'}.txt`);
const fingerprint = codePaths.join('\n');
if (existsSync(marker) && readFileSync(marker, 'utf8') === fingerprint) process.exit(0);
writeFileSync(marker, fingerprint);

process.stderr.write(
  'KAF memoria: hay cambios de código sin reflejo en docs/STATE.md. ' +
    'Si la tarea fue M o L, aplica el paso 9 (Memorizar) de AGENTS.md §4; si fue S, termina sin cambios.\n',
);
process.exit(2);
