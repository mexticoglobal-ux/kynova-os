"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import Sidebar from "@/components/Sidebar";
import { askNex } from "@/lib/nex";
import type { Message } from "@/types";
const prompts=["Summarize my week","Which leads need follow-up?","Forecast next month's cash flow"];
export default function Nex(){const [msgs,setMsgs]=useState<Message[]>([]);const [text,setText]=useState("");const [busy,setBusy]=useState(false);
async function send(t:string){if(!t.trim()||busy)return;const next=[...msgs,{role:"user" as const,text:t}];setMsgs(next);setText("");setBusy(true);
const r=await askNex(next);setMsgs([...next,{role:"nex",text:r}]);setBusy(false)}
return(<div className="flex min-h-screen"><Sidebar/><main className="mx-auto flex max-w-3xl flex-1 flex-col p-6">
<div className="flex-1 space-y-4 py-8">{msgs.length===0&&<div className="pt-24 text-center"><h1 className="text-4xl font-semibold">Ask NEX anything</h1>
<div className="mt-8 flex flex-wrap justify-center gap-3">{prompts.map(p=><button key={p} onClick={()=>send(p)} className="glass px-4 py-2 text-sm">{p}</button>)}</div></div>}
{msgs.map((m,i)=><motion.div key={i} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} className={m.role==="user"?"ml-auto max-w-[80%] rounded-2xl bg-primary px-4 py-3":"glass max-w-[80%] px-4 py-3"}>{m.text}</motion.div>)}
{busy&&<div className="glass inline-flex gap-1 px-4 py-3" aria-label="NEX is typing">{[0,1,2].map(i=><motion.span key={i} className="h-2 w-2 rounded-full bg-zinc-400" animate={{opacity:[.3,1,.3]}} transition={{repeat:Infinity,duration:1,delay:i*.2}}/>)}</div>}</div>
<div className="glass flex gap-3 p-3"><input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send(text)} placeholder="Message NEX" className="flex-1 bg-transparent px-3 outline-none"/>
<button onClick={()=>send(text)} className="rounded-xl bg-primary px-5 py-2">Send</button></div></main></div>)}
