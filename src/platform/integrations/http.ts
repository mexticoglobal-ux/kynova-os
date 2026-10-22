import { NextResponse, type NextRequest } from "next/server";
import { canAccess } from "@/config/modules";
import { assertSameOrigin, getAuthConfig, ok, problem, route } from "@/platform/auth/http";
import { requireApiSession } from "@/platform/auth/session";
import { IntegrationsFrameworkError, isIntegrationsFrameworkError, type Actor, type CompanyIntegrationsService } from "./service";
import { getCompanyIntegrationsService } from "./server";
import { fromWire, toWire } from "./wire";

/** Same module access as the Integrations screen it lives on. Roles are defined only in `src/config/modules.ts`. */
export const COMPANY_INTEGRATIONS_SLUG = "integrations";
export interface CiRouteContext { actor: Actor; rid: string; svc: CompanyIntegrationsService; userId: string }
export function ciRoute<C = unknown>(fn: (req: NextRequest, ctx: C, a: CiRouteContext) => Promise<NextResponse>, opts: { mutating?: boolean } = {}) {
  return route<C>(async (req, ctx, rid) => {
    try {
      if (opts.mutating) assertSameOrigin(req, getAuthConfig());
      const s = await requireApiSession();
      if (!s.tenantId) throw new IntegrationsFrameworkError("forbidden", "Select or create a company first.");
      if (!canAccess(s.role, COMPANY_INTEGRATIONS_SLUG)) throw new IntegrationsFrameworkError("forbidden", "Your role cannot use integrations.");
      return await fn(req, ctx, { actor: { tenantId: s.tenantId, userId: s.user.id, role: s.role, requestId: rid }, rid, svc: await getCompanyIntegrationsService(), userId: s.user.id });
    } catch (e) {
      if (isIntegrationsFrameworkError(e)) return problem(e.code, e.status, e.message, rid, e.details?.fields ? { errors: e.details.fields } : {});
      throw e;
    }
  });
}
export async function readBody(req: NextRequest): Promise<unknown> {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new IntegrationsFrameworkError("validation_failed", "Content-Type must be application/json.");
  const text = await req.text(); if (!text.trim()) return {};
  try { const b = JSON.parse(text) as unknown; if (b === null || typeof b !== "object" || Array.isArray(b)) throw 0; return fromWire(b); } catch { throw new IntegrationsFrameworkError("validation_failed", "The body must be a JSON object."); }
}
export const respond = (data: unknown, rid: string, status = 200) => ok(toWire(data), rid, status);
