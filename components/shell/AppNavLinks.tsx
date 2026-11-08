"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { Clock, Star } from "lucide-react";
import { appNav } from "@/config/site";
import { useI18n } from "@/components/i18n/I18nProvider";
import { shellText } from "@/lib/i18n/shell-messages";
import type { NavMemory } from "@/lib/nav-memory";
import { NAV_ICONS } from "./nav-icons";

const isActive = (pathname: string, href: string) => pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));

type Props = {
  onNavigate?: () => void;
  /** Icons only, for the collapsed sidebar. */
  collapsed?: boolean;
  memory?: NavMemory;
  onToggleFavorite?: (href: string) => void;
  /** The name of any screen the navigation knows (a module or a platform screen). */
  labelOf?: (href: string) => string | undefined;
};

const link = "flex items-center gap-3 rounded-xl px-3 py-2 transition";

export function AppNavLinks({ onNavigate, collapsed = false, memory, onToggleFavorite, labelOf }: Props) {
  const pathname = usePathname();
  const { m, locale } = useI18n();
  const t = shellText(locale);
  const favorites = memory?.favorites ?? [];
  const recents = (memory?.recents ?? []).filter((href) => !favorites.includes(href)).slice(0, 4);
  const shortcut = (href: string) => {
    const name = labelOf?.(href);
    if (!name) return null;
    return (
      <li key={href}>
        <Link href={href} onClick={onNavigate} aria-current={isActive(pathname, href) ? "page" : undefined} className={clsx(link, "text-ink-muted hover:bg-raised hover:text-ink", isActive(pathname, href) && "bg-primary/15 text-ink")}>
          <span className="truncate">{name}</span>
        </Link>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      {!collapsed && favorites.length > 0 && (
        <section aria-label={t.favorites}>
          <h2 className="mb-1 flex items-center gap-1.5 px-3 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
            <Star aria-hidden className="h-3 w-3 text-accent" />
            {t.favorites}
          </h2>
          <ul className="space-y-0.5 text-sm">{favorites.map(shortcut)}</ul>
        </section>
      )}
      {!collapsed && recents.length > 0 && (
        <section aria-label={t.recents}>
          <h2 className="mb-1 flex items-center gap-1.5 px-3 text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-muted">
            <Clock aria-hidden className="h-3 w-3" />
            {t.recents}
          </h2>
          <ul className="space-y-0.5 text-sm">{recents.map(shortcut)}</ul>
        </section>
      )}
      <section aria-label={t.navigation}>
        <ul className="space-y-1 text-sm">
          {appNav.map(({ key, href }) => {
            const Icon = NAV_ICONS[key];
            const active = isActive(pathname, href);
            const name = m.nav[key];
            const pinned = favorites.includes(href);
            return (
              <li key={key} className="group relative">
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  aria-label={collapsed ? name : undefined}
                  title={collapsed ? name : undefined}
                  className={clsx(link, collapsed && "justify-center", active ? "bg-primary/15 text-ink shadow-[inset_2px_0_0_rgb(var(--accent))]" : "text-ink-muted hover:bg-raised hover:text-ink")}
                >
                  <Icon aria-hidden className={clsx("h-5 w-5 shrink-0", active && "text-accent")} />
                  {!collapsed && name}
                </Link>
                {!collapsed && onToggleFavorite && (
                  <button
                    type="button"
                    aria-pressed={pinned}
                    aria-label={pinned ? t.removeFavorite(name) : t.addFavorite(name)}
                    onClick={() => onToggleFavorite(href)}
                    className={clsx("absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-ink-muted transition hover:text-accent focus-visible:opacity-100", pinned ? "text-accent opacity-100" : "opacity-0 group-hover:opacity-100")}
                  >
                    <Star aria-hidden className={clsx("h-3.5 w-3.5", pinned && "fill-current")} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
