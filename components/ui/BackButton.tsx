"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/i18n/I18nProvider";
import { buttonClass } from "@/components/ui/Button";

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
      className={buttonClass("secondary", "md")}
    >
      <ArrowLeft aria-hidden className="h-4 w-4" />
      {m.common.back}
    </button>
  );
}
