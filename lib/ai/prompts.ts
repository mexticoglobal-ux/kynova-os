// The versioned prompts as the Workers runtime reads them: from the module generated out of prompts/**/*.md (scripts/generate-prompts.mjs), because a Worker has no file system.
// The Markdown files are the source; this is the only way code gets a prompt's instructions (rules/ai.md 3). A prompt that is not `active` is never handed out for real use:
// a draft prompt is for evals and tests, and asking for it without saying so returns null.

import { PROMPTS, type GeneratedPrompt } from "./prompts.generated";

export type LoadedPrompt = GeneratedPrompt & { id: string };

/** A prompt by id, whatever its status (for evals, tooling and tests). */
export function loadPrompt(id: string): LoadedPrompt | null {
  const entry = PROMPTS[id];
  return entry ? { id, ...entry } : null;
}

/** The system instructions of an ACTIVE prompt; a draft or deprecated one answers null unless the caller explicitly allows drafts (evals and tests do). */
export function instructionsOf(id: string, options: { allowDraft?: boolean } = {}): string | null {
  const prompt = loadPrompt(id);
  if (!prompt) return null;
  return prompt.status === "active" || (options.allowDraft === true && prompt.status === "draft") ? prompt.instructions : null;
}
