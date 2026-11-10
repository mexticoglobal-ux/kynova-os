import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconBadge } from "./IconBadge";

// What a list or panel shows when there is nothing in it yet: an icon, what is missing and what to do about it.
// A soft light breathes behind the icon (it stops for people who prefer reduced motion).
export function EmptyState({ icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-card border border-dashed border-line-strong/60 px-6 py-12 text-center">
      <div aria-hidden className="empty-halo absolute inset-0 animate-breathe" />
      <IconBadge icon={icon} className="relative h-11 w-11" />
      <p className="relative font-display text-base font-semibold tracking-tight">{title}</p>
      {children && <p className="relative max-w-sm text-sm text-ink-muted">{children}</p>}
    </div>
  );
}
