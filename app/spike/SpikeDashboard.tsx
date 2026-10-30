"use client";

import { useI18n } from "@/components/i18n/I18nProvider";

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
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">KYNOVA · TEST</p>
          <h1 className="mt-3 text-2xl font-semibold">{copy.title}</h1>
          <p className="mt-2 text-sm text-zinc-400">{copy.user}: <span className="text-zinc-200">{email}</span></p>
          {canaryConfigured && <p className="mt-2 text-xs text-zinc-400">{copy.canary}</p>}
        </div>
        <form action="/api/spike/auth/sign-out" method="post">
          <button type="submit" className="min-h-11 rounded-full border border-white/15 px-4 text-sm text-zinc-200 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {copy.signOut}
          </button>
        </form>
      </header>

      <section className="mt-8 rounded-card border border-white/10 bg-white/[0.03] p-5 sm:p-6" aria-labelledby="spike-rows-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="spike-rows-title" className="text-lg font-semibold">{copy.rows}</h2>
          <a href="/api/spike/items" className="text-sm text-primary-soft underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            {copy.api}
          </a>
        </div>

        {hasError ? (
          <p className="mt-5 rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger-soft" role="alert">{copy.error}</p>
        ) : items.length === 0 ? (
          <p className="mt-5 rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">{copy.noRows}</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
              <thead><tr className="border-b border-white/10 text-zinc-400"><th scope="col" className="py-3 pr-4">{copy.sampleData}</th><th scope="col" className="py-3">{copy.tenantId}</th></tr></thead>
              <tbody>{items.map((item) => <tr key={item.id} className="border-b border-white/5"><td className="py-3 pr-4 text-zinc-100">{item.label}</td><td className="py-3 font-mono text-xs text-zinc-400">{item.tenant_id}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
