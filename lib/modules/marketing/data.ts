import type { ModuleData } from "@/lib/contracts/module";

// Demo data until the module is connected to lib/db (ADR-0005).
export const marketingData: ModuleData = {
  kpis: [
    { value: 318, format: "number", delta: 14.2, trend: [210, 230, 245, 260, 270, 290, 301, 318] },
    { value: 21, format: "currency", delta: -9.5, lowerIsBetter: true, trend: [28, 27, 26, 25, 24, 23, 22, 21] },
    { value: 340, format: "percent", delta: 18.0, trend: [240, 255, 270, 285, 300, 315, 328, 340] },
    { value: 6, format: "number", delta: 20.0, trend: [3, 4, 4, 5, 5, 5, 6, 6] },
  ],
  insightIcons: ["trending", "star", "sparkles"],
  rowValueFormat: "number",
  rows: [
    { owner: "Google Ads", value: 124, status: "active" },
    { owner: "Meta", value: 86, status: "active" },
    { owner: "Webinar", value: 42, status: "scheduled" },
    { owner: "Display", value: 37, status: "paused" },
    { owner: "Email", value: 29, status: "completed" },
  ],
};
