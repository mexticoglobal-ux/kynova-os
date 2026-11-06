"use client";

import Link from "next/link";
import { BookOpen, GraduationCap, Mail, Store, type LucideIcon } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { BackButton } from "@/components/ui/BackButton";
import type { Messages } from "@/lib/i18n/messages";
import { buttonClass } from "@/components/ui/Button";

export type ComingSoonPage = keyof Messages["comingSoon"]["pages"];

const ICONS: Record<ComingSoonPage, LucideIcon> = {
  docs: BookOpen,
  academy: GraduationCap,
  marketplace: Store,
  contact: Mail,
};

export function ComingSoon({ page }: { page: ComingSoonPage }) {
  const { m } = useI18n();
  const copy = m.comingSoon.pages[page];
  const Icon = ICONS[page];

  return (
    <section className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6">
      <BackButton />
      <div className="card relative mt-8 animate-fade-up overflow-hidden p-8 text-center sm:p-12">
        <div aria-hidden className="glow absolute inset-0" />
        <div className="relative">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/15 text-primary">
            <Icon aria-hidden className="h-6 w-6" />
          </span>
          <span className="mt-6 inline-flex rounded-full bg-raised px-3 py-1 text-xs font-medium uppercase tracking-wide text-ink-soft">
            {m.common.comingSoon}
          </span>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{copy.title}</h1>
          <p className="mx-auto mt-3 max-w-xl text-ink-muted">{copy.body}</p>
          <p className="mx-auto mt-2 max-w-xl text-sm text-ink-muted">{m.comingSoon.body}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/" className={buttonClass("primary", "md")}>
              {m.common.goHome}
            </Link>
            <Link href="/pricing" className={buttonClass("secondary", "md")}>
              {m.common.viewPricing}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
