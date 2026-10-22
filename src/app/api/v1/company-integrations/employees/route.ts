import { ROSTER } from "@/modules/team";
import { EMPLOYEE_NEEDS, employeeCheck } from "@/platform/integrations";
import { ciRoute, respond } from "@/platform/integrations/http";
/** For every AI Employee that needs an outside platform: can it work with real data, and if not, exactly what is missing. */
export const GET = ciRoute(async (req, c, { actor, svc, rid }) => {
  void req; void c; const state = await svc.state(actor);
  return respond({ items: ROSTER.filter((r) => EMPLOYEE_NEEDS[r.key]).map((r) => ({ employee: r.key, name: r.name, ...employeeCheck(state, r.key) })) }, rid);
});
