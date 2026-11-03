import type { DashboardData } from "@/lib/contracts/dashboard";

// Demo data until the dashboard is connected to lib/db.
export const dashboardData: DashboardData = {
  userName: "Jeffrey",
  kpis: {
    revenueToday: { value: 12480, format: "currency", delta: 8.2, trend: [9.1, 9.8, 10.2, 10.0, 11.1, 11.6, 12.0, 12.48] },
    newLeads: { value: 38, format: "number", delta: 12.5, trend: [24, 27, 29, 31, 30, 34, 36, 38] },
    conversion: { value: 27.5, format: "percent", delta: 2.3, trend: [22, 23, 24, 24, 25, 26, 27, 27.5] },
    activeClients: { value: 248, format: "number", delta: 5.6, trend: [210, 215, 220, 226, 231, 237, 242, 248] },
  },
  health: { sales: 82, marketing: 64, finance: 77, automation: 58, customerExperience: 88, growth: 71 },
  revenueTrend: [82, 88, 79, 94, 101, 98, 107, 112, 109, 118, 121, 129],
  leadsByChannel: { web: 142, social: 96, referral: 54, ads: 118 },
};
