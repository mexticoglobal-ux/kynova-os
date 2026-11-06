import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { PipelineProvider } from "@/components/pipeline/PipelineProvider";
import { SessionProvider } from "@/components/session/SessionProvider";
import { loadServerSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const state = await loadServerSession();
  if (state.kind === "anonymous") redirect("/login");

  if (state.kind === "unavailable") {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <p role="alert" className="card max-w-md p-6 text-center text-ink-soft">
          No pudimos conectar con el servidor. Tus datos están a salvo: recarga la página en un momento.
        </p>
      </main>
    );
  }

  if (state.kind === "demo") {
    return (
      <SessionProvider>
        <PipelineProvider>
          <AppShell>{children}</AppShell>
        </PipelineProvider>
      </SessionProvider>
    );
  }

  if (!state.active) redirect("/onboarding");
  const { session, active } = state;
  return (
    <SessionProvider backend={{ userId: session.userId, email: session.email, displayName: session.displayName, memberships: session.memberships, active }}>
      <PipelineProvider backend={{ tenantId: active.tenantId }} seed={false}>
        <AppShell>{children}</AppShell>
      </PipelineProvider>
    </SessionProvider>
  );
}
