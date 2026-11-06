import clsx from "clsx";

// The KYNOVA wordmark: a gold mark and the name. One place, so the brand never drifts between the app and the public site.
export function Brand({ name, className }: { name: string; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <span aria-hidden className="h-2.5 w-2.5 rotate-45 rounded-[3px] bg-accent" />
      {name}
    </span>
  );
}
