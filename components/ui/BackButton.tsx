"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";

export function BackButton({ fallbackHref = "/" }: { fallbackHref?: string }) {
  const router = useRouter();
  const { m } = useI18n();

  function goBack() {
    const cameFromSite = document.referrer.startsWith(window.location.origin);
    if (cameFromSite && window.history.length > 1) router.back();
    else router.push(fallbackHref);
  }

  return (
    <button
      type="button"
      onClick={goBack}
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <ArrowLeft aria-hidden className="h-4 w-4" />
      {m.common.back}
    </button>
  );
}
