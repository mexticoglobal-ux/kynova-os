"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { publicNav, site } from "@/config/site";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { buttonClass } from "@/components/ui/Button";
import { Brand } from "@/components/ui/Brand";

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const { m } = useI18n();

  return (
    <header className="relative z-40 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
      <Link href="/">
        <Brand name={site.name} />
      </Link>

      <nav aria-label={site.name} className="hidden items-center gap-6 text-sm text-ink-muted md:flex">
        {publicNav.map(({ key, href }) => (
          <Link key={key} href={href} className="transition hover:text-ink">
            {m.publicNav[key]}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <LanguageSwitcher className="hidden sm:inline-flex" />
        <Link
          href="/dashboard"
          className={buttonClass("primary", "md", "hidden sm:inline-block")}
        >
          {m.publicNav.openApp}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? m.common.closeMenu : m.common.openMenu}
          aria-expanded={open}
          className="rounded-xl p-2 text-ink-soft hover:bg-raised md:hidden"
        >
          {open ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="card absolute inset-x-4 top-full z-50 space-y-1 p-4 md:hidden">
          {publicNav.map(({ key, href }) => (
            <Link
              key={key}
              href={href}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-2 text-sm text-ink-soft hover:bg-raised"
            >
              {m.publicNav[key]}
            </Link>
          ))}
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className={buttonClass("primary", "md", "mt-2 flex w-full")}
          >
            {m.publicNav.openApp}
          </Link>
          <LanguageSwitcher className="mt-3 w-full sm:hidden" />
        </div>
      )}
    </header>
  );
}
