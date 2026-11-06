import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { IconBadge } from "@/components/ui/IconBadge";
import { PageHeader } from "@/components/ui/PageHeader";
import { PLATFORM_HUB, PLATFORM_SECTIONS } from "./catalog";

export function PlatformHub() {
  return (
    <div className="space-y-6">
      <PageHeader icon={PLATFORM_HUB.icon} eyebrow="Vista previa" title={PLATFORM_HUB.title} subtitle={PLATFORM_HUB.summary} />
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PLATFORM_SECTIONS.map((section) => (
          <li key={section.key}>
            <Link href={section.href} className="block h-full rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <Card className="h-full space-y-3 p-5 transition-colors hover:border-accent/40">
                <div className="flex items-center justify-between">
                  <IconBadge icon={section.icon} />
                  <Badge>No conectado</Badge>
                </div>
                <h2 className="font-semibold">{section.title}</h2>
                <p className="text-sm text-ink-muted">{section.summary}</p>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
