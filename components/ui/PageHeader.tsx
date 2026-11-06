import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "./Badge";
import { Card } from "./Card";

// The hero at the top of every module page: eyebrow, title, subtitle and actions on a glowing card.
export function PageHeader({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  actions,
  children,
}: {
  icon: LucideIcon;
  eyebrow: string;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <Card as="section" className="relative animate-fade-up overflow-hidden p-6 sm:p-8">
      <div aria-hidden className="glow absolute inset-0 opacity-60" />
      <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Badge>
            <Icon aria-hidden className="h-3.5 w-3.5 text-accent" />
            {eyebrow}
          </Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl text-ink-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children && <div className="relative mt-4">{children}</div>}
    </Card>
  );
}
