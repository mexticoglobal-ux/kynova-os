"use client";

import { useState } from "react";
import Link from "next/link";
import { m as motion } from "framer-motion";
import { ArrowRight, Bot, Play, Sparkles } from "lucide-react";
import { site } from "@/config/site";
import { formatDelta, formatValue } from "@/lib/i18n/format";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Particles } from "./Particles";

const MOCK_BARS = [38, 52, 45, 61, 58, 72, 69, 84, 80, 92];

function ProductMockup() {
  const { m, tag } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.6 }}
      className="glass relative mx-auto mt-16 max-w-4xl p-4 text-left sm:p-6"
      aria-hidden
    >
      <div className="flex items-center gap-2 border-b border-white/5 pb-3">
        <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
        <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
        <span className="ml-3 text-xs text-zinc-400">{site.product} · {m.landing.mockup.title}</span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: m.landing.mockup.revenue, value: formatValue(128900, "currency", tag), delta: formatDelta(8.2, tag) },
          { label: m.landing.mockup.leads, value: formatValue(318, "number", tag), delta: formatDelta(14, tag) },
          { label: m.landing.mockup.health, value: formatValue(73, "number", tag), delta: formatDelta(5, tag) },
        ].map((tile) => (
          <div key={tile.label} className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
            <p className="text-xs text-zinc-400">{tile.label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{tile.value}</p>
            <p className="text-xs text-success">{tile.delta}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex h-28 items-end gap-1.5 rounded-xl border border-white/5 bg-white/[0.02] p-3 sm:h-36">
        {MOCK_BARS.map((height, index) => (
          <motion.span
            key={index}
            className="flex-1 rounded-t bg-gradient-to-t from-primary/40 to-primary"
            initial={{ height: 0 }}
            animate={{ height: `${height}%` }}
            transition={{ delay: 0.5 + index * 0.05, duration: 0.5 }}
          />
        ))}
      </div>
      <motion.div
        initial={{ opacity: 0, x: 16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 1.1 }}
        className="mt-4 flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/10 p-3 text-sm"
      >
        <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <span className="text-zinc-200">{m.landing.mockup.nexTip}</span>
      </motion.div>
    </motion.div>
  );
}

function VideoPlaceholder() {
  const { m } = useI18n();
  const [requested, setRequested] = useState(false);
  return (
    <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <h2 className="text-center text-2xl font-semibold sm:text-3xl">{m.landing.video.title}</h2>
      <div className="glass relative mt-8 aspect-video overflow-hidden">
        <div aria-hidden className="glow absolute inset-0" />
        <button
          type="button"
          onClick={() => setRequested(true)}
          className="group absolute inset-0 grid place-items-center focus-visible:outline-none"
        >
          <span className="grid h-16 w-16 place-items-center rounded-full bg-white/10 backdrop-blur transition group-hover:scale-105 group-hover:bg-white/20 group-focus-visible:ring-2 group-focus-visible:ring-primary sm:h-20 sm:w-20">
            <Play aria-hidden className="ml-1 h-7 w-7" />
          </span>
          <span className="sr-only">{m.landing.video.play}</span>
        </button>
        <p role="status" className="absolute inset-x-0 bottom-4 text-center text-sm text-zinc-300">
          {requested ? m.landing.video.soon : ""}
        </p>
      </div>
    </section>
  );
}

export function LandingHero() {
  const { m } = useI18n();
  return (
    <>
      <section className="relative overflow-hidden px-4 pb-8 pt-16 text-center sm:px-6 sm:pt-24">
        <div aria-hidden className="glow absolute inset-0" />
        <Particles />
        <div className="relative mx-auto max-w-4xl">
          <span className="inline-flex animate-fade-up items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs text-zinc-300 sm:text-sm">
            <Sparkles aria-hidden className="h-3.5 w-3.5 text-primary" />
            {m.landing.badge}
          </span>
          {/* LCP element: rendered visible on first paint, no entrance animation. */}
          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight sm:text-6xl md:text-7xl">{m.landing.title}</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">{m.landing.subtitle}</p>
          <div className="mt-10 flex animate-fade-up flex-col justify-center gap-3 sm:flex-row" style={{ animationDelay: "100ms" }}>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-3 font-medium transition hover:bg-primary/90"
            >
              {m.common.startFree}
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
            <Link href="/contact" className="glass !rounded-full px-7 py-3 transition hover:bg-white/10">
              {m.common.bookDemo}
            </Link>
          </div>
          <p className="mt-5 text-sm text-zinc-400">{m.landing.trust}</p>
        </div>
        <div className="relative">
          <ProductMockup />
        </div>
      </section>
      <VideoPlaceholder />
    </>
  );
}
