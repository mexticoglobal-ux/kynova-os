// Worker OS Dashboard: the numbers a screen would draw, as plain data (no UI): workers, versions, specialties, capabilities, skills, tools, compatibility, pending upgrades, rollbacks available and health.
// Only ONE company's workers go in and only that company's numbers come out; ids and counts, never the content of anything. Pure.

import { compatibility } from "./worker-os-policy";
import { CAPABILITY_IDS, SKILL_IDS, SPECIALTIES, TOOL_IDS, type WorkerConfigLike, type WorkerRecord } from "./worker-os-types";

export type WorkerOsDashboard = {
  tenantId: string; at: string;
  workers: { total: number; active: number; blocked: number };
  versions: Record<string, number>;
  specialties: Record<string, number>;
  capabilities: Record<string, number>;
  skills: Record<string, { workers: number; average: number }>;
  tools: Record<string, number>;
  compatibility: { compatible: number; incompatible: number; issues: Record<string, number>; blocked: string[] };
  pendingUpgrades: { total: number; requested: number; approved: number; workers: { workerId: string; state: string; to: string }[] };
  rollbacksAvailable: { total: number; workers: { workerId: string; to: string }[] };
  health: { average: number; reported: number; unreported: number; lowest: { workerId: string; score: number }[] };
};
const round1 = (value: number): number => Math.round(value * 10) / 10;

export function buildWorkerOsDashboard(input: { tenantId: string; at: string; workers: readonly WorkerRecord[]; config: WorkerConfigLike }): WorkerOsDashboard {
  const { tenantId, at, config } = input;
  // one company: whatever belongs to another does not exist here
  const workers = input.workers.filter((worker) => worker.companyId === tenantId).sort((a, b) => a.workerId.localeCompare(b.workerId));
  const versions: Record<string, number> = {};
  const specialties = Object.fromEntries(SPECIALTIES.map((id) => [id, 0])) as Record<string, number>;
  const capabilities = Object.fromEntries(CAPABILITY_IDS.map((id) => [id, 0])) as Record<string, number>;
  const tools = Object.fromEntries(TOOL_IDS.map((id) => [id, 0])) as Record<string, number>;
  const skillSums = new Map<string, { workers: number; total: number }>();
  const issues: Record<string, number> = {};
  const blocked: string[] = [];
  let compatible = 0;
  for (const worker of workers) {
    versions[worker.version] = (versions[worker.version] ?? 0) + 1;
    specialties[worker.specialty] = (specialties[worker.specialty] ?? 0) + 1;
    for (const capability of worker.capabilities) capabilities[capability.id] = (capabilities[capability.id] ?? 0) + 1;
    for (const tool of worker.tools) tools[tool] = (tools[tool] ?? 0) + 1;
    for (const skill of worker.skills) { const row = skillSums.get(skill.id) ?? { workers: 0, total: 0 }; row.workers += 1; row.total += skill.level; skillSums.set(skill.id, row); }
    const found = compatibility(worker, worker.capabilities, config);
    if (found.length === 0) compatible += 1; else { blocked.push(worker.workerId); for (const issue of found) issues[issue] = (issues[issue] ?? 0) + 1; }
  }
  const skills = Object.fromEntries(SKILL_IDS.map((id) => { const row = skillSums.get(id); return [id, { workers: row?.workers ?? 0, average: row ? round1(row.total / row.workers) : 0 }]; }));
  const pending = workers.filter((worker) => worker.upgrade !== undefined);
  const scored = workers.filter((worker) => worker.health !== undefined).map((worker) => ({ workerId: worker.workerId, score: worker.health?.score ?? 0 }));
  return {
    tenantId, at,
    workers: { total: workers.length, active: workers.filter((worker) => worker.status === "Active").length, blocked: workers.filter((worker) => worker.status === "Blocked").length },
    versions, specialties, capabilities, skills, tools,
    compatibility: { compatible, incompatible: workers.length - compatible, issues, blocked },
    pendingUpgrades: {
      total: pending.length, requested: pending.filter((worker) => worker.upgrade?.state === "requested").length, approved: pending.filter((worker) => worker.upgrade?.state === "approved").length,
      workers: pending.map((worker) => ({ workerId: worker.workerId, state: worker.upgrade?.state ?? "", to: worker.upgrade?.to.version ?? "" })),
    },
    rollbacksAvailable: { total: workers.filter((worker) => worker.releases.length > 0).length, workers: workers.filter((worker) => worker.releases.length > 0).map((worker) => ({ workerId: worker.workerId, to: worker.releases.at(-1)?.version ?? "" })) },
    health: {
      average: scored.length === 0 ? 0 : round1(scored.reduce((sum, row) => sum + row.score, 0) / scored.length), reported: scored.length, unreported: workers.length - scored.length,
      lowest: [...scored].sort((a, b) => a.score - b.score || a.workerId.localeCompare(b.workerId)).slice(0, 3),
    },
  };
}
