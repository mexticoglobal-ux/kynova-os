"use client";

import { useI18n } from "@/components/i18n/I18nProvider";
import { buttonClass } from "@/components/ui/Button";

type SpikeItem = { id: string; tenant_id: string; label: string };

export function SpikeDashboard({
  email,
  items,
  hasError,
  canaryConfigured,
}: {
  email: string;
  items: SpikeItem[];
  hasError: boolean;
  canaryConfigured: boolean;
}) {
  const { m } = useI18n();
  const copy = m.spike;

  return (
    <main className="mx-auto min-h-screen max-w-4xl px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">KYNOVA · TEST</p>
          <h1 className="mt-3 text-2xl font-semibold">{copy.title}</h1>
          <p className="mt-2 text-sm text-ink-muted">{copy.user}: <span className="text-ink-soft">{email}</span></p>
          {canaryConfigured && <p className="mt-2 text-xs text-ink-muted">{copy.canary}</p>}
        </div>
        <form action="/api/spike/auth/sign-out" method="post">
          <button type="submit" className={buttonClass("secondary", "md", "min-h-11")}>
            {copy.signOut}
          </button>
        </form>
      </header>

      <section className="mt-8 rounded-card border border-line bg-surface p-5 sm:p-6" aria-labelledby="spike-rows-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="spike-rows-title" className="text-lg font-semibold">{copy.rows}</h2>
          <a href="/api/spike/items" className="text-sm text-primary-soft underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {copy.api}
          </a>
        </div>

        {hasError ? (
          <p className="mt-5 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger-soft" role="alert">{copy.error}</p>
        ) : items.length === 0 ? (
          <p className="mt-5 rounded-xl border border-line bg-shade p-4 text-sm text-ink-soft">{copy.noRows}</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
              <thead><tr className="border-b border-line text-ink-muted"><th scope="col" className="py-3 pr-4">{copy.sampleData}</th><th scope="col" className="py-3">{copy.tenantId}</th></tr></thead>
              <tbody>{items.map((item) => <tr key={item.id} className="border-b border-line-soft"><td className="py-3 pr-4 text-ink">{item.label}</td><td className="py-3 font-mono text-xs text-ink-muted">{item.tenant_id}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
