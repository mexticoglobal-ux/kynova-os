"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, Plug, ShieldCheck, Sparkles, Star, Target, TrendingUp, Zap, type LucideIcon } from "lucide-react";
import type { ModuleKey } from "@/config/site";
import type { InsightIcon } from "@/lib/contracts/module";
import { moduleRegistry } from "@/lib/modules/registry";
import { formatValue } from "@/lib/i18n/format";
import { useI18n } from "@/components/i18n/I18nProvider";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { NAV_ICONS } from "@/components/shell/nav-icons";
import { Button } from "@/components/ui/Button";
import { IconBadge } from "@/components/ui/IconBadge";
import { PageHeader } from "@/components/ui/PageHeader";

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

// `children` renders right below the page header, for a module that has real (non-demo) content to show first.
export function ModuleView({ moduleKey, children }: { moduleKey: ModuleKey; children?: ReactNode }) {
  const { m, tag } = useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const copy = m.modules[moduleKey];
  const data = moduleRegistry[moduleKey];
  const ModuleIcon = NAV_ICONS[moduleKey];

  return (
    <div className="space-y-8">
      <PageHeader
        icon={ModuleIcon}
        eyebrow={m.common.demoData}
        title={copy.title}
        subtitle={copy.subtitle}
        actions={copy.actions.map((action, index) => (
          <Button key={action} variant={index === 0 ? "primary" : "secondary"} onClick={() => setNotice(m.common.demoAction)}>
            {action}
          </Button>
        ))}
      >
        <p role="status" aria-live="polite" className={notice ? "mt-4 text-sm text-primary-soft" : "sr-only"}>
          {notice}
        </p>
      </PageHeader>

      {children}

      <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {data.kpis.map((kpi, index) => (
          <div key={copy.kpis[index]} className="animate-fade-up" style={stagger(index + 1)}>
            <KpiCard label={copy.kpis[index] ?? ""} kpi={kpi} />
          </div>
        ))}
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {copy.cards.map((card, index) => {
          const Icon = INSIGHT_ICONS[data.insightIcons[index] ?? "sparkles"];
          return (
            <article key={card.title} className="card animate-fade-up p-5" style={stagger(index + 5)}>
              <IconBadge icon={Icon} />
              <h2 className="mt-4 font-semibold tracking-tight">{card.title}</h2>
              <p className="mt-1 text-sm text-ink-muted">{card.body}</p>
            </article>
          );
        })}
      </section>

      <section className="card animate-fade-up p-5 sm:p-6" style={stagger(8)}>
        <h2 className="font-semibold tracking-tight">{copy.tableTitle}</h2>
        <table className="mt-4 w-full table-fixed text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-muted">
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
          <tbody className="divide-y divide-line-soft">
            {data.rows.map((row, index) => (
              <tr key={copy.rows[index]} className="transition hover:bg-surface">
                <td className="truncate py-3 pr-2 font-medium">{copy.rows[index]}</td>
                <td className="hidden truncate py-3 pr-2 text-ink-muted sm:table-cell">{row.owner}</td>
                <td className="py-3 text-right tabular-nums text-ink-soft">
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
