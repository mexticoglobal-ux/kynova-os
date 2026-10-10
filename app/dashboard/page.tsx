import Sidebar from "@/components/Sidebar";
const scores=[["Sales",82],["Marketing",64],["Finance",77],["Automation",58],["Customer experience",88],["Growth",71]] as const;
export const metadata={title:"Dashboard"};
export default function Dashboard(){const overall=Math.round(scores.reduce((a,s)=>a+s[1],0)/scores.length);return(
<div className="flex min-h-screen"><Sidebar/><main className="flex-1 space-y-6 p-6 md:p-10">
<h1 className="text-3xl font-semibold">Good morning, Jeffrey.</h1><p className="text-zinc-400">NEX analyzed your business overnight.</p>
<div className="grid gap-6 lg:grid-cols-3">
<section className="glass p-8"><h2 className="text-sm text-zinc-400">Business health score</h2><p className="mt-3 text-7xl font-semibold text-success">{overall}</p>
<ul className="mt-6 space-y-3">{scores.map(([l,v])=><li key={l} className="text-sm"><div className="flex justify-between"><span>{l}</span><span>{v}</span></div>
<div className="mt-1 h-1.5 rounded bg-white/10"><div className="h-full rounded bg-primary" style={{width:`${v}%`}}/></div></li>)}</ul></section>
<section className="glass p-8"><h2 className="text-sm text-zinc-400">Today's revenue</h2><p className="mt-3 text-4xl font-semibold">$12,480</p><p className="mt-2 text-sm text-success">+8.2% vs yesterday</p></section>
<section className="glass p-8"><h2 className="text-sm text-zinc-400">Recommended actions</h2><ul className="mt-4 space-y-3 text-sm"><li>Follow up with 3 uncontacted leads</li><li>Review the Q4 ad budget</li><li>Approve 2 pending invoices</li></ul></section></div></main></div>)}
