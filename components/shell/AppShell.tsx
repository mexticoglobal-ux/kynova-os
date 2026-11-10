"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, m as motion } from "framer-motion";
import { ChevronsLeft, ChevronsRight, Menu, Search, X } from "lucide-react";
import { PLATFORM_SECTIONS } from "@/app/(app)/platform/_components/catalog";
import { appNav, site } from "@/config/site";
import { useI18n } from "@/components/i18n/I18nProvider";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { InstallButton } from "@/components/pwa/InstallButton";
import { AccountMenu } from "@/components/session/AccountMenu";
import { Brand } from "@/components/ui/Brand";
import { shellText } from "@/lib/i18n/shell-messages";
import type { SearchEntry } from "@/lib/nav-memory";
import { AppNavLinks } from "./AppNavLinks";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { useNavMemory } from "./useNavMemory";

// The quick search is only downloaded the first time someone opens it.
const QuickSearch = dynamic(() => import("./QuickSearch"), { ssr: false });

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const { m, locale } = useI18n();
  const t = shellText(locale);
  const pathname = usePathname();
  const { memory, toggle, visit, collapse } = useNavMemory();

  // Every screen the navigation knows: the modules and the platform screens. Favorites, recents and the quick search all read this one list.
  const entries = useMemo<SearchEntry[]>(
    () => [
      ...appNav.map(({ key, href }) => ({ href, label: m.nav[key], group: t.navigation })),
      ...PLATFORM_SECTIONS.map((item) => ({ href: item.href, label: item.title, hint: item.summary, group: t.platform })),
    ],
    [m, t.navigation, t.platform],
  );
  const labelOf = useCallback((href: string) => entries.find((entry) => entry.href === href)?.label, [entries]);

  useEffect(() => {
    if (entries.some((entry) => entry.href === pathname)) visit(pathname);
  }, [pathname, entries, visit]);

  const openSearch = useCallback(() => {
    setSearched(true);
    setSearching(true);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  const collapsed = memory.collapsed;

  return (
    <div className="flex min-h-screen">
      <a href="#contenido" className="skip-link">
        {t.skip}
      </a>
      <aside
        className={`card sticky top-4 m-4 hidden h-[calc(100vh-2rem)] shrink-0 flex-col p-4 transition-[width] duration-200 lg:flex ${collapsed ? "w-[4.75rem]" : "w-64"}`}
      >
        <div className={`mb-6 flex items-center ${collapsed ? "justify-center" : "justify-between"}`}>
          <Link href="/" aria-label={site.product} className="min-w-0">
            {collapsed ? <span aria-hidden className="block h-3 w-3 rotate-45 rounded-[4px] bg-gradient-to-br from-primary to-accent" /> : <Brand name={site.product} />}
          </Link>
          {!collapsed && (
            <button type="button" onClick={() => collapse(true)} aria-label={t.collapse} className="rounded-lg p-1.5 text-ink-muted transition hover:bg-raised hover:text-ink">
              <ChevronsLeft aria-hidden className="h-4 w-4" />
            </button>
          )}
        </div>
        {collapsed && (
          <button type="button" onClick={() => collapse(false)} aria-label={t.expand} className="mb-4 flex justify-center rounded-lg p-1.5 text-ink-muted transition hover:bg-raised hover:text-ink">
            <ChevronsRight aria-hidden className="h-4 w-4" />
          </button>
        )}
        <nav aria-label={site.product} className="flex-1 overflow-y-auto">
          <AppNavLinks collapsed={collapsed} memory={memory} onToggleFavorite={toggle} labelOf={labelOf} />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-header sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3 lg:justify-end lg:border-none lg:bg-transparent lg:px-10 lg:pt-6 lg:backdrop-blur-none">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={m.common.openMenu}
            aria-expanded={open}
            className="rounded-xl p-2 text-ink-soft hover:bg-raised lg:hidden"
          >
            <Menu aria-hidden className="h-5 w-5" />
          </button>
          <Link href="/" className="lg:hidden">
            <Brand name={site.product} />
          </Link>
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={openSearch}
              aria-label={t.search}
              aria-keyshortcuts="Control+K Meta+K"
              className="flex items-center gap-2 rounded-xl border border-line bg-raised/60 px-2.5 py-2 text-sm text-ink-muted transition hover:border-accent/50 hover:text-ink sm:px-3 sm:py-1.5"
            >
              <Search aria-hidden className="h-4 w-4" />
              <span className="hidden sm:inline">{t.search}</span>
              <kbd className="hidden rounded-md border border-line px-1.5 text-[0.6875rem] sm:inline">Ctrl K</kbd>
            </button>
            <InstallButton />
            <ThemeSwitcher />
            <AccountMenu />
            <LanguageSwitcher />
          </div>
        </header>
        <main id="contenido" tabIndex={-1} className="min-w-0 flex-1 px-4 pb-10 pt-4 outline-none sm:px-6 lg:px-10">
          <div key={pathname} className="animate-page-in">
            {children}
          </div>
        </main>
      </div>

      {searched && <QuickSearch open={searching} onClose={() => setSearching(false)} entries={entries} />}

      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" aria-label={m.common.closeMenu} onClick={() => setOpen(false)} className="dialog-scrim absolute inset-0" />
            <motion.nav
              aria-label={site.product}
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: "tween", duration: 0.2 }}
              className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-line bg-surface p-5 shadow-raised"
            >
              <div className="mb-8 flex items-center justify-between">
                <Brand name={site.product} />
                <button type="button" onClick={() => setOpen(false)} aria-label={m.common.closeMenu} className="rounded-xl p-2 text-ink-soft hover:bg-raised">
                  <X aria-hidden className="h-5 w-5" />
                </button>
              </div>
              <AppNavLinks memory={memory} onToggleFavorite={toggle} labelOf={labelOf} onNavigate={() => setOpen(false)} />
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
