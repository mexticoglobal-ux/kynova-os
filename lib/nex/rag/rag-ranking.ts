// RAG Ranking: every candidate gets a score from 0 to 100 made of relevance, confidence, importance, recency, frequency, centrality, distance in the graph and feedback. Pure and
// deterministic: the clock is handed in. A question about the past ("histórico") makes old knowledge count much longer.

import type { ItemStats, QueryAnalysis, RagItem, RankedItem } from "./rag-types";

/** The most each factor can give: they add up to 100. */
export const RAG_WEIGHTS = { relevance: 30, confidence: 10, importance: 12, recency: 10, frequency: 8, centrality: 10, distance: 10, feedback: 10 } as const;
/** A candidate whose KIND fits the question gets up to this many points of relevance even if no word matched. */
export const AFFINITY_BONUS = 15;
export const HALF_LIFE_DAYS = 30;
export const HISTORY_HALF_LIFE_DAYS = 365;
const DAY = 86_400_000;
const clamp = (value: number) => Math.max(0, Math.min(1, value));

export const statsKey = (tenantId: string, itemKey: string): string => `${tenantId}|${itemKey}`;
const votesOf = (stats: ItemStats | undefined) => {
  const values = Object.values(stats?.votes ?? {});
  return { up: values.filter((value) => value === "up").length, down: values.filter((value) => value === "down").length };
};

export function rankItem(item: RagItem, analysis: QueryAnalysis, stats: Readonly<Record<string, ItemStats>>, nowMs: number): RankedItem {
  const w = RAG_WEIGHTS;
  const own = stats[statsKey(item.tenantId, item.key)];
  const votes = votesOf(own);
  const up = item.signals.up + votes.up;
  const down = item.signals.down + votes.down;
  const idleDays = Math.max(0, (nowMs - Date.parse(item.touchedAt)) / DAY);
  const halfLife = analysis.history ? HISTORY_HALF_LIFE_DAYS : HALF_LIFE_DAYS;
  const parts = {
    relevance: w.relevance * clamp((item.signals.text + AFFINITY_BONUS * item.signals.affinity) / 100),
    confidence: w.confidence * clamp(item.confidence / 100),
    importance: w.importance * clamp(item.importance / 100),
    recency: w.recency * 0.5 ** (idleDays / halfLife),
    // how often it has been used, and how often this engine has already served it
    frequency: w.frequency * clamp(Math.log2(1 + item.signals.uses + (own?.retrieved ?? 0)) / Math.log2(31)),
    centrality: w.centrality * clamp(item.signals.centrality),
    // what matched directly is at distance 0; what the graph relates to it counts less the farther it is
    distance: w.distance * (1 / (1 + item.signals.distance)),
    // smoothed: one vote moves the score, it does not decide it
    feedback: w.feedback * ((up + 1) / (up + down + 2)),
  };
  const factors = (Object.keys(parts) as (keyof typeof parts)[]).map((name) => ({ name, points: Math.round(parts[name] * 10) / 10, max: w[name] }));
  return { ...item, factors, score: Math.round(factors.reduce((total, row) => total + row.points, 0) * 10) / 10 };
}

/** Scores the candidates, drops those below `minScore`, and orders them: score, then importance, then key (so ties never change). */
export function rankCandidates(items: readonly RagItem[], analysis: QueryAnalysis, stats: Readonly<Record<string, ItemStats>>, nowMs: number, minScore: number): RankedItem[] {
  return items.map((item) => rankItem(item, analysis, stats, nowMs)).filter((item) => item.score >= minScore).sort((a, b) => b.score - a.score || b.importance - a.importance || a.key.localeCompare(b.key));
}
