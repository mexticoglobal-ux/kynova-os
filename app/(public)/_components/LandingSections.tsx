"use client";

import Link from "next/link";
import { m as motion } from "framer-motion";
import { ArrowRight, Briefcase, Building2, Check, LineChart, Megaphone, Minus, Plug, Quote, ShieldCheck, Sparkles, Layers } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import type { Messages } from "@/lib/i18n/messages";

type ComparisonValue = keyof Messages["landing"]["comparison"]["values"];

const BENEFIT_ICONS = [Sparkles, Layers, LineChart, ShieldCheck];
const USE_CASE_ICONS = [Building2, Megaphone, Briefcase];

const COMPETITORS = ["HubSpot", "Salesforce", "Zoho", "Monday"] as const;

// Rows follow `landing.comparison.rows`. Columns: KYNOVA OS, then COMPETITORS. Indicative only (see disclaimer).
const COMPARISON: ReadonlyArray<readonly [ComparisonValue, ComparisonValue, ComparisonValue, ComparisonValue, ComparisonValue]> = [
  ["included", "plan", "plan", "plan", "plan"],
  ["included", "integrations", "integrations", "plan", "integrations"],
  ["included", "integrations", "integrations", "integrations", "integrations"],
  ["included", "included", "included", "included", "included"],
  ["included", "plan", "plan", "plan", "plan"],
];

const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.45 },
};

function ComparisonMark({ value, label }: { value: ComparisonValue; label: string }) {
  if (value === "included") {
    return (
      <span className="inline-flex items-center gap-1.5 text-success">
        <Check aria-hidden className="h-4 w-4" />
        {label}
      </span>
    );
  }
  if (value === "integrations") {
    return (
      <span className="inline-flex items-center gap-1.5 text-zinc-400">
        <Plug aria-hidden className="h-4 w-4" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-zinc-300">
      <Minus aria-hidden className="h-4 w-4" />
      {label}
    </span>
  );
}

export function LandingSections() {
  const { m } = useI18n();
  const { benefits, useCases, testimonials, comparison, finalCta } = m.landing;

  return (
    <>
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <motion.header {...reveal} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{benefits.title}</h2>
          <p className="mt-4 text-zinc-400">{benefits.subtitle}</p>
        </motion.header>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {benefits.items.map((item, index) => {
            const Icon = BENEFIT_ICONS[index] ?? Sparkles;
            return (
              <motion.article key={item.title} {...reveal} transition={{ duration: 0.45, delay: index * 0.06 }} className="glass p-6">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/15 text-primary">
                  <Icon aria-hidden className="h-5 w-5" />
                </span>
                <h3 className="mt-5 font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{item.body}</p>
              </motion.article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <motion.header {...reveal} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{useCases.title}</h2>
          <p className="mt-4 text-zinc-400">{useCases.subtitle}</p>
        </motion.header>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {useCases.items.map((item, index) => {
            const Icon = USE_CASE_ICONS[index] ?? Building2;
            return (
              <motion.article key={item.title} {...reveal} transition={{ duration: 0.45, delay: index * 0.06 }} className="glass relative overflow-hidden p-6">
                <div aria-hidden className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-accent/20 blur-2xl" />
                <Icon aria-hidden className="relative h-6 w-6 text-accent" />
                <h3 className="relative mt-5 text-lg font-semibold">{item.title}</h3>
                <p className="relative mt-2 text-sm text-zinc-400">{item.body}</p>
              </motion.article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <motion.header {...reveal} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{testimonials.title}</h2>
          <p className="mt-4 text-sm text-zinc-400">{testimonials.note}</p>
        </motion.header>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {testimonials.items.map((item, index) => (
            <motion.figure key={item.role} {...reveal} transition={{ duration: 0.45, delay: index * 0.06 }} className="glass flex flex-col p-6">
              <Quote aria-hidden className="h-6 w-6 text-primary" />
              <blockquote className="mt-4 flex-1 text-zinc-200">{item.quote}</blockquote>
              <figcaption className="mt-6 flex items-center justify-between gap-3 text-sm">
                <span className="text-zinc-400">{item.role}</span>
                <span className="shrink-0 rounded-full bg-white/5 px-2.5 py-1 text-xs text-zinc-300">{m.common.illustrative}</span>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <motion.header {...reveal} className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">{comparison.title}</h2>
          <p className="mt-4 text-zinc-400">{comparison.subtitle}</p>
        </motion.header>

        <motion.div {...reveal} className="glass mt-12 hidden p-2 lg:block">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="text-zinc-400">
                <th scope="col" className="w-1/3 px-4 py-3 font-medium">
                  {comparison.feature}
                </th>
                <th scope="col" className="px-4 py-3 font-semibold text-white">
                  KYNOVA OS
                </th>
                {COMPETITORS.map((name) => (
                  <th key={name} scope="col" className="px-4 py-3 font-medium">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {comparison.rows.map((row, rowIndex) => (
                <tr key={row}>
                  <th scope="row" className="px-4 py-3 font-medium text-zinc-200">
                    {row}
                  </th>
                  {(COMPARISON[rowIndex] ?? []).map((value, columnIndex) => (
                    <td key={columnIndex} className={columnIndex === 0 ? "bg-primary/[0.06] px-4 py-3" : "px-4 py-3"}>
                      <ComparisonMark value={value} label={comparison.values[value]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>

        <div className="mt-12 space-y-3 lg:hidden">
          {comparison.rows.map((row, rowIndex) => (
            <div key={row} className="glass p-4">
              <h3 className="font-medium">{row}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                {(["KYNOVA OS", ...COMPETITORS] as const).map((name, columnIndex) => {
                  const value = COMPARISON[rowIndex]?.[columnIndex] ?? "plan";
                  return (
                    <div key={name} className="min-w-0">
                      <dt className="text-xs text-zinc-400">{name}</dt>
                      <dd className="truncate">
                        <ComparisonMark value={value} label={comparison.values[value]} />
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-6 max-w-3xl text-center text-xs text-zinc-400">{comparison.disclaimer}</p>
      </section>

      <section className="px-4 pb-24 pt-10 sm:px-6">
        <motion.div {...reveal} className="glass relative mx-auto max-w-4xl overflow-hidden p-8 text-center sm:p-14">
          <div aria-hidden className="glow absolute inset-0" />
          <div className="relative">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">{finalCta.title}</h2>
            <p className="mx-auto mt-4 max-w-xl text-zinc-300">{finalCta.subtitle}</p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/dashboard" className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-3 font-medium transition hover:bg-primary/90">
                {m.common.startFree}
                <ArrowRight aria-hidden className="h-4 w-4" />
              </Link>
              <Link href="/pricing" className="rounded-full border border-white/15 bg-white/5 px-7 py-3 transition hover:bg-white/10">
                {m.common.viewPricing}
              </Link>
            </div>
          </div>
        </motion.div>
      </section>
    </>
  );
}
