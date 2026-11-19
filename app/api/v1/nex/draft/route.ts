import { api, fail, invalid, ok, readBody } from "@/lib/api/handler";
import { can } from "@/lib/contracts/backend";
import { parseDraftInput } from "@/lib/contracts/first-work-draft";
import { generateDraft } from "@/lib/first-work-draft";

export const dynamic = "force-dynamic";

// The message and presentation draft of "Conseguir más clientes" (prompt nex.nex.first-work-draft), for a signed-in member of the company.
// Who may call it comes from the existing mechanism: the session's memberships (session_bootstrap) and the same `write` permission that works the company's
// commercial data. A viewer is refused here; the rules draft keeps working on the screen without this route. Nothing about prospects is read or sent: only the two
// phrases and the company's name. It stores nothing and logs no content.
// No model is called: `generateDraft` is given no way to ask one, and its configuration is off, so the answer is always the rules draft and says why
// (`source: "rules"`, `reason: "disabled"`). Turning the model on is a separate change (see lib/first-work-draft.ts and ADR-0036).
export const POST = api(async ({ db, request }) => {
  const input = parseDraftInput(await readBody(request));
  if (!input) return invalid();
  const session = await db.bootstrap();
  const membership = session.memberships.find((row) => row.tenantId === input.tenantId);
  if (!membership || !can(membership.role, "write")) return fail("forbidden", 403);
  return ok(await generateDraft({ offer: input.offer, audience: input.audience }, { companyName: membership.name }));
});
