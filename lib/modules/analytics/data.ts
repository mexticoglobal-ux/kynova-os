import type { ModuleData } from "@/lib/contracts/module";

// Demo data until the module is connected to lib/db (ADR-0005).
export const analyticsData: ModuleData = {
  kpis: [
    { value: 48200, format: "number", delta: 14.0, trend: [32, 34, 36, 38, 41, 43, 46, 48.2] },
    { value: 3.8, format: "percent", delta: 0.6, trend: [3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8] },
    { value: 520, format: "currency", delta: 4.5, trend: [470, 480, 485, 492, 500, 506, 513, 520] },
    { value: 12, format: "number", delta: 9.1, trend: [8, 9, 9, 10, 10, 11, 11, 12] },
  ],
  insightIcons: ["trending", "alert", "sparkles"],
  rowValueFormat: "number",
  rows: [
    { owner: "Ana Morales", value: 342, status: "active" },
    { owner: "Luis Jiménez", value: 281, status: "active" },
    { owner: "Carla Rojas", value: 196, status: "scheduled" },
    { owner: "Diego Vargas", value: 88, status: "active" },
    { owner: "Sofía Castro", value: 41, status: "draft" },
  ],
};
