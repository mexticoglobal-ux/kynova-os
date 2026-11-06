"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { usePipeline } from "@/components/pipeline/PipelineProvider";
import { buttonClass } from "@/components/ui/Button";
import { GuidedChat } from "./GuidedChat";

// The guided chat wired to the shared pipeline: when the conversation ends, the prospect is stored (or, in
// demonstration mode, kept in memory) and appears in the Pipeline and the Dashboard.
export function ConnectedGuidedChat({ paceMs }: { paceMs?: number }) {
  const { pack, receiveHandoff, canWrite, mode, error } = usePipeline();
  return (
    <div className="space-y-3">
      {!canWrite && (
        <p role="status" className="mx-auto max-w-2xl rounded-xl border border-line bg-shade p-3 text-sm text-ink-soft">
          Tu rol es de solo lectura: puedes ver la conversación, pero no se guardará ningún prospecto.
        </p>
      )}
      {error && (
        <p role="alert" className="mx-auto max-w-2xl rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
          {error}
        </p>
      )}
      <GuidedChat
        pack={pack}
        paceMs={paceMs}
        onHandoff={(handoff, context) => {
          if (canWrite) void receiveHandoff(handoff, context);
        }}
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
      <p className="mx-auto max-w-2xl text-center text-xs text-ink-muted">
        {mode === "backend" ? "La conversación y el diagnóstico se guardan en tu empresa." : "Modo demostración: no se guarda ni se envía nada."}
      </p>
    </div>
  );
}
