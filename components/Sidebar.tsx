import Link from "next/link";
import { nav, site } from "@/config/site";
export default function Sidebar(){return <aside className="glass m-4 hidden w-60 shrink-0 p-5 md:block"><p className="mb-8 font-semibold">{site.product}</p>
<ul className="space-y-1 text-sm text-zinc-400">{nav.map(([l,h])=><li key={h}><Link href={h} className="block rounded-xl px-3 py-2 hover:bg-white/5 hover:text-white">{l}</Link></li>)}</ul></aside>}
