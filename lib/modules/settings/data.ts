import type { ModuleData } from "@/lib/contracts/module";

// Demo data until the module is connected to lib/db (ADR-0005).
export const settingsData: ModuleData = {
  kpis: [
    { value: 12, format: "number", delta: 9.1, trend: [8, 9, 9, 10, 10, 11, 11, 12] },
    { value: 3, format: "number", delta: 0, trend: [2, 2, 3, 3, 3, 3, 3, 3] },
    { value: 5, format: "number", delta: 25.0, trend: [2, 3, 3, 4, 4, 4, 5, 5] },
    { value: 38, format: "percent", delta: 4.2, lowerIsBetter: true, trend: [30, 31, 32, 33, 34, 35, 37, 38] },
  ],
  insightIcons: ["star", "shield", "plug"],
  rowValueFormat: "number",
  rows: [
    { owner: "ana@kynova.demo", value: 64, status: "active" },
    { owner: "luis@kynova.demo", value: 51, status: "active" },
    { owner: "carla@kynova.demo", value: 38, status: "active" },
    { owner: "diego@kynova.demo", value: 0, status: "invited" },
    { owner: "sofia@kynova.demo", value: 12, status: "paused" },
  ],
};
