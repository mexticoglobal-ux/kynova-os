import clsx from "clsx";
import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-raised-strong text-ink-soft",
  primary: "bg-primary/15 text-primary-soft",
  accent: "bg-accent/15 text-accent-soft",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger-soft",
};

// Small labels: status, priority, tags. One shape, six tones.
export function Badge({ tone = "neutral", className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={clsx("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", TONE[tone], className)} {...props} />;
}
