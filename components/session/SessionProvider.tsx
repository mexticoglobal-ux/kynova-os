"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { can, type MembershipDto, type Permission, type Role } from "@/lib/contracts/backend";
import { TENANT_COOKIE } from "@/lib/auth/paths";

// Who is using the app and as what. In demonstration mode (no Supabase project) the user is a local owner with
// nothing persisted; in backend mode everything below comes from the database.
type SessionValue =
  | { mode: "demo"; tenantId: null; role: Role; can: (permission: Permission) => boolean }
  | {
      mode: "backend";
      userId: string;
      email: string | null;
      displayName: string;
      memberships: MembershipDto[];
      tenantId: string;
      tenantName: string;
      role: Role;
      can: (permission: Permission) => boolean;
      selectTenant: (tenantId: string) => void;
      signOut: () => Promise<void>;
    };

const DEMO_SESSION: SessionValue = { mode: "demo", tenantId: null, role: "owner", can: (permission) => can("owner", permission) };

const SessionContext = createContext<SessionValue | null>(null);

type BackendInput = { userId: string; email: string | null; displayName: string; memberships: MembershipDto[]; active: MembershipDto };

export function SessionProvider({ children, backend }: { children: ReactNode; backend?: BackendInput }) {
  const router = useRouter();

  const selectTenant = useCallback(
    (tenantId: string) => {
      document.cookie = `${TENANT_COOKIE}=${tenantId}; path=/; max-age=31536000; samesite=lax`;
      router.refresh();
    },
    [router],
  );

  const signOut = useCallback(async () => {
    await fetch("/api/auth/sign-out", { method: "POST" });
    window.location.assign("/login");
  }, []);

  const value = useMemo<SessionValue>(() => {
    if (!backend) return { mode: "demo", tenantId: null, role: "owner", can: (permission) => can("owner", permission) };
    const role = backend.active.role;
    return {
      mode: "backend",
      userId: backend.userId,
      email: backend.email,
      displayName: backend.displayName,
      memberships: backend.memberships,
      tenantId: backend.active.tenantId,
      tenantName: backend.active.name,
      role,
      can: (permission) => can(role, permission),
      selectTenant,
      signOut,
    };
  }, [backend, selectTenant, signOut]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  // Without a provider (isolated components, tests) the app behaves as the local demonstration.
  return useContext(SessionContext) ?? DEMO_SESSION;
}
