import type { ModuleData } from "@/lib/contracts/module";

// Demo data until the module is connected to lib/db (ADR-0005).
export const clientsData: ModuleData = {
  kpis: [
    { value: 248, format: "number", delta: 5.6, trend: [210, 215, 220, 226, 231, 237, 242, 248] },
    { value: 7450, format: "currency", delta: 4.1, trend: [6800, 6900, 6950, 7050, 7150, 7250, 7350, 7450] },
    { value: 92.3, format: "percent", delta: 1.2, trend: [89, 90, 90.5, 91, 91.2, 91.8, 92, 92.3] },
    { value: 4, format: "number", delta: -20.0, lowerIsBetter: true, trend: [7, 6, 6, 5, 5, 5, 4, 4] },
  ],
  insightIcons: ["alert", "star", "sparkles"],
  rowValueFormat: "currency",
  rows: [
    { owner: "Ana Morales", value: 48200, status: "active" },
    { owner: "Luis Jiménez", value: 36900, status: "active" },
    { owner: "Carla Rojas", value: 28400, status: "active" },
    { owner: "Diego Vargas", value: 19700, status: "paused" },
    { owner: "Sofía Castro", value: 12600, status: "active" },
  ],
};
