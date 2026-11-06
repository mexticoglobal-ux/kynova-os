import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconBadge } from "./IconBadge";

// What a list or panel shows when there is nothing in it yet: an icon, what is missing and what to do about it.
export function EmptyState({ icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <IconBadge icon={icon} />
      <p className="font-medium">{title}</p>
      {children && <p className="max-w-sm text-sm text-ink-muted">{children}</p>}
    </div>
  );
}
