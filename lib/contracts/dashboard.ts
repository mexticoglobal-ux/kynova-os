import type { ModuleKpi } from "./module";

export type HealthArea = "sales" | "marketing" | "finance" | "automation" | "customerExperience" | "growth";

export type Channel = "web" | "social" | "referral" | "ads";

export type DashboardData = {
  userName: string;
  kpis: {
    revenueToday: ModuleKpi;
    newLeads: ModuleKpi;
    conversion: ModuleKpi;
    activeClients: ModuleKpi;
  };
  health: Record<HealthArea, number>;
  /** Monthly revenue for the last 12 months, oldest first. */
  revenueTrend: readonly number[];
  leadsByChannel: Record<Channel, number>;
};
