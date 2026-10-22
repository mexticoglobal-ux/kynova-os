import { ciRoute, readBody, respond } from "@/platform/integrations/http";
export const PUT = ciRoute<{ params: Promise<{ connector: string }> }>(async (req, c, { actor, svc, rid }) => respond(await svc.configure(actor, (await c.params).connector, await readBody(req)), rid), { mutating: true });
