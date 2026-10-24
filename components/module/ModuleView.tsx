"use client";

import { useState } from "react";
import { AlertTriangle, Plug, ShieldCheck, Sparkles, Star, Target, TrendingUp, Zap, type LucideIcon } from "lucide-react";
import type { ModuleKey } from "@/config/site";
import type { InsightIcon } from "@/lib/contracts/module";
import { moduleRegistry } from "@/lib/modules/registry";
import { formatValue } from "@/lib/i18n/format";
import { useI18n } from "@/components/i18n/I18nProvider";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { NAV_ICONS } from "@/components/shell/nav-icons";

const INSIGHT_ICONS: Record<InsightIcon, LucideIcon> = {
  target: Target,
  alert: AlertTriangle,
  trending: TrendingUp,
  sparkles: Sparkles,
  star: Star,
  shield: ShieldCheck,
  zap: Zap,
  plug: Plug,
};

const stagger = (index: number) => ({ animationDelay: `${index * 50}ms` });

export function ModuleView({ moduleKey }: { moduleKey: ModuleKey }) {
  const { m, tag } = useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const copy = m.modules[moduleKey];
  const data = moduleRegistry[moduleKey];
  const ModuleIcon = NAV_ICONS[moduleKey];

  return (
    <div className="space-y-6">
      <section className="glass relative animate-fade-up overflow-hidden p-6 sm:p-8">
        <div aria-hidden className="glow absolute inset-0 opacity-60" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-400">
              <ModuleIcon aria-hidden className="h-3.5 w-3.5 text-primary" />
              {m.common.demoData}
            </span>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{copy.title}</h1>
            <p className="mt-2 max-w-2xl text-zinc-400">{copy.subtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {copy.actions.map((action, index) => (
              <button
                key={action}
                type="button"
                onClick={() => setNotice(m.common.demoAction)}
                className={
                  index === 0
                    ? "rounded-full bg-primary px-4 py-2 text-sm font-medium transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    : "rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                }
              >
                {action}
              </button>
            ))}
          </div>
        </div>
        <p role="status" aria-live="polite" className="relative mt-4 min-h-5 text-sm text-primary-soft">
          {notice}
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data.kpis.map((kpi, index) => (
          <div key={copy.kpis[index]} className="animate-fade-up" style={stagger(index + 1)}>
            <KpiCard label={copy.kpis[index] ?? ""} kpi={kpi} />
          </div>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {copy.cards.map((card, index) => {
          const Icon = INSIGHT_ICONS[data.insightIcons[index] ?? "sparkles"];
          return (
            <article key={card.title} className="glass animate-fade-up p-5" style={stagger(index + 5)}>
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Icon aria-hidden className="h-4 w-4" />
              </span>
              <h2 className="mt-4 font-medium">{card.title}</h2>
              <p className="mt-1 text-sm text-zinc-400">{card.body}</p>
            </article>
          );
        })}
      </section>

      <section className="glass animate-fade-up p-5 sm:p-6" style={stagger(8)}>
        <h2 className="font-medium">{copy.tableTitle}</h2>
        <table className="mt-4 w-full table-fixed text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-zinc-400">
            <tr>
              <th scope="col" className="w-2/5 pb-3 font-medium sm:w-1/3">
                {copy.columns[0]}
              </th>
              <th scope="col" className="hidden pb-3 font-medium sm:table-cell">
                {copy.columns[1]}
              </th>
              <th scope="col" className="pb-3 text-right font-medium">
                {copy.columns[2]}
              </th>
              <th scope="col" className="pb-3 text-right font-medium">
                {copy.columns[3]}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {data.rows.map((row, index) => (
              <tr key={copy.rows[index]} className="transition hover:bg-white/[0.02]">
                <td className="truncate py-3 pr-2 font-medium">{copy.rows[index]}</td>
                <td className="hidden truncate py-3 pr-2 text-zinc-400 sm:table-cell">{row.owner}</td>
                <td className="py-3 text-right tabular-nums text-zinc-300">
                  {formatValue(row.value, data.rowValueFormat, tag)}
                </td>
                <td className="py-3 text-right">
                  <StatusBadge status={row.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
