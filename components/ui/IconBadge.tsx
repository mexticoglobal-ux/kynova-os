import clsx from "clsx";
import type { LucideIcon } from "lucide-react";

// Icon rules: lucide-react only, 16px (h-4) inline with text, 20px (h-5) in navigation and headers, always aria-hidden.
// An IconBadge frames an icon at the top of a card: a soft electric wash with a thin edge.
export function IconBadge({ icon: Icon, tone = "primary", className }: { icon: LucideIcon; tone?: "primary" | "accent"; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset",
        tone === "accent" ? "from-accent/25 to-primary/10 text-accent ring-accent/30" : "from-primary/25 to-accent/10 text-primary-soft ring-primary/30",
        className,
      )}
    >
      <Icon aria-hidden className="h-4 w-4" />
    </span>
  );
}
