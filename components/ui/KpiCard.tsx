"use client";

import clsx from "clsx";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ModuleKpi } from "@/lib/contracts/module";
import { formatDelta, formatValue } from "@/lib/i18n/format";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Sparkline } from "@/components/charts/Sparkline";

export function KpiCard({ label, kpi }: { label: string; kpi: ModuleKpi }) {
  const { m, tag } = useI18n();
  const improving = kpi.lowerIsBetter ? kpi.delta <= 0 : kpi.delta >= 0;
  const Arrow = kpi.delta >= 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div className="card card-lift stat flex flex-col gap-3">
      <p className="stat-label">{label}</p>
      <p className="stat-value !mt-0 sm:text-3xl">{formatValue(kpi.value, kpi.format, tag)}</p>
      <div className="flex items-center gap-1.5 text-xs">
        <span
          className={clsx(
            "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-semibold ring-1 ring-inset",
            improving ? "bg-success/15 text-success ring-success/30" : "bg-danger/15 text-danger-soft ring-danger/30",
          )}
        >
          <Arrow aria-hidden className="h-3 w-3" />
          {formatDelta(kpi.delta, tag)}
        </span>
        <span className="text-ink-muted">{m.common.vsLastMonth}</span>
      </div>
      <Sparkline data={kpi.trend} positive={improving} />
    </div>
  );
}
