"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { Check, Minus } from "lucide-react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { BackButton } from "@/components/ui/BackButton";
import type { Messages } from "@/lib/i18n/messages";

type PlanKey = keyof Messages["pricing"]["plans"];
type FeatureKey = keyof Messages["pricing"]["features"];
type ValueKey = Exclude<keyof Messages["pricing"]["values"], "perMonthRuns">;
type Cell = { value: ValueKey } | { text: string } | { runs: number };

const PLANS: ReadonlyArray<{ key: PlanKey; price: number | null }> = [
  { key: "starter", price: 49 },
  { key: "professional", price: 149 },
  { key: "business", price: 399 },
  { key: "enterprise", price: null },
];

const YEARLY_DISCOUNT = 0.2;

const FEATURE_ORDER: readonly FeatureKey[] = [
  "ai",
  "crm",
  "seo",
  "marketing",
  "automation",
  "analytics",
  "academy",
  "marketplace",
  "storage",
  "support",
];

const MATRIX: Record<FeatureKey, Record<PlanKey, Cell>> = {
  ai: { starter: { value: "essential" }, professional: { value: "advanced" }, business: { value: "full" }, enterprise: { value: "custom" } },
  crm: { starter: { value: "essential" }, professional: { value: "advanced" }, business: { value: "full" }, enterprise: { value: "full" } },
  seo: { starter: { value: "essential" }, professional: { value: "advanced" }, business: { value: "full" }, enterprise: { value: "full" } },
  marketing: { starter: { value: "essential" }, professional: { value: "advanced" }, business: { value: "full" }, enterprise: { value: "full" } },
  automation: { starter: { runs: 500 }, professional: { runs: 5000 }, business: { runs: 50000 }, enterprise: { value: "unlimited" } },
  analytics: { starter: { value: "essential" }, professional: { value: "advanced" }, business: { value: "full" }, enterprise: { value: "full" } },
  academy: { starter: { value: "essential" }, professional: { value: "full" }, business: { value: "full" }, enterprise: { value: "full" } },
  marketplace: { starter: { value: "notIncluded" }, professional: { value: "advanced" }, business: { value: "full" }, enterprise: { value: "full" } },
  storage: { starter: { text: "10 GB" }, professional: { text: "100 GB" }, business: { text: "1 TB" }, enterprise: { value: "custom" } },
  support: { starter: { value: "email" }, professional: { value: "chat" }, business: { value: "priority" }, enterprise: { value: "dedicated" } },
};

const CARD_FEATURES: readonly FeatureKey[] = ["ai", "crm", "automation", "storage", "support"];

export function PricingView() {
  const { m, tag } = useI18n();
  const [yearly, setYearly] = useState(false);
  const currency = new Intl.NumberFormat(tag, { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  function cellLabel(cell: Cell): string {
    if ("text" in cell) return cell.text;
    if ("runs" in cell) return `${new Intl.NumberFormat(tag).format(cell.runs)} ${m.pricing.values.perMonthRuns}`;
    return m.pricing.values[cell.value];
  }

  function CellValue({ cell }: { cell: Cell }) {
    if ("value" in cell && cell.value === "notIncluded") {
      return (
        <span className="inline-flex items-center gap-1 text-zinc-400">
          <Minus aria-hidden className="h-4 w-4" />
          {m.pricing.values.notIncluded}
        </span>
      );
    }
    return <span>{cellLabel(cell)}</span>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <BackButton />

      <header className="mt-8 text-center">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{m.pricing.title}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-zinc-400">{m.pricing.subtitle}</p>
        <div role="group" aria-label={m.pricing.title} className="mt-8 inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
          {[false, true].map((isYearly) => (
            <button
              key={String(isYearly)}
              type="button"
              aria-pressed={yearly === isYearly}
              onClick={() => setYearly(isYearly)}
              className={clsx("rounded-full px-4 py-1.5 transition", yearly === isYearly ? "bg-primary text-white" : "text-zinc-300 hover:text-white")}
            >
              {isYearly ? `${m.pricing.yearly} · ${m.pricing.save}` : m.pricing.monthly}
            </button>
          ))}
        </div>
      </header>

      <section className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PLANS.map((plan, index) => {
          const featured = plan.key === "professional";
          const price = plan.price === null ? null : yearly ? Math.round(plan.price * (1 - YEARLY_DISCOUNT)) : plan.price;
          return (
            <article
              key={plan.key}
              style={{ animationDelay: `${index * 60}ms` }}
              className={clsx("glass relative flex animate-fade-up flex-col p-6", featured && "border-primary/60 ring-1 ring-primary/40")}
            >
              {featured && (
                <span className="absolute -top-3 left-6 rounded-full bg-primary px-3 py-1 text-xs font-medium">{m.pricing.popular}</span>
              )}
              <h2 className="text-lg font-semibold">{m.pricing.plans[plan.key].name}</h2>
              <p className="mt-2 min-h-10 text-sm text-zinc-400">{m.pricing.plans[plan.key].description}</p>
              <p className="mt-6 text-4xl font-semibold tabular-nums">{price === null ? m.pricing.custom : currency.format(price)}</p>
              <p className="mt-1 h-5 text-sm text-zinc-400">
                {price === null ? "" : yearly ? `${m.pricing.perMonth} · ${m.pricing.billedYearly}` : m.pricing.perMonth}
              </p>
              <ul className="mt-6 flex-1 space-y-2 text-sm">
                {CARD_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <span>
                      <span className="text-zinc-400">{m.pricing.features[feature]}: </span>
                      {cellLabel(MATRIX[feature][plan.key])}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href={plan.price === null ? "/contact" : "/dashboard"}
                className={clsx(
                  "mt-6 rounded-full px-4 py-2.5 text-center text-sm font-medium transition",
                  featured ? "bg-primary hover:bg-primary/90" : "border border-white/10 bg-white/5 hover:bg-white/10",
                )}
              >
                {plan.price === null ? m.pricing.contact : m.pricing.start}
                <span className="sr-only"> · {m.pricing.plans[plan.key].name}</span>
              </Link>
            </article>
          );
        })}
      </section>

      <section className="mt-20">
        <h2 className="text-center text-2xl font-semibold sm:text-3xl">{m.pricing.compareTitle}</h2>

        <div className="glass mt-8 hidden p-2 md:block">
          <table className="w-full table-fixed text-left text-sm">
            <thead>
              <tr className="text-zinc-400">
                <th scope="col" className="w-1/4 px-4 py-3 font-medium">
                  {m.pricing.feature}
                </th>
                {PLANS.map((plan) => (
                  <th key={plan.key} scope="col" className="px-4 py-3 font-medium text-white">
                    {m.pricing.plans[plan.key].name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {FEATURE_ORDER.map((feature) => (
                <tr key={feature}>
                  <th scope="row" className="px-4 py-3 font-medium text-zinc-300">
                    {m.pricing.features[feature]}
                  </th>
                  {PLANS.map((plan) => (
                    <td key={plan.key} className="px-4 py-3">
                      <CellValue cell={MATRIX[feature][plan.key]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 space-y-3 md:hidden">
          {FEATURE_ORDER.map((feature) => (
            <div key={feature} className="glass p-4">
              <h3 className="font-medium">{m.pricing.features[feature]}</h3>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {PLANS.map((plan) => (
                  <div key={plan.key} className="min-w-0">
                    <dt className="text-xs text-zinc-400">{m.pricing.plans[plan.key].name}</dt>
                    <dd className="truncate">
                      <CellValue cell={MATRIX[feature][plan.key]} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
