"use client";

import { ModuleView } from "@/components/module/ModuleView";
import { useSession } from "@/components/session/SessionProvider";
import { ClientsManager } from "./ClientsManager";

// With a database the screen is the real client list; without one it stays the demonstration.
export function ClientsScreen() {
  const session = useSession();
  return session.mode === "backend" ? <ClientsManager tenantId={session.tenantId} canWrite={session.can("write")} /> : <ModuleView moduleKey="clients" />;
}
