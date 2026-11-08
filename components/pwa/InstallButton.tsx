"use client";

import { Download } from "lucide-react";
import { useSyncExternalStore } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { shellText } from "@/lib/i18n/shell-messages";
import { canInstall, promptInstall, subscribeInstall } from "@/lib/pwa";

// Shown only when the browser says the app can be installed.
export function InstallButton() {
  const { locale } = useI18n();
  const available = useSyncExternalStore(subscribeInstall, canInstall, () => false);
  if (!available) return null;
  const label = shellText(locale).install;
  return (
    <button type="button" onClick={() => void promptInstall()} aria-label={label} title={label} className="rounded-xl p-2 text-ink-soft transition hover:bg-raised hover:text-ink">
      <Download aria-hidden className="h-5 w-5" />
    </button>
  );
}
