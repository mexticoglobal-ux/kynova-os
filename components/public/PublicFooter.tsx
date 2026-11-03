"use client";

import Link from "next/link";
import { publicNav, site } from "@/config/site";
import { useI18n } from "@/components/i18n/I18nProvider";

export function PublicFooter() {
  const { m } = useI18n();

  return (
    <footer className="border-t border-white/5">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-zinc-400 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-semibold text-zinc-300">{site.product}</p>
          <p className="mt-1">{m.footer.tagline}</p>
        </div>
        <nav aria-label={site.name} className="flex flex-wrap gap-x-6 gap-y-2">
          {publicNav.map(({ key, href }) => (
            <Link key={key} href={href} className="hover:text-zinc-300">
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
