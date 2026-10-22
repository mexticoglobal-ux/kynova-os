/**
 * Company Health: a rules-only, fully explainable score. No AI, no machine learning. Inputs are plain percentages gathered by the composition root;
 * this file knows no other system. A component that does not apply (no connector exists yet) is left out and the weights of the rest are rebalanced.
 */
export const HEALTH_COMPONENTS = ["profile", "dna", "integrations", "team", "blueprint"] as const;
export type HealthComponent = (typeof HEALTH_COMPONENTS)[number];
export const WEIGHTS: Readonly<Record<HealthComponent, number>> = { profile: 25, dna: 20, integrations: 20, team: 20, blueprint: 15 };
export const LEVELS = ["excellent", "healthy", "attention", "risk", "critical"] as const;
export type HealthLevel = (typeof LEVELS)[number];
/** Lower bounds, highest first. */
export const THRESHOLDS: readonly (readonly [HealthLevel, number])[] = [["excellent", 90], ["healthy", 75], ["attention", 55], ["risk", 35], ["critical", 0]];

export interface HealthInput {
  profilePct: number; dnaPct: number; blueprintPct: number; teamPct: number;
  integrations: { available: number; connected: number; pending: number };
}
export interface HealthPart { key: HealthComponent; pct: number | null; weight: number; /** Share of the final score this part contributes. */ points: number; /** Points lost to this part being below 100%. */ lost: number }
export interface CompanyHealth { score: number; level: HealthLevel; parts: HealthPart[]; /** Largest losses first: the exact reasons the score is not 100. */ gaps: HealthPart[] }
const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(Number.isFinite(n) ? n : 0)));
export const levelOf = (score: number): HealthLevel => THRESHOLDS.find(([, min]) => score >= min)![0];

export function companyHealth(i: HealthInput): CompanyHealth {
  const ig = i.integrations, integrations = ig.available > 0 ? clamp(((ig.connected + 0.5 * ig.pending) / ig.available) * 100) : null;
  const pcts: Record<HealthComponent, number | null> = { profile: clamp(i.profilePct), dna: clamp(i.dnaPct), integrations, team: clamp(i.teamPct), blueprint: clamp(i.blueprintPct) };
  const used = HEALTH_COMPONENTS.filter((k) => pcts[k] !== null), total = used.reduce((s, k) => s + WEIGHTS[k], 0);
  const parts: HealthPart[] = HEALTH_COMPONENTS.map((key) => {
    const pct = pcts[key], share = pct === null ? 0 : (WEIGHTS[key] / total) * 100;
    return { key, pct, weight: pct === null ? 0 : Math.round(share), points: pct === null ? 0 : (pct * share) / 100, lost: pct === null ? 0 : ((100 - pct) * share) / 100 };
  });
  const score = clamp(parts.reduce((s, p) => s + p.points, 0));
  return { score, level: levelOf(score), parts, gaps: parts.filter((p) => p.lost > 0).sort((a, b) => b.lost - a.lost) };
}
