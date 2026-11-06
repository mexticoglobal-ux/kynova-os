"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, m as motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { site } from "@/config/site";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { AppNavLinks } from "./AppNavLinks";
import { Brand } from "@/components/ui/Brand";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { m } = useI18n();

  return (
    <div className="flex min-h-screen">
      <aside className="card sticky top-4 m-4 hidden h-[calc(100vh-2rem)] w-60 shrink-0 flex-col p-5 lg:flex">
        <Link href="/" className="mb-8">
          <Brand name={site.product} />
        </Link>
        <nav aria-label={site.product} className="flex-1 overflow-y-auto">
          <AppNavLinks />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line-soft bg-canvas/80 px-4 py-3 backdrop-blur lg:justify-end lg:border-none lg:bg-transparent lg:px-10 lg:pt-6">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={m.common.openMenu}
            aria-expanded={open}
            className="rounded-xl p-2 text-ink-soft hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
          >
            <Menu aria-hidden className="h-5 w-5" />
          </button>
          <Link href="/" className="lg:hidden">
            <Brand name={site.product} />
          </Link>
          <LanguageSwitcher />
        </header>
        <main className="min-w-0 flex-1 px-4 pb-10 pt-4 sm:px-6 lg:px-10">{children}</main>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button
              type="button"
              aria-label={m.common.closeMenu}
              onClick={() => setOpen(false)}
              className="absolute inset-0 bg-scrim/70"
            />
            <motion.nav
              aria-label={site.product}
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "tween", duration: 0.2 }}
              className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-line bg-canvas p-5"
            >
              <div className="mb-8 flex items-center justify-between">
                <Brand name={site.product} />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={m.common.closeMenu}
                  className="rounded-xl p-2 text-ink-soft hover:bg-raised"
                >
                  <X aria-hidden className="h-5 w-5" />
                </button>
              </div>
              <AppNavLinks onNavigate={() => setOpen(false)} />
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
