import {
  BarChart3,
  Bot,
  Building2,
  Cog,
  LayoutDashboard,
  Megaphone,
  TrendingUp,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { AppNavKey } from "@/config/site";

export const NAV_ICONS: Record<AppNavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  nex: Bot,
  sales: TrendingUp,
  marketing: Megaphone,
  clients: Users,
  properties: Building2,
  automation: Workflow,
  finance: Wallet,
  analytics: BarChart3,
  settings: Cog,
};
