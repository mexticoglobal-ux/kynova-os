"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { shellText } from "@/lib/i18n/shell-messages";
import { DEFAULT_THEME, applyTheme, isTheme, type Theme } from "@/lib/theme";

// Switches between NOVA Dark and NOVA Light. The components are exactly the same: only the tokens change. The choice is remembered on this device.
export function ThemeSwitcher() {
  const { locale } = useI18n();
  const t = shellText(locale);
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    setTheme(isTheme(current) ? current : DEFAULT_THEME);
  }, []);

  const next: Theme = theme === "nova-dark" ? "nova-light" : "nova-dark";
  const Icon = theme === "nova-dark" ? Sun : Moon;
  return (
    <button
      type="button"
      aria-label={next === "nova-light" ? t.themeToLight : t.themeToDark}
      onClick={() => {
        applyTheme(next);
        setTheme(next);
      }}
      className="rounded-xl p-2 text-ink-soft transition hover:bg-raised hover:text-ink"
    >
      <Icon aria-hidden className="h-5 w-5" />
    </button>
  );
}
