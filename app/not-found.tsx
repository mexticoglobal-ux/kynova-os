"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n/I18nProvider";
import { BackButton } from "@/components/ui/BackButton";

export default function NotFound() {
  const { m } = useI18n();

  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="text-center">
        <p className="text-7xl font-semibold text-primary">404</p>
        <h1 className="mt-4 text-2xl font-semibold">{m.notFound.title}</h1>
        <p className="mt-2 text-zinc-400">{m.notFound.body}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <BackButton />
          <Link href="/" className="rounded-full bg-primary px-5 py-2 text-sm font-medium transition hover:bg-primary/90">
            {m.common.goHome}
          </Link>
        </div>
      </div>
    </main>
  );
}
