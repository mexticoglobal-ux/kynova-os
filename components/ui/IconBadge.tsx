import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

// Icon rules: lucide-react only, 16px (h-4) inline with text, 20px (h-5) in navigation and headers, always aria-hidden.
// An IconBadge frames an icon at the top of a card.
export function IconBadge({ icon: Icon, tone = "primary", className }: { icon: LucideIcon; tone?: "primary" | "accent"; className?: string }) {
  return (
    <span className={clsx("inline-flex h-9 w-9 items-center justify-center rounded-xl", tone === "accent" ? "bg-accent/15 text-accent" : "bg-primary/15 text-primary-soft", className)}>
      <Icon aria-hidden className="h-4 w-4" />
    </span>
  );
}
