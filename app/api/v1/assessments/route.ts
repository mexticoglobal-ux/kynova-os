import { api, invalid, ok, readBody, tenantParam } from "@/lib/api/handler";
import { parseAssessmentInput } from "@/lib/contracts/backend";
import { runAudit } from "@/lib/audit";
import { AUDIT_VERSION } from "@/lib/contracts/audit";
import { buildSummary } from "@/lib/audit-summary";
import { NOVA_DRAFT_PACK } from "@/lib/audit-packs/nova-draft";

export const dynamic = "force-dynamic";

export const GET = api(async ({ db, request }) => {
  const tenantId = tenantParam(request);
  return tenantId ? ok({ assessments: await db.listAssessments(tenantId) }) : invalid();
});

// Saves a Business Audit. The score, band and gaps are recomputed from the answers, never taken from the browser.
export const POST = api(async ({ db, request }) => {
  const input = parseAssessmentInput(await readBody(request));
  if (!input) return invalid();
  const result = runAudit(input.answers);
  const summary = buildSummary(result, { catalog: NOVA_DRAFT_PACK.catalog, businessName: input.businessName });
  const saved = await db.saveAssessment(input.tenantId, {
    businessName: input.businessName,
    audit: {
      engineVersion: AUDIT_VERSION,
      score: result.score,
      band: result.band,
      infrastructure: result.infrastructure,
      answers: input.answers,
      result: { gaps: result.gaps, strengths: result.strengths, services: summary.services, status: summary.status },
    },
  });
  return ok(saved, 201);
});
