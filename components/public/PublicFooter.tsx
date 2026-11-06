"use client";

import Link from "next/link";
import { publicNav, site } from "@/config/site";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Brand } from "@/components/ui/Brand";

export function PublicFooter() {
  const { m } = useI18n();

  return (
    <footer className="border-t border-line-soft">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-ink-muted sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Brand name={site.product} className="text-ink-soft" />
          <p className="mt-1">{m.footer.tagline}</p>
        </div>
        <nav aria-label={site.name} className="flex flex-wrap gap-x-6 gap-y-2">
          {publicNav.map(({ key, href }) => (
            <Link key={key} href={href} className="hover:text-ink-soft">
              {m.publicNav[key]}
            </Link>
          ))}
        </nav>
        <p>
          © {new Date().getFullYear()} {site.name}. {m.footer.rights}
        </p>
      </div>
    </footer>
  );
}
