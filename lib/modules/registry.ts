import type { ModuleKey } from "@/config/site";
import type { ModuleData } from "@/lib/contracts/module";
import { analyticsData } from "./analytics/data";
import { automationData } from "./automation/data";
import { clientsData } from "./clients/data";
import { financeData } from "./finance/data";
import { marketingData } from "./marketing/data";
import { propertiesData } from "./properties/data";
import { salesData } from "./sales/data";
import { settingsData } from "./settings/data";

export const moduleRegistry: Record<ModuleKey, ModuleData> = {
  sales: salesData,
  marketing: marketingData,
  clients: clientsData,
  properties: propertiesData,
  automation: automationData,
  finance: financeData,
  analytics: analyticsData,
  settings: settingsData,
};
