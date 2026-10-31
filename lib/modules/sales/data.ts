import type { ModuleData } from "@/lib/contracts/module";

// Demo data until the module is connected to lib/db (ADR-0005).
export const salesData: ModuleData = {
  kpis: [
    { value: 186400, format: "currency", delta: 12.4, trend: [120, 132, 128, 145, 150, 162, 171, 186] },
    { value: 42, format: "number", delta: 8.1, trend: [30, 33, 31, 35, 37, 38, 40, 42] },
    { value: 27.5, format: "percent", delta: 2.3, trend: [22, 23, 24, 24, 25, 26, 27, 27.5] },
    { value: 34, format: "number", delta: -6.2, lowerIsBetter: true, trend: [42, 41, 40, 38, 37, 36, 35, 34] },
  ],
  insightIcons: ["trending", "alert", "target"],
  rowValueFormat: "currency",
  rows: [
    { owner: "Ana Morales", value: 24500, status: "negotiation" },
    { owner: "Luis Jiménez", value: 18200, status: "open" },
    { owner: "Carla Rojas", value: 32800, status: "won" },
    { owner: "Diego Vargas", value: 9600, status: "open" },
    { owner: "Sofía Castro", value: 14300, status: "lost" },
  ],
};
