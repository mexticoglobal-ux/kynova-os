import Link from "next/link";
import Particles from "@/components/Particles";
import { site } from "@/config/site";
export default function Landing(){return(
<main className="relative min-h-screen overflow-hidden"><div className="glow absolute inset-0"/><Particles/>
<header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-8"><span className="font-semibold tracking-tight">{site.name}</span>
<nav className="flex gap-6 text-sm text-zinc-400"><Link href="/pricing">Pricing</Link><Link href="/dashboard">Dashboard</Link></nav></header>
<section className="relative mx-auto max-w-4xl px-6 pb-40 pt-28 text-center">
<h1 className="text-6xl font-semibold tracking-tight md:text-8xl">{site.product}</h1>
<p className="mt-6 text-2xl text-zinc-300">The AI Operating System for Business</p>
<p className="mx-auto mt-6 max-w-xl text-zinc-400">Your AI executive team helping businesses grow faster through intelligent decisions and automation.</p>
<div className="mt-12 flex justify-center gap-4"><Link href="/dashboard" className="rounded-full bg-primary px-8 py-3 font-medium">Start free</Link>
<Link href="/pricing" className="glass px-8 py-3 !rounded-full">Book demo</Link></div></section></main>)}
