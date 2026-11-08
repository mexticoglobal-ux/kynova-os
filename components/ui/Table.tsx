import clsx from "clsx";
import type { ReactNode } from "react";

// The one data table of the product. It scrolls sideways inside its own box on a phone instead of breaking the page,
// and it is named for screen readers. The look of the cells lives in app/globals.css (`main table`).
export function Table({ label, minWidth, className, children }: { label: string; minWidth?: number; className?: string; children: ReactNode }) {
  return (
    <div className="table-wrap">
      <table aria-label={label} className={clsx("w-full text-left", className)} style={minWidth ? { minWidth } : undefined}>
        {children}
      </table>
    </div>
  );
}
