// Data contract shared by every business module view (ADR-0005). No dependencies on other layers.

export type ValueFormat = "currency" | "number" | "percent";

export type StatusKey =
  | "won"
  | "open"
  | "negotiation"
  | "lost"
  | "active"
  | "paused"
  | "draft"
  | "scheduled"
  | "completed"
  | "paid"
  | "pending"
  | "overdue"
  | "available"
  | "reserved"
  | "sold"
  | "invited";

export type InsightIcon = "target" | "alert" | "trending" | "sparkles" | "star" | "shield" | "zap" | "plug";

export type ModuleKpi = {
  value: number;
  format: ValueFormat;
  /** Change versus the previous period, in percentage points. */
  delta: number;
  /** Recent values used for the sparkline. */
  trend: readonly number[];
  /** True when a lower value is better (costs, cycle time, risk). */
  lowerIsBetter?: boolean;
};

export type ModuleRow = {
  owner: string;
  value: number;
  status: StatusKey;
};

export type ModuleData = {
  kpis: readonly [ModuleKpi, ModuleKpi, ModuleKpi, ModuleKpi];
  insightIcons: readonly [InsightIcon, InsightIcon, InsightIcon];
  rowValueFormat: ValueFormat;
  rows: readonly [ModuleRow, ModuleRow, ModuleRow, ModuleRow, ModuleRow];
};
