"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import { Brand } from "@/components/ui/Brand";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LABEL } from "@/components/ui/form";
import { TENANT_COOKIE } from "@/lib/auth/paths";

// The first thing a new user does: name their company. They become its owner, with a default pipeline and a web chat.
export function OnboardingForm({ email }: { email: string | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/companies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data = (await response.json().catch(() => ({}))) as { tenantId?: string; error?: string };
      if (!response.ok || !data.tenantId) {
        setError(data.error === "limit" ? "Llegaste al máximo de empresas por cuenta." : "No pudimos crear la empresa. Inténtalo de nuevo.");
        return;
      }
      document.cookie = `${TENANT_COOKIE}=${data.tenantId}; path=/; max-age=31536000; samesite=lax`;
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("No pudimos conectar con el servidor.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-md space-y-6 p-6 sm:p-8">
        <div>
          <Brand name="KYNOVA OS" />
          <h1 className="mt-5 text-2xl font-semibold">Crea tu empresa</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {email ? `Sesión iniciada como ${email}. ` : ""}Serás su propietario y podrás invitar a tu equipo después. Si ya te invitaron a una empresa, inicia sesión con el correo de la invitación.
          </p>
        </div>
        <form onSubmit={create} className="space-y-4">
          <div>
            <label htmlFor="company-name" className={LABEL}>
              Nombre de la empresa
            </label>
            <input id="company-name" required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} className="field min-h-12 text-base" />
          </div>
          <Button type="submit" variant="primary" disabled={busy || name.trim() === ""} className="w-full">
            <Building2 aria-hidden className="h-4 w-4" />
            {busy ? "Creando…" : "Crear empresa"}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-sm text-warning">
            {error}
          </p>
        )}
      </Card>
    </main>
  );
}
