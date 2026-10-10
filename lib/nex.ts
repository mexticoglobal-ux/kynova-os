import type { Message } from "@/types";
// Replace with a Cloudflare Workers AI call (env.AI.run) behind /api/nex.
export async function askNex(history:Message[]):Promise<string>{
  await new Promise(r=>setTimeout(r,900));
  return "I reviewed your pipeline: 3 leads haven't been contacted in 48h. Want me to draft follow-ups?";
}
