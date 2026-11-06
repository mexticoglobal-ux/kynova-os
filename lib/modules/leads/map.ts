import { parseAuditAnswers, runAudit } from "@/lib/audit";
import type { ClientPack } from "@/lib/audit-packs/nova-draft";
import { scoreStatus } from "@/lib/audit-summary";
import type { LeadDto, ServerDigest } from "@/lib/contracts/backend";
import type { Grade, Lead, Priority, Stage } from "@/lib/contracts/pipeline";
import { OWNER_NEX, OWNER_TEAM, type Digest } from "@/lib/pipeline";
import { digest as demoDigest } from "@/lib/pipeline";
import type { AuditBand, AuditDimension, Infrastructure } from "@/lib/contracts/audit";

const BANDS: readonly AuditBand[] = ["initial", "basic", "intermediate", "advanced"];
const INFRA: readonly Infrastructure[] = ["none", "partial", "established"];

function stageOf(dto: LeadDto, now: Date): Stage {
  if (dto.status === "converted") return "won";
  if (dto.status === "working" && dto.meetingApproved) return "meetingRequested";
  const due = dto.nextActionAt ? new Date(dto.nextActionAt).getTime() : null;
  if (dto.status !== "new" && due !== null && due < now.getTime()) return "needsFollowUp";
  return "new";
}

// A lead as the database stores it, in the shape the pipeline screens already use.
// `arrival` separates what came in this session from what was waiting when the user arrived.
export function leadFromDto(dto: LeadDto, pack: ClientPack, sessionStartedAt: Date, now: Date = new Date()): Lead {
  const answers = dto.assessment ? parseAuditAnswers(dto.assessment.answers) : null;
  const band = dto.assessment && (BANDS as readonly string[]).includes(dto.assessment.band) ? (dto.assessment.band as AuditBand) : null;
  const infrastructure = dto.assessment && (INFRA as readonly string[]).includes(dto.assessment.infrastructure) ? (dto.assessment.infrastructure as Infrastructure) : null;
  const grade = (dto.grade ?? "cold") as Grade;
  const contact = dto.email ? { method: "email" as const, value: dto.email } : dto.phone ? { method: "phone" as const, value: dto.phone } : null;
  const draft = dto.approval?.draft?.text;

  return {
    id: dto.id,
    channel: "webChat",
    arrival: new Date(dto.createdAt) >= sessionStartedAt ? "session" : "overnight",
    company: dto.company?.trim() || dto.contactName,
    contactName: dto.contactName,
    contact,
    score: dto.assessment?.score ?? null,
    band,
    infrastructure,
    status: answers ? scoreStatus(runAudit(answers), dto.qualification.treatment === "tu" ? "tu" : "usted", dto.company ?? undefined) : null,
    grade,
    points: dto.points,
    reasons: dto.qualification.reasons ?? [],
    priority: dto.priority as Priority,
    services: (dto.qualification.services ?? []).filter((id) => id in pack.services),
    topGaps: (dto.qualification.topGaps ?? []) as AuditDimension[],
    challenge: dto.challenge ?? undefined,
    question: dto.question ?? undefined,
    stage: stageOf(dto, now),
    nextAction: dto.nextActionText ?? "Decidir cómo continuar con este prospecto",
    owner: dto.ownerName ?? (grade === "hot" || grade === "human" ? OWNER_TEAM : OWNER_NEX),
    approval: dto.approval && draft ? { kind: "meeting", draft } : null,
    ...(dto.approval && draft ? { approvalId: dto.approval.id } : {}),
  };
}

// The dashboard digest from the server's counts. Leads that arrived while the user was here are listed
// individually; what happened since the previous visit comes from the database, so it survives a refresh.
export function digestFromServer(server: ServerDigest, leads: readonly Lead[]): Digest {
  const approvals = leads.filter((lead) => lead.approval);
  return {
    overnight: {
      analyzed: server.sinceVisit.analyzed,
      hot: server.sinceVisit.hot,
      awaitingApproval: approvals.length,
      needFollowUp: leads.filter((lead) => lead.stage === "needsFollowUp").length,
      withMeeting: leads.filter((lead) => lead.stage === "meetingRequested").length,
    },
    session: leads.filter((lead) => lead.arrival === "session").reverse(),
    approvals,
    total: server.leads.total,
  };
}

// Without a backend the demo leads keep their own rules.
export { demoDigest };
