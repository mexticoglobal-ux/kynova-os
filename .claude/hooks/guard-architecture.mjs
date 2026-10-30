// PreToolUse (Edit|Write|MultiEdit): blocks edits that break AGENTS.md §7.2 or write migrations without an ADR.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const toolInput = input.tool_input || {};

const filePath = toolInput.file_path;
if (!filePath) process.exit(0);

const absolutePath = isAbsolute(filePath) ? filePath : resolve(projectDir, filePath);
const relPath = relative(projectDir, absolutePath).replace(/\\/g, '/');

const newContent = [
  toolInput.content,
  toolInput.new_string,
  ...(toolInput.edits || []).map((edit) => edit.new_string),
].filter(Boolean).join('\n');

function block(message) {
  process.stderr.write(`KAF guard: ${message}\n`);
  process.exit(2);
}

const AI_SDKS = String.raw`@anthropic-ai/sdk|openai|@google/genai|@google/generative-ai|@mistralai/[\w-]+|cohere-ai|groq-sdk|@ai-sdk/[\w-]+`;
const importsAiSdk = new RegExp(String.raw`(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:${AI_SDKS})(?:/[^'"]*)?['"]`);
const isCode = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(relPath);

if (isCode && !relPath.startsWith('lib/ai/') && importsAiSdk.test(newContent)) {
  block(`${relPath} importa un SDK de proveedor de IA fuera de lib/ai/ (AGENTS.md §7.2). Usa la interfaz de lib/ai/.`);
}

if (relPath.startsWith('supabase/migrations/')) {
  const transcriptPath = input.transcript_path;
  const transcript = transcriptPath && existsSync(transcriptPath) ? readFileSync(transcriptPath, 'utf8') : '';
  if (!/docs[\\/]+decisions[\\/]+(?!0000-)\d{4}-/.test(transcript)) {
    block('las migraciones requieren workflow W3 con un ADR de docs/decisions/ referenciado en esta sesión (AGENTS.md §5).');
  }
}

process.exit(0);
