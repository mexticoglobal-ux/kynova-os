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
    <div className="glass flex flex-col gap-3 p-5 transition hover:-translate-y-0.5 hover:border-white/15">
      <p className="text-sm text-zinc-400">{label}</p>
      <p className="text-2xl font-semibold tabular-nums sm:text-3xl">{formatValue(kpi.value, kpi.format, tag)}</p>
      <div className="flex items-center gap-1.5 text-xs">
        <span
          className={clsx(
            "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 font-medium",
            improving ? "bg-success/15 text-success" : "bg-danger/15 text-danger-soft",
          )}
        >
          <Arrow aria-hidden className="h-3 w-3" />
          {formatDelta(kpi.delta, tag)}
        </span>
        <span className="text-zinc-400">{m.common.vsLastMonth}</span>
      </div>
      <Sparkline data={kpi.trend} positive={improving} />
    </div>
  );
}
