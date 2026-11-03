import type { ModuleData } from "@/lib/contracts/module";

// Demo data until the module is connected to lib/db (ADR-0005).
export const financeData: ModuleData = {
  kpis: [
    { value: 128900, format: "currency", delta: 8.2, trend: [98, 104, 107, 111, 116, 120, 124, 128.9] },
    { value: 74300, format: "currency", delta: 3.1, lowerIsBetter: true, trend: [68, 69, 70, 71, 72, 72.5, 73.4, 74.3] },
    { value: 42.4, format: "percent", delta: 2.6, trend: [37, 38, 38.5, 39.5, 40.2, 41, 41.8, 42.4] },
    { value: 11850, format: "currency", delta: -12.0, lowerIsBetter: true, trend: [16, 15.2, 14.6, 14, 13.4, 12.8, 12.3, 11.85] },
  ],
  insightIcons: ["trending", "alert", "target"],
  rowValueFormat: "currency",
  rows: [
    { owner: "Grupo Alfa", value: 4800, status: "paid" },
    { owner: "Inversiones Nova", value: 2350, status: "pending" },
    { owner: "Clínica Vida", value: 1950, status: "overdue" },
    { owner: "Hotel Brisa", value: 3600, status: "paid" },
    { owner: "Estudio Lumen", value: 1300, status: "overdue" },
  ],
};
