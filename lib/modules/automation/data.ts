import type { ModuleData } from "@/lib/contracts/module";

// Demo data until the module is connected to lib/db (ADR-0005).
export const automationData: ModuleData = {
  kpis: [
    { value: 18, format: "number", delta: 12.5, trend: [11, 12, 13, 14, 15, 16, 17, 18] },
    { value: 2940, format: "number", delta: 22.0, trend: [1800, 1950, 2100, 2300, 2450, 2600, 2780, 2940] },
    { value: 98.6, format: "percent", delta: 0.4, trend: [97.5, 97.8, 98, 98.1, 98.2, 98.4, 98.5, 98.6] },
    { value: 126, format: "number", delta: 17.8, trend: [80, 88, 95, 101, 108, 114, 120, 126] },
  ],
  insightIcons: ["zap", "alert", "sparkles"],
  rowValueFormat: "number",
  rows: [
    { owner: "Ana Morales", value: 412, status: "active" },
    { owner: "Luis Jiménez", value: 268, status: "active" },
    { owner: "Carla Rojas", value: 391, status: "active" },
    { owner: "Diego Vargas", value: 77, status: "paused" },
    { owner: "Sofía Castro", value: 52, status: "draft" },
  ],
};
