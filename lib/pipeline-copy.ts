import type { ChannelStatus, ConversationChannel, Grade, PaymentRail, Priority, Stage } from "@/lib/contracts/pipeline";

// Spanish labels for the commercial pipeline (same known gap as the rest of the audit copy: other locales pending).

export const STAGE_LABEL: Record<Stage, string> = {
  new: "Nuevo",
  needsFollowUp: "Necesita seguimiento",
  meetingRequested: "Reunión solicitada",
  won: "Cliente",
};

export const PRIORITY_LABEL: Record<Priority, string> = { high: "Alta", medium: "Media", low: "Baja" };

export const GRADE_LABEL: Record<Grade, string> = { hot: "Caliente", warm: "Tibio", cold: "Frío", human: "Atención personal" };

export const CHANNEL_LABEL: Record<ConversationChannel | PaymentRail, string> = {
  webChat: "Chat web",
  whatsapp: "WhatsApp",
  facebook: "Facebook",
  instagram: "Instagram",
  email: "Correo",
  form: "Formularios",
  stripe: "Stripe",
  paypal: "PayPal",
  makapay: "MakaPay",
  makawallet: "MakaWallet",
  sinpe: "SINPE",
};

export const CHANNEL_STATUS_LABEL: Record<ChannelStatus, string> = { demo: "Demostración", planned: "Próximamente" };

export const METHOD_LABEL = { email: "Correo", whatsapp: "WhatsApp", phone: "Teléfono" } as const;
