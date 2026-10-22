import { getActivitySink } from "@/platform/activity";
import { getIntegrationsStore } from "./runtime";
import { createCompanyIntegrationsService, type CompanyIntegrationsService } from "./service";

/** Composition: the store and the activity sink. The framework meets no other system. */
export async function getCompanyIntegrationsService(): Promise<CompanyIntegrationsService> {
  return createCompanyIntegrationsService({ store: await getIntegrationsStore(), activity: await getActivitySink("company-integrations", "integrations") });
}
