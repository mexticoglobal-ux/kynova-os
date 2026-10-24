"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { publicNav, site } from "@/config/site";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  const { m } = useI18n();

  return (
    <header className="relative z-40 mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
      <Link href="/" className="font-semibold tracking-tight">
        {site.name}
      </Link>

      <nav aria-label={site.name} className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
        {publicNav.map(({ key, href }) => (
          <Link key={key} href={href} className="transition hover:text-white">
            {m.publicNav[key]}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2">
        <LanguageSwitcher className="hidden sm:inline-flex" />
        <Link
          href="/dashboard"
          className="hidden rounded-full bg-primary px-4 py-2 text-sm font-medium transition hover:bg-primary/90 sm:inline-block"
        >
          {m.publicNav.openApp}
        </Link>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? m.common.closeMenu : m.common.openMenu}
          aria-expanded={open}
          className="rounded-xl p-2 text-zinc-300 hover:bg-white/5 md:hidden"
        >
          {open ? <X aria-hidden className="h-5 w-5" /> : <Menu aria-hidden className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="glass absolute inset-x-4 top-full z-50 space-y-1 p-4 md:hidden">
          {publicNav.map(({ key, href }) => (
            <Link
              key={key}
              href={href}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-3 py-2 text-sm text-zinc-300 hover:bg-white/5"
            >
              {m.publicNav[key]}
            </Link>
          ))}
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="mt-2 block rounded-xl bg-primary px-3 py-2 text-center text-sm font-medium"
          >
            {m.publicNav.openApp}
          </Link>
          <LanguageSwitcher className="mt-3 w-full sm:hidden" />
        </div>
      )}
    </header>
  );
}
