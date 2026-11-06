// Data access for Backend Core (ADR-0010). Server only.
// Every call goes through the signed-in user's client: the user's JWT reaches the database, so RLS and the
// functions' own role checks decide what is allowed. The secret key is never used here.

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ActivityDto,
  AssessmentDto,
  ClientDto,
  ConversationDto,
  LeadDto,
  MessageDto,
  Role,
  ServerDigest,
  SessionDto,
  TeamEntry,
} from "@/lib/contracts/backend";

export type BackendErrorCode = "unauthorized" | "forbidden" | "not_found" | "conflict" | "invalid" | "limit" | "unavailable";

export class BackendError extends Error {
  constructor(readonly code: BackendErrorCode) {
    super(code);
    this.name = "BackendError";
  }
}

// PostgREST forwards the Postgres SQLSTATE (or its own PGRST code) in `code`.
export function errorOf(error: { code?: string } | null | undefined): BackendError {
  const code = error?.code ?? "";
  if (code === "28000" || code.startsWith("PGRST30")) return new BackendError("unauthorized");
  if (code === "42501") return new BackendError("forbidden");
  if (code === "P0002") return new BackendError("not_found");
  if (code === "23505") return new BackendError("conflict");
  if (code === "22023" || code === "23514" || code === "23503") return new BackendError("invalid");
  if (code === "53400") return new BackendError("limit");
  // Only the code is logged: never the message, which can carry values, and never user data.
  console.error("backend_query_failed", { code: code || null });
  return new BackendError("unavailable");
}

async function rpc<T>(client: SupabaseClient, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.rpc(name, args);
  if (error) throw errorOf(error);
  return data as T;
}

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export type Cursor = { createdAt: string; id: string };

export function createBackend(client: SupabaseClient) {
  return {
    bootstrap: (displayName?: string) => rpc<SessionDto>(client, "session_bootstrap", { p_display_name: displayName ?? null }),

    // Companies
    createCompany: (name: string) => rpc<string>(client, "create_company", { p_name: name }),
    renameCompany: (tenantId: string, name: string) => rpc<void>(client, "update_company", { p_tenant: tenantId, p_name: name }),
    deleteCompany: (tenantId: string, confirmName: string) => rpc<void>(client, "delete_company", { p_tenant: tenantId, p_confirm_name: confirmName }),

    // Team
    listTeam: async (tenantId: string) => list<TeamEntry>(await rpc(client, "list_team", { p_tenant: tenantId })),
    invite: (tenantId: string, email: string, role: Exclude<Role, "owner">) =>
      rpc<{ status: "added" | "invited" }>(client, "invite_member", { p_tenant: tenantId, p_email: email, p_role: role }),
    setRole: (tenantId: string, userId: string, role: Role) => rpc<void>(client, "set_member_role", { p_tenant: tenantId, p_user: userId, p_role: role }),
    removeMember: (tenantId: string, userId: string) => rpc<void>(client, "remove_member", { p_tenant: tenantId, p_user: userId }),
    revokeInvitation: (invitationId: string) => rpc<void>(client, "revoke_invitation", { p_invitation: invitationId }),

    // Prospects, leads, approvals
    captureProspect: (tenantId: string, payload: Record<string, unknown>) =>
      rpc<{ contactId: string; leadId: string; conversationId: string; assessmentRunId: string | null; approvalRequestId: string | null }>(client, "capture_prospect", { p_tenant: tenantId, p: payload }),
    listLeads: async (tenantId: string, options: { status?: string; limit?: number; after?: Cursor } = {}) =>
      list<LeadDto>(
        await rpc(client, "list_leads", {
          p_tenant: tenantId,
          p_status: options.status ?? null,
          p_limit: options.limit ?? 50,
          p_after_created_at: options.after?.createdAt ?? null,
          p_after_id: options.after?.id ?? null,
        }),
      ),
    advanceLead: (leadId: string, status: string, reason?: string) => rpc<void>(client, "advance_lead", { p_lead: leadId, p_status: status, p_reason: reason ?? null }),
    winLead: (leadId: string, options: { title?: string; amountMinor?: number; currency?: string } = {}) =>
      rpc<{ opportunityId: string; customerId: string; contactId: string }>(client, "win_lead", {
        p_lead: leadId,
        p_title: options.title ?? null,
        p_amount_minor: options.amountMinor ?? null,
        p_currency: options.currency ?? "USD",
      }),
    decideApproval: (requestId: string, approve: boolean, note?: string) => rpc<void>(client, "decide_approval", { p_request: requestId, p_approve: approve, p_note: note ?? null }),

    // Clients
    listClients: async (tenantId: string, options: { search?: string; status?: string; limit?: number; after?: Cursor } = {}) =>
      list<ClientDto>(
        await rpc(client, "list_clients", {
          p_tenant: tenantId,
          p_search: options.search ?? null,
          p_status: options.status ?? null,
          p_limit: options.limit ?? 50,
          p_after_created_at: options.after?.createdAt ?? null,
          p_after_id: options.after?.id ?? null,
        }),
      ),
    createClient: (tenantId: string, input: { name: string; email?: string; phone?: string; company?: string; notes?: string }) =>
      rpc<string>(client, "create_client", {
        p_tenant: tenantId,
        p_name: input.name,
        p_email: input.email ?? null,
        p_phone: input.phone ?? null,
        p_organization: input.company ?? null,
        p_notes: input.notes ?? null,
      }),
    updateClient: (clientId: string, fields: Record<string, string>) => rpc<void>(client, "update_client", { p_customer: clientId, p: fields }),
    eraseContact: (contactId: string) => rpc<void>(client, "erase_contact", { p_contact: contactId }),

    // Conversations and messages
    startAssistantConversation: (tenantId: string, title?: string) => rpc<string>(client, "start_assistant_conversation", { p_tenant: tenantId, p_title: title ?? null }),
    deleteAssistantConversation: (conversationId: string) => rpc<void>(client, "delete_assistant_conversation", { p_conversation: conversationId }),
    appendMessage: (conversationId: string, message: { direction: "in" | "out"; senderKind: "user" | "nex"; body: string }) =>
      rpc<{ id: string; createdAt: string }>(client, "append_message", {
        p_conversation: conversationId,
        p_direction: message.direction,
        p_sender_kind: message.senderKind,
        p_content_type: "text",
        p_body: message.body,
      }),
    listConversations: async (tenantId: string, kind: "contact" | "assistant", limit = 50) =>
      list<ConversationDto>(await rpc(client, "list_conversations", { p_tenant: tenantId, p_kind: kind, p_limit: limit })),
    listMessages: async (conversationId: string, limit = 100) => list<MessageDto>(await rpc(client, "list_messages", { p_conversation: conversationId, p_limit: limit })),

    // Audits, dashboard, activity
    saveAssessment: (tenantId: string, payload: Record<string, unknown>) => rpc<{ assessmentId: string; contactId: string }>(client, "save_assessment", { p_tenant: tenantId, p: payload }),
    listAssessments: async (tenantId: string, limit = 20) => list<AssessmentDto>(await rpc(client, "list_assessments", { p_tenant: tenantId, p_limit: limit })),
    dashboard: (tenantId: string) => rpc<ServerDigest>(client, "dashboard_digest", { p_tenant: tenantId }),
    listActivity: async (tenantId: string, limit = 50, before?: string) =>
      list<ActivityDto>(await rpc(client, "list_activity", { p_tenant: tenantId, p_limit: limit, p_before: before ?? null })),
  };
}

export type Backend = ReturnType<typeof createBackend>;
