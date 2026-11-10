import clsx from "clsx";

// The KYNOVA wordmark: an electric gradient mark and the name. One place, so the brand never drifts between the app and the public site.
export function Brand({ name, className }: { name: string; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2 font-display font-bold tracking-tight", className)}>
      <span aria-hidden className="relative inline-flex h-5 w-5 items-center justify-center">
        <span className="absolute inset-0 rounded-full border border-accent/50" />
        <span className="h-2 w-2 rotate-45 rounded-[2px] bg-gradient-to-br from-primary to-accent" />
      </span>
      {name}
    </span>
  );
}
