// PostToolUse (Edit|Write|MultiEdit): runs typecheck and lint after code edits and reports failures to Claude.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const MAX_OUTPUT = 4000;

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const filePath = input.tool_input?.file_path;
if (!filePath) process.exit(0);

const absolutePath = isAbsolute(filePath) ? filePath : resolve(projectDir, filePath);
const relPath = relative(projectDir, absolutePath).replace(/\\/g, '/');

if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relPath) || relPath.startsWith('.claude/')) process.exit(0);
if (!existsSync(absolutePath)) process.exit(0);

const hasPackage = (name) => existsSync(join(projectDir, 'node_modules', name));
if (!existsSync(join(projectDir, 'node_modules'))) process.exit(0);

const quote = (arg) => `"${arg.replace(/"/g, '\\"')}"`;

function run(args) {
  const result = spawnSync(['npx', '--no-install', ...args].map(quote).join(' '), {
    cwd: projectDir,
    encoding: 'utf8',
    shell: true,
  });
  return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}`.trim() };
}

const failures = [];

if (hasPackage('typescript')) {
  const typecheck = run(['tsc', '--noEmit', '--pretty', 'false']);
  if (!typecheck.ok) failures.push(`Typecheck:\n${typecheck.output}`);
}

const hasEslintConfig = readdirSync(projectDir).some((name) => /^(?:eslint\.config\.[cm]?[jt]s|\.eslintrc(?:\..+)?)$/.test(name));
if (hasPackage('eslint') && hasEslintConfig) {
  const lint = run(['eslint', '--max-warnings', '0', relPath]);
  if (!lint.ok) failures.push(`Lint (${relPath}):\n${lint.output}`);
}

if (failures.length > 0) {
  const report = failures.join('\n\n');
  process.stderr.write(`KAF verify: corrige antes de continuar.\n${report.slice(0, MAX_OUTPUT)}\n`);
  process.exit(2);
}

process.exit(0);
