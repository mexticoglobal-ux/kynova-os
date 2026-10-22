import { requirements, type IntegrationState } from "./status";

/**
 * What each AI Employee needs connected before it can work with REAL data. Declarative and keyed by plain strings: the framework does not import the
 * team or the AI Employees framework. An employee absent from this map needs no external platform. Adding an employee or a platform edits this table only.
 */
export const EMPLOYEE_NEEDS: Readonly<Record<string, readonly string[]>> = {
  ceo_ai: ["search_console", "ga4", "google_business"],
  marketing_manager: ["meta_business"], ads_manager: ["meta_business"], social_media_manager: ["facebook_pages", "instagram_business"],
  technical_seo: ["search_console"], content_seo: ["search_console"], seo_auditor: ["search_console"], seo_manager: ["search_console"], link_building_advisor: ["search_console"], local_seo: ["google_business"],
  analytics_advisor: ["ga4"], analytics_manager: ["ga4"], forecast_manager: ["ga4"],
  appointment_manager: ["google_calendar"], email_manager: ["google_workspace"], email_marketing_manager: ["google_workspace"], marketplace_manager: ["shopify"],
};
/** Every AI Employee asks this BEFORE working. `ready: false` means it must say what is missing instead of producing results. */
export const employeeCheck = (state: IntegrationState | null, employeeKey: string) => requirements(state, EMPLOYEE_NEEDS[employeeKey] ?? []);
