"use client";

import { LogOut } from "lucide-react";
import { ROLE_LABEL } from "@/lib/contracts/backend";
import { useSession } from "./SessionProvider";

// Company switcher and sign-out, only when there is a real session.
export function AccountMenu() {
  const session = useSession();
  if (session.mode !== "backend") return null;

  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      {session.memberships.length > 1 ? (
        <select
          aria-label="Empresa activa"
          value={session.tenantId}
          onChange={(event) => session.selectTenant(event.target.value)}
          className="field h-9 max-w-[10rem] truncate rounded-full py-0 text-sm sm:max-w-[14rem]"
        >
          {session.memberships.map((membership) => (
            <option key={membership.tenantId} value={membership.tenantId} className="bg-surface text-ink">
              {membership.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="hidden max-w-[12rem] truncate text-ink-soft sm:inline">{session.tenantName}</span>
      )}
      <span className="hidden rounded-full bg-raised px-2.5 py-1 text-xs text-ink-muted md:inline" title={session.email ?? undefined}>
        {ROLE_LABEL[session.role]}
      </span>
      <button type="button" onClick={() => void session.signOut()} aria-label="Cerrar sesión" className="rounded-full p-2 text-ink-muted transition hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <LogOut aria-hidden className="h-4 w-4" />
      </button>
    </div>
  );
}
