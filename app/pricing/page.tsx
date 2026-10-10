"use client";
import { useState } from "react";
export default function Pricing(){const [yearly,setYearly]=useState(false);
const plans=[["Starter",49],["Professional",149],["Business",399],["Enterprise",null]] as const;
return(<main className="mx-auto max-w-6xl px-6 py-24"><h1 className="text-center text-5xl font-semibold">Pricing</h1>
<div className="mt-8 flex justify-center"><button onClick={()=>setYearly(!yearly)} className="glass px-5 py-2 text-sm">{yearly?"Yearly (save 20%)":"Monthly"}</button></div>
<div className="mt-14 grid gap-6 md:grid-cols-4">{plans.map(([n,p])=><div key={n} className="glass p-8"><h2>{n}</h2>
<p className="mt-4 text-4xl font-semibold">{p?`$${yearly?Math.round(p*.8):p}`:"Custom"}</p><p className="text-sm text-zinc-400">{p?"per month":"talk to us"}</p></div>)}</div></main>)}
