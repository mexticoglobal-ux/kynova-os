"use client";

import clsx from "clsx";
import type { StatusKey } from "@/lib/contracts/module";
import { useI18n } from "@/components/i18n/I18nProvider";

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

const TONE_CLASS = {
  positive: "bg-success/15 text-success",
  neutral: "bg-white/10 text-zinc-300",
  warning: "bg-warning/15 text-warning",
  negative: "bg-danger/15 text-danger-soft",
};

export function StatusBadge({ status }: { status: StatusKey }) {
  const { m } = useI18n();
  return (
    <span className={clsx("inline-flex rounded-full px-2.5 py-1 text-xs font-medium", TONE_CLASS[TONE[status]])}>
      {m.status[status]}
    </span>
  );
}
