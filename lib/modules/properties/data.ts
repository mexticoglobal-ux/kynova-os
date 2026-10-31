import type { ModuleData } from "@/lib/contracts/module";

// Demo data until the module is connected to lib/db (ADR-0005).
export const propertiesData: ModuleData = {
  kpis: [
    { value: 64, format: "number", delta: 6.7, trend: [52, 54, 55, 57, 59, 60, 62, 64] },
    { value: 18400000, format: "currency", delta: 9.3, trend: [15.2, 15.6, 16.1, 16.6, 17.0, 17.5, 18.0, 18.4] },
    { value: 112, format: "number", delta: 15.5, trend: [78, 84, 88, 93, 97, 101, 106, 112] },
    { value: 46, format: "number", delta: -8.0, lowerIsBetter: true, trend: [55, 54, 52, 51, 50, 48, 47, 46] },
  ],
  insightIcons: ["alert", "trending", "sparkles"],
  rowValueFormat: "currency",
  rows: [
    { owner: "Ana Morales", value: 385000, status: "available" },
    { owner: "Luis Jiménez", value: 540000, status: "reserved" },
    { owner: "Carla Rojas", value: 210000, status: "available" },
    { owner: "Diego Vargas", value: 1250000, status: "sold" },
    { owner: "Sofía Castro", value: 690000, status: "available" },
  ],
};
