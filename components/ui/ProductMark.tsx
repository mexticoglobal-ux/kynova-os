import clsx from "clsx";
import { BRANDS, BRAND_TONES, type BrandKey } from "@/config/brand";

// The mark of a KYNOVA product: its icon on a tinted chip, and optionally its name and what it is. One place, so every product looks like a family.
export function ProductMark({ brand, size = "md", showName = true, showTagline = false, className }: { brand: BrandKey; size?: "sm" | "md" | "lg"; showName?: boolean; showTagline?: boolean; className?: string }) {
  const { name, tagline, tone, icon: Icon } = BRANDS[brand];
  const tones = BRAND_TONES[tone];
  const box = size === "lg" ? "h-12 w-12 rounded-2xl" : size === "sm" ? "h-7 w-7 rounded-lg" : "h-9 w-9 rounded-xl";
  const glyph = size === "lg" ? "h-6 w-6" : size === "sm" ? "h-3.5 w-3.5" : "h-4.5 w-4.5";
  return (
    <span className={clsx("inline-flex items-center gap-3", className)} data-brand={brand}>
      <span aria-hidden className={clsx("inline-flex shrink-0 items-center justify-center ring-1 ring-inset ring-line-soft", box, tones.chip)}>
        <Icon className={clsx(glyph, tones.icon)} />
      </span>
      {(showName || showTagline) && (
        <span className="min-w-0">
          {showName && <span className="block font-semibold tracking-tight">{name}</span>}
          {showTagline && <span className="block text-xs text-ink-muted">{tagline}</span>}
        </span>
      )}
    </span>
  );
}
