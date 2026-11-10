import clsx from "clsx";

// A selectable answer in a guided flow (Business Assessment, Business Audit, guided chat).
export function choiceClass(selected = false, className?: string) {
  return clsx(
    "rounded-2xl border p-3.5 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft",
    selected ? "border-accent/70 bg-accent/10 text-ink shadow-glow" : "border-line bg-surface/70 hover:border-accent/40 hover:bg-raised",
    className,
  );
}
