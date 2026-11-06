"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { usePipeline } from "@/components/pipeline/PipelineProvider";
import { GuidedChat } from "./GuidedChat";

// The guided chat wired to the shared pipeline: when the conversation ends, the prospect appears in the Pipeline and the Dashboard.
export function ConnectedGuidedChat({ paceMs }: { paceMs?: number }) {
  const { pack, receiveHandoff } = usePipeline();
  return (
    <GuidedChat
      pack={pack}
      paceMs={paceMs}
      onHandoff={receiveHandoff}
      endActions={
        <div className="mb-3 flex flex-wrap gap-2">
          <Link href="/sales" className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-white transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
            Ver el prospecto en el Pipeline
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
          <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            Volver al Dashboard
          </Link>
        </div>
      }
    />
  );
}
