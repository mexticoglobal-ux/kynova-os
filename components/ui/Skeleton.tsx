import clsx from "clsx";

// A placeholder that shimmers softly while a screen loads. The shimmer stops for people who prefer reduced motion (app/globals.css).
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={clsx(
        "relative overflow-hidden rounded-card bg-raised/70 before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-ink/10 before:to-transparent",
        className,
      )}
    />
  );
}

export function SkeletonKpis({ count = 4 }: { count?: number }) {
  return (
    <div aria-hidden className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <Skeleton key={index} className="h-28" />
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div aria-hidden className="space-y-2">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-12 w-full" />
      ))}
    </div>
  );
}

/** What a module screen looks like while it loads: header, tabs, figures and a table. */
export function SkeletonPage() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Cargando">
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-10 w-80 max-w-full rounded-full" />
      <SkeletonKpis />
      <SkeletonTable />
    </div>
  );
}
