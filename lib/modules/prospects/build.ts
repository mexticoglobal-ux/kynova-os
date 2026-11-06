import { AUDIT_VERSION } from "@/lib/contracts/audit";
import { runAudit } from "@/lib/audit";
import { buildSummary } from "@/lib/audit-summary";
import type { ClientPack } from "@/lib/audit-packs/nova-draft";
import type { TranscriptEntry } from "@/lib/contracts/backend";
import { CHALLENGE_LABEL, buildHandoff, type ChatState } from "@/lib/guided-chat";
import { meetingDraft } from "@/lib/pipeline";

// Version of the data-processing notice the guided chat shows (the demo notice: legal text is still pending).
export const GUIDED_CHAT_NOTICE_VERSION = "guided-chat-demo-1";

// Turns a finished guided conversation into the payload of capture_prospect.
// The server recomputes everything from the visitor's closed answers: the browser's score is never trusted.
export function buildProspectPayload(state: ChatState, transcript: readonly TranscriptEntry[], pack: ClientPack): Record<string, unknown> | null {
  if (state.step !== "end" || !state.intent) return null;
  const handoff = buildHandoff(state, pack);
  const audit = handoff.audit;
  const result = audit ? runAudit(audit.answers) : null;
  const summary = result ? buildSummary(result, { catalog: pack.catalog, treatment: state.treatment, businessName: state.businessName }) : null;
  const firstService = handoff.services[0] ? pack.services[handoff.services[0]]?.name : undefined;
  const canRequestMeeting = handoff.contact !== null && (handoff.route === "hot" || handoff.route === "warm");

  return {
    intent: state.intent,
    route: handoff.route,
    name: state.name,
    businessName: state.businessName,
    challenge: state.challenge ? CHALLENGE_LABEL[state.challenge] : undefined,
    question: state.question,
    contact: handoff.contact ? { method: handoff.contact.method, value: handoff.contact.value } : undefined,
    reasons: handoff.reasons,
    services: handoff.services,
    nextStep: handoff.nextStep,
    treatment: state.treatment,
    noticeVersion: GUIDED_CHAT_NOTICE_VERSION,
    summary: [...handoff.reasons, summary?.status].filter(Boolean).join(" "),
    meetingDraft: canRequestMeeting ? meetingDraft(pack, state.name?.trim() || "", firstService, state.treatment) : undefined,
    qualification: handoff.qualification
      ? { budget: state.budget, timeline: state.timeline, decisionRole: state.role, points: handoff.qualification.points, grade: handoff.qualification.grade }
      : undefined,
    audit:
      audit && result
        ? {
            engineVersion: AUDIT_VERSION,
            score: audit.score,
            band: audit.band,
            infrastructure: audit.infrastructure,
            answers: audit.answers,
            topGaps: audit.topGaps,
            result: { gaps: result.gaps, strengths: result.strengths, services: summary?.services ?? [], status: summary?.status },
          }
        : undefined,
    handoff,
    transcript: transcript.map((entry) => ({ direction: entry.direction, senderKind: entry.senderKind, contentType: entry.contentType, body: entry.body })),
  };
}
