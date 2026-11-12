// Memory Ranking: every memory has a score from 0 to 100 made of importance, use, recency, frequency, feedback and reliability. Pure and deterministic: the clock is handed in.

import type { Memory } from "./memory-types";

/** The most each factor can give: they add up to 100. */
export const RANK_WEIGHTS = { importance: 25, usage: 15, recency: 20, frequency: 10, feedback: 15, reliability: 15 } as const;
export const RECENCY_HALF_LIFE_DAYS = 30;
const SOURCE_WEIGHT = { person: 1, system: 1, worker: 0.85, import: 0.7 } as const;
const DAY = 86_400_000;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export type RankFactor = { name: keyof typeof RANK_WEIGHTS; points: number; max: number };
export type Rank = { score: number; factors: readonly RankFactor[] };

export const voteCounts = (memory: Memory): { up: number; down: number } => {
  const values = Object.values(memory.votes);
  return { up: values.filter((value) => value === "up").length, down: values.filter((value) => value === "down").length };
};

export function rankMemory(memory: Memory, nowMs: number): Rank {
  const w = RANK_WEIGHTS;
  const touched = Math.max(Date.parse(memory.updatedAt), memory.lastUsedAt ? Date.parse(memory.lastUsedAt) : 0);
  const idleDays = Math.max(0, (nowMs - touched) / DAY);
  const ageDays = Math.max(0, (nowMs - Date.parse(memory.createdAt)) / DAY);
  const { up, down } = voteCounts(memory);
  const parts = {
    importance: w.importance * clamp(memory.importance / 100),
    usage: w.usage * clamp(Math.log2(1 + memory.uses) / Math.log2(21)),
    recency: w.recency * 0.5 ** (idleDays / RECENCY_HALF_LIFE_DAYS),
    // about one use a week or more is "frequent"
    frequency: w.frequency * clamp((memory.uses / (ageDays + 7)) * 7),
    // the vote is smoothed: one vote moves the score, it does not decide it
    feedback: w.feedback * ((up + 1) / (up + down + 2)),
    reliability: w.reliability * clamp(memory.confidence / 100) * SOURCE_WEIGHT[memory.source.kind],
  };
  const factors = (Object.keys(parts) as (keyof typeof parts)[]).map((name) => ({ name, points: Math.round(parts[name] * 10) / 10, max: w[name] }));
  // an archived memory still ranks, but below what is alive
  const penalty = memory.status === "active" ? 1 : 0.5;
  return { score: Math.round(factors.reduce((total, row) => total + row.points, 0) * penalty * 10) / 10, factors };
}
