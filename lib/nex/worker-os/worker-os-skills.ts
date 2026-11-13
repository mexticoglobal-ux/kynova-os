// Worker OS Skills: how good a Worker is at each area, from 0 to 100 (SEO 85, Marketing 90, CRM 60). Skills are named after the catalog, are whole numbers, and are never duplicated. A skill is evidence of
// ability, not an authorization: it grants nothing by itself. Pure.

import type { Checked } from "./worker-os-capabilities";
import { SKILL_IDS, type Skill } from "./worker-os-types";

export const isSkillId = (id: string): boolean => (SKILL_IDS as readonly string[]).includes(id);
/** Exactly `{id, level}` for each, known ids only, integer levels 0–100, no duplicates; sorted so the same set is always the same list. */
export function checkSkills(list: unknown): Checked<Skill[]> {
  if (!Array.isArray(list) || list.length > SKILL_IDS.length) return { ok: false, error: "skills.shape" };
  const seen = new Set<string>();
  const value: Skill[] = [];
  for (const entry of list as unknown[]) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return { ok: false, error: "skills.shape" };
    const keys = Object.keys(entry);
    const { id, level } = entry as { id?: unknown; level?: unknown };
    if (keys.length !== 2 || !keys.includes("id") || !keys.includes("level")) return { ok: false, error: "skills.schema" };
    if (typeof id !== "string" || !isSkillId(id)) return { ok: false, error: "skills.unknown" };
    if (typeof level !== "number" || !Number.isInteger(level) || level < 0 || level > 100) return { ok: false, error: "skills.level" };
    if (seen.has(id)) return { ok: false, error: "skills.duplicate" };
    seen.add(id);
    value.push({ id, level });
  }
  return { ok: true, value: value.sort((a, b) => a.id.localeCompare(b.id)) };
}
/** The level a worker has in a skill; a skill it does not declare is not 0, it is absent. */
export const skillLevel = (skills: readonly Skill[], id: string): number | undefined => skills.find((entry) => entry.id === id)?.level;
export const meetsSkill = (skills: readonly Skill[], id: string, min: number): boolean => (skillLevel(skills, id) ?? -1) >= min;
