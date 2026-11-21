import { api, fail, invalid, ok, readBody } from "@/lib/api/handler";
import { buildFirstWorkDraftDeps, firstWorkAiConfigFor } from "@/lib/ai/first-work";
import { can } from "@/lib/contracts/backend";
import { parseDraftInput } from "@/lib/contracts/first-work-draft";
import { createAiBudgetStore } from "@/lib/db/ai-budget";
import { FIRST_WORK_TEST_LIMITS, generateDraft } from "@/lib/first-work-draft";

export const dynamic = "force-dynamic";

// The message and presentation draft of "Conseguir más clientes" (prompt nex.nex.first-work-draft), for a signed-in member of the company.
// Who may call it comes from the existing mechanism: the session's memberships (session_bootstrap) and the same `write` permission that works the company's
// commercial data. A viewer is refused here; the rules draft keeps working on the screen without this route. Nothing about prospects is read or sent: only the two
// phrases and the company's name. It stores nothing and logs no content.
// THE MODEL IS OFF. `firstWorkAiConfigFor` returns the shipped configuration (everything off) unless the deployment variable NEX_AI_FIRST_TEST_TENANT holds the id of THIS
// company; without it the answer is always the rules draft (`source: "rules", reason: "disabled"`), and neither the budget nor a provider is touched. With it, the model is
// reached only through ONE controlled call (lib/ai/controlled-call.ts): a reservation in the company's persistent budget (money and call cap) comes first, one provider attempt,
// no retry, no fallback; anything that does not go through ends in the rules draft with its reason. Turning it on is a separate decision (docs/modules/nex-primera-prueba-ia.md).
export const POST = api(async ({ db, client, request }) => {
  const input = parseDraftInput(await readBody(request));
  if (!input) return invalid();
  const session = await db.bootstrap();
  const membership = session.memberships.find((row) => row.tenantId === input.tenantId);
  if (!membership || !can(membership.role, "write")) return fail("forbidden", 403);
  const phrases = { offer: input.offer, audience: input.audience };
  const config = firstWorkAiConfigFor(input.tenantId, process.env.NEX_AI_FIRST_TEST_TENANT);
  if (!config.enabled) return ok(await generateDraft(phrases, { companyName: membership.name }));
  const { deps } = buildFirstWorkDraftDeps({
    store: createAiBudgetStore(client),
    tenantId: input.tenantId,
    requestId: input.requestId ?? crypto.randomUUID(),
    config,
    limits: FIRST_WORK_TEST_LIMITS,
    env: process.env,
  });
  return ok(await generateDraft(phrases, { companyName: membership.name }, deps, config));
});
