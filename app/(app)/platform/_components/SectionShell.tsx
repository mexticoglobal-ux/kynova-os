import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SECTION_BRAND, brandOfSection } from "@/config/brand";
import { PageHeader } from "@/components/ui/PageHeader";
import { sectionInfo, type PlatformSectionKey } from "./catalog";

export function SectionShell({ section, children }: { section: PlatformSectionKey; children: ReactNode }) {
  const info = sectionInfo(section);
  const brand = brandOfSection(section);
  return (
    <div className="space-y-6">
      <Link href="/platform" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft aria-hidden className="h-4 w-4" /> Plataforma
      </Link>
      <PageHeader icon={SECTION_BRAND[section] ? brand.icon : info.icon} tone={brand.tone} eyebrow="Vista previa · datos de ejemplo" title={info.title} subtitle={info.summary} />
      {children}
    </div>
  );
}
