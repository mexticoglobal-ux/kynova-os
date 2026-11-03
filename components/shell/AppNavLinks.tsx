"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { appNav } from "@/config/site";
import { useI18n } from "@/components/i18n/I18nProvider";
import { NAV_ICONS } from "./nav-icons";

export function AppNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { m } = useI18n();

  return (
    <ul className="space-y-1 text-sm">
      {appNav.map(({ key, href }) => {
        const Icon = NAV_ICONS[key];
        const active = pathname === href;
        return (
          <li key={key}>
            <Link
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex items-center gap-3 rounded-xl px-3 py-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                active ? "bg-primary/15 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white",
              )}
            >
              <Icon aria-hidden className={clsx("h-4 w-4 shrink-0", active && "text-primary")} />
              {m.nav[key]}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
