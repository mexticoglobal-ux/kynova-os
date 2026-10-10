"use client";
import { motion } from "framer-motion";
export default function Particles(){return <div aria-hidden className="absolute inset-0 overflow-hidden">{Array.from({length:24},(_,i)=>
<motion.span key={i} className="absolute h-1 w-1 rounded-full bg-white/30" style={{left:`${(i*37)%100}%`,top:`${(i*53)%100}%`}}
animate={{y:[0,-30,0],opacity:[.2,.7,.2]}} transition={{duration:6+(i%5),repeat:Infinity,delay:i*.2}}/>)}</div>}
