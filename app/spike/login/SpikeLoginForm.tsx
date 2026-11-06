"use client";

import { FIELD_LG, LABEL } from "@/components/ui/form";
import { buttonClass } from "@/components/ui/Button";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { SupabaseSpikeStatus } from "@/lib/contracts/supabase-spike";

export function SpikeLoginForm({ status }: { status: SupabaseSpikeStatus }) {
  const { m } = useI18n();
  const copy = m.spike;
  const announcement = {
    setup: copy.setup,
    sent: copy.checkEmail,
    required: copy.authRequired,
    signed_out: copy.signedOut,
    error: copy.error,
  }[status];

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-4 py-10">
      <section className="w-full rounded-card border border-line bg-surface p-6 shadow-xl sm:p-8" aria-labelledby="spike-title">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">KYNOVA · TEST</p>
        <h1 id="spike-title" className="mt-3 text-2xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">{copy.description}</p>

        {announcement && (
          <p className="mt-5 rounded-xl border border-line bg-surface p-3 text-sm text-ink-soft" role={status === "error" ? "alert" : "status"} aria-live="polite">
            {announcement}
          </p>
        )}

        {status !== "setup" && (status === "sent" ? (
          <form action="/api/spike/auth/verify" method="post" className="mt-6 space-y-4">
            <div>
              <label htmlFor="spike-token" className={LABEL}>{copy.code}</label>
              <input
                id="spike-token"
                name="token"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,10}"
                maxLength={10}
                required
                className={FIELD_LG}
              />
            </div>
            <button type="submit" className={buttonClass("primary", "md", "min-h-12 w-full")}>
              {copy.verifyCode}
            </button>
            <a href="/spike/login" className="inline-block text-sm text-primary-soft underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              {copy.email}
            </a>
          </form>
        ) : (
          <form action="/api/spike/auth/request" method="post" className="mt-6 space-y-4">
            <div>
              <label htmlFor="spike-email" className={LABEL}>{copy.email}</label>
              <input
                id="spike-email"
                name="email"
                type="email"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
                maxLength={254}
                className={FIELD_LG}
              />
            </div>
            <button type="submit" className={buttonClass("primary", "md", "min-h-12 w-full")}>
              {copy.sendCode}
            </button>
          </form>
        ))}
      </section>
    </main>
  );
}
