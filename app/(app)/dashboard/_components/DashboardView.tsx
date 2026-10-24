"use client";

import Link from "next/link";
// `m` is the LazyMotion component; aliased because `m` also names the i18n messages below.
import { m as motion } from "framer-motion";
import { ArrowRight, Bot, CheckCircle2 } from "lucide-react";
import type { Channel, HealthArea } from "@/lib/contracts/dashboard";
import { dashboardData } from "@/lib/modules/dashboard/data";
import { formatValue } from "@/lib/i18n/format";
import { useI18n } from "@/components/i18n/I18nProvider";
import { KpiCard } from "@/components/ui/KpiCard";
import { AreaChart } from "@/components/charts/AreaChart";
import { BarList } from "@/components/charts/BarList";
import { NAV_ICONS } from "@/components/shell/nav-icons";

const DashboardIcon = NAV_ICONS.dashboard;

const stagger = (index: number) => ({ animationDelay: `${index * 60}ms` });

const HEALTH_ORDER: readonly HealthArea[] = ["sales", "marketing", "finance", "automation", "customerExperience", "growth"];
const CHANNEL_ORDER: readonly Channel[] = ["web", "ads", "social", "referral"];

function HealthRing({ score }: { score: number }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg viewBox="0 0 120 120" className="h-32 w-32" aria-hidden>
      <circle cx="60" cy="60" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
      <motion.circle
        cx="60"
        cy="60"
        r={radius}
        fill="none"
        stroke="#22C55E"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={circumference}
        initial={{ strokeDashoffset: circumference }}
        animate={{ strokeDashoffset: circumference * (1 - score / 100) }}
        transition={{ duration: 1, ease: "easeOut" }}
        transform="rotate(-90 60 60)"
      />
    </svg>
  );
}

export function DashboardView() {
  const { m, tag } = useI18n();
  const data = dashboardData;
  const overall = Math.round(HEALTH_ORDER.reduce((sum, area) => sum + data.health[area], 0) / HEALTH_ORDER.length);

  return (
    <div className="space-y-6">
      <header className="animate-fade-up">
        <span className="inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-zinc-400">
          <DashboardIcon aria-hidden className="h-3.5 w-3.5 text-primary" />
          {m.common.demoData}
        </span>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
          {m.dashboard.greeting}, {data.userName}.
        </h1>
        <p className="mt-2 text-zinc-400">{m.dashboard.subtitle}</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {(Object.keys(data.kpis) as Array<keyof typeof data.kpis>).map((key, index) => (
          <div key={key} className="animate-fade-up" style={stagger(index + 1)}>
            <KpiCard label={m.dashboard.kpis[key]} kpi={data.kpis[key]} />
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="animate-fade-up glass p-5 sm:p-6 lg:col-span-2" style={stagger(5)}>
          <h2 className="font-medium">{m.dashboard.revenueTrend}</h2>
          <div className="mt-4">
            <AreaChart data={data.revenueTrend} labels={m.dashboard.months} label={m.dashboard.revenueTrend} />
          </div>
        </div>

        <div className="animate-fade-up glass p-5 sm:p-6" style={stagger(6)}>
          <h2 className="font-medium">{m.dashboard.healthTitle}</h2>
          <div className="mt-4 flex items-center gap-5">
            <div className="relative shrink-0">
              <HealthRing score={overall} />
              <span className="absolute inset-0 grid place-items-center text-3xl font-semibold text-success">{overall}</span>
            </div>
            <ul className="min-w-0 flex-1 space-y-2 text-sm">
              {HEALTH_ORDER.map((area) => (
                <li key={area} className="flex justify-between gap-2">
                  <span className="truncate text-zinc-400">{m.dashboard.healthAreas[area]}</span>
                  <span className="tabular-nums">{data.health[area]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="animate-fade-up glass p-5 sm:p-6" style={stagger(7)}>
          <h2 className="font-medium">{m.dashboard.channels}</h2>
          <div className="mt-4">
            <BarList
              items={CHANNEL_ORDER.map((channel) => ({
                label: m.dashboard.channelNames[channel],
                value: data.leadsByChannel[channel],
                display: formatValue(data.leadsByChannel[channel], "number", tag),
              }))}
            />
          </div>
        </div>

        <div className="animate-fade-up glass flex flex-col p-5 sm:p-6" style={stagger(8)}>
          <h2 className="font-medium">{m.dashboard.recommended}</h2>
          <ul className="mt-4 flex-1 space-y-3 text-sm">
            {m.dashboard.actions.map((action) => (
              <li key={action} className="flex items-start gap-3">
                <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="text-zinc-300">{action}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/nex"
            className="mt-5 inline-flex items-center gap-2 self-start rounded-full bg-primary/15 px-4 py-2 text-sm text-primary-soft transition hover:bg-primary/25"
          >
            <Bot aria-hidden className="h-4 w-4" />
            {m.nav.nex}
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
