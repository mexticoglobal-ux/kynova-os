"use client";

import { Languages } from "lucide-react";
import clsx from "clsx";
import { LOCALES, LOCALE_LABELS, isLocale } from "@/lib/i18n/config";
import { useI18n } from "./I18nProvider";

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale, setLocale, m } = useI18n();

  return (
    <label className={clsx("relative inline-flex items-center", className)}>
      <span className="sr-only">{m.common.language}</span>
      <Languages aria-hidden className="pointer-events-none absolute left-3 h-4 w-4 text-zinc-400" />
      <select
        value={locale}
        onChange={(event) => {
          if (isLocale(event.target.value)) setLocale(event.target.value);
        }}
        className="h-9 appearance-none rounded-full border border-white/10 bg-white/5 pl-9 pr-4 text-sm text-zinc-200 outline-none transition hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} className="bg-bg text-zinc-100">
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
