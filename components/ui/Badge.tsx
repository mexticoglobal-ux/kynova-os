import clsx from "clsx";
import type { HTMLAttributes } from "react";

export type BadgeTone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger";

// A tinted fill with a thin inner edge of the same tone: it stays legible on glass and on solid surfaces, in both themes.
const TONE: Record<BadgeTone, string> = {
  neutral: "bg-raised-strong/70 text-ink-soft ring-line",
  primary: "bg-primary/15 text-primary-soft ring-primary/30",
  accent: "bg-accent/15 text-accent-soft ring-accent/30",
  success: "bg-success/15 text-success ring-success/30",
  warning: "bg-warning/15 text-warning ring-warning/30",
  danger: "bg-danger/15 text-danger-soft ring-danger/30",
};

// Small labels: status, priority, tags. One shape, six tones; `dot` adds a status light before the text.
export function Badge({ tone = "neutral", dot = false, className, children, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone; dot?: boolean }) {
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", TONE[tone], className)} {...props}>
      {dot && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />}
      {children}
    </span>
  );
}
