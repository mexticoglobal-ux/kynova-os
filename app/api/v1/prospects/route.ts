import { api, fail, invalid, ok, readBody } from "@/lib/api/handler";
import { parseProspectInput } from "@/lib/contracts/backend";
import { NOVA_DRAFT_PACK } from "@/lib/audit-packs/nova-draft";
import { buildProspectPayload } from "@/lib/modules/prospects/build";

export const dynamic = "force-dynamic";

// Stores a finished guided conversation: contact, conversation, messages, Business Audit, lead, handoff and the
// meeting request that waits for an approval. The score and the grade are recomputed here from the closed answers.
export const POST = api(async ({ db, request }) => {
  const input = parseProspectInput(await readBody(request));
  if (!input) return invalid();
  const payload = buildProspectPayload(input.state, input.transcript, NOVA_DRAFT_PACK);
  if (!payload) return fail("conversation_not_finished", 422);
  return ok(await db.captureProspect(input.tenantId, payload), 201);
});
