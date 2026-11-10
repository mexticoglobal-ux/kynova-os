"use client";

import type { StatusKey } from "@/lib/contracts/module";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Badge, type BadgeTone } from "./Badge";

const TONE: Record<StatusKey, "positive" | "neutral" | "warning" | "negative"> = {
  won: "positive",
  active: "positive",
  paid: "positive",
  completed: "positive",
  sold: "positive",
  available: "positive",
  open: "neutral",
  scheduled: "neutral",
  draft: "neutral",
  invited: "neutral",
  negotiation: "warning",
  pending: "warning",
  paused: "warning",
  reserved: "warning",
  lost: "negative",
  overdue: "negative",
};

const BADGE_TONE: Record<"positive" | "neutral" | "warning" | "negative", BadgeTone> = {
  positive: "success",
  neutral: "neutral",
  warning: "warning",
  negative: "danger",
};

export function StatusBadge({ status }: { status: StatusKey }) {
  const { m } = useI18n();
  return <Badge tone={BADGE_TONE[TONE[status]]} dot>{m.status[status]}</Badge>;
}
