import clsx from "clsx";
import type { ReactNode } from "react";
import { Card } from "./Card";

// One figure: a quiet label, a large number and an optional note. Every dashboard of the product is made of these, so the hierarchy is
// the same everywhere. The look lives in app/globals.css (.stat, .stat-label, .stat-value, .stat-hint).
export function Stat({ label, value, hint, tone, className }: { label: string; value: ReactNode; hint?: string; tone?: "good" | "warn"; className?: string }) {
  return (
    <Card className={clsx("stat card-lift", className)} aria-label={label}>
      <p className="stat-label">{label}</p>
      <p className={clsx("stat-value", tone === "good" && "text-success", tone === "warn" && "text-warning")}>{value}</p>
      {hint && <p className="stat-hint">{hint}</p>}
    </Card>
  );
}
