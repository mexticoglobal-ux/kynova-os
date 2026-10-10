import type { Config } from "tailwindcss";
export default { content:["./app/**/*.{ts,tsx}","./components/**/*.{ts,tsx}"],
theme:{extend:{colors:{bg:"#09090B",primary:"#2563EB",accent:"#7C3AED",success:"#22C55E",warning:"#F59E0B",danger:"#EF4444"},
borderRadius:{card:"20px"},fontFamily:{sans:["Inter","system-ui","sans-serif"]}}},plugins:[]} satisfies Config;
