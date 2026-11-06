import { AppShell } from "@/components/shell/AppShell";
import { PipelineProvider } from "@/components/pipeline/PipelineProvider";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <PipelineProvider>
      <AppShell>{children}</AppShell>
    </PipelineProvider>
  );
}
