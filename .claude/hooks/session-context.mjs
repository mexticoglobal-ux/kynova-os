// SessionStart: injects the current branch and the "Trabajo en curso" section of docs/STATE.md.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const branch = spawnSync('git', ['branch', '--show-current'], { cwd: projectDir, encoding: 'utf8' })
  .stdout?.trim() || 'desconocida';

const lines = [`KAF · rama actual: ${branch}`];

const statePath = join(projectDir, 'docs', 'STATE.md');
if (existsSync(statePath)) {
  const state = readFileSync(statePath, 'utf8');
  const match = state.match(/^## \d+\. Trabajo en curso\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (match && match[1].trim()) {
    lines.push('Trabajo en curso (docs/STATE.md):', match[1].trim());
  }
}

process.stdout.write(lines.join('\n') + '\n');
