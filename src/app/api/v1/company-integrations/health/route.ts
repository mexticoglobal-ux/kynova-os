import { getCompanyHealth } from "@/composition/company-health";
import { ciRoute, respond } from "@/platform/integrations/http";
export const GET = ciRoute(async (req, c, { actor, rid }) => { void req; void c; return respond(await getCompanyHealth(actor), rid); });
