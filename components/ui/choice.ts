import clsx from "clsx";

// A selectable answer in a guided flow (Business Assessment, Business Audit, guided chat).
export function choiceClass(selected = false, className?: string) {
  return clsx(
    "rounded-xl border p-3 text-left text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-soft",
    selected ? "border-accent/70 bg-accent/10 text-ink" : "border-line bg-surface hover:border-primary/50 hover:bg-raised",
    className,
  );
}
