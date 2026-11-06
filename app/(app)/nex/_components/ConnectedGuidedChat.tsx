"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { usePipeline } from "@/components/pipeline/PipelineProvider";
import { GuidedChat } from "./GuidedChat";
import { buttonClass } from "@/components/ui/Button";

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
          <Link href="/sales" className={buttonClass("primary", "md")}>
            Ver el prospecto en el Pipeline
            <ArrowRight aria-hidden className="h-4 w-4" />
          </Link>
          <Link href="/dashboard" className={buttonClass("secondary", "md")}>
            Volver al Dashboard
          </Link>
        </div>
      }
    />
  );
}
