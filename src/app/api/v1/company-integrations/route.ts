import { ciRoute, respond } from "@/platform/integrations/http";
export const GET = ciRoute(async (req, c, { actor, svc, rid }) => { void req; void c; return respond({ items: await svc.list(actor), ...(await svc.summary(actor)), ...svc.permissions(actor) }, rid); });
