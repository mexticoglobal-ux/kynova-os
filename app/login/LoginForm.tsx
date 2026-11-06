"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, KeyRound, Mail } from "lucide-react";
import { Brand } from "@/components/ui/Brand";
import { Card } from "@/components/ui/Card";
import { Button, buttonClass } from "@/components/ui/Button";
import { LABEL } from "@/components/ui/form";
import { safeNext } from "@/lib/auth/paths";

const MESSAGES: Record<string, string> = {
  invalid_email: "Escribe un correo válido.",
  invalid_code: "Ese código no es correcto o ya venció. Pide uno nuevo.",
  send_failed: "No pudimos enviar el código. Inténtalo de nuevo en un momento.",
  unavailable: "No pudimos conectar con el servidor. Inténtalo de nuevo.",
  code_required: "Pide primero el código a tu correo.",
};

// Sign in or create the account with a one-time code sent to the email: no passwords to remember or leak.
export function LoginForm({ configured, next }: { configured: boolean; next: string | null }) {
  const router = useRouter();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(path: string, body: Record<string, string>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (response.ok) return true;
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setError(MESSAGES[data.error ?? ""] ?? MESSAGES.unavailable);
      return false;
    } catch {
      setError(MESSAGES.unavailable);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    if (await post("/api/auth/request", { email: email.trim() })) setStep("code");
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (await post("/api/auth/verify", { token: code.trim() })) {
      router.replace(safeNext(next));
      router.refresh();
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-md space-y-6 p-6 sm:p-8">
        <div>
          <Brand name="KYNOVA OS" />
          <h1 className="mt-5 text-2xl font-semibold">{step === "email" ? "Entra o crea tu cuenta" : "Revisa tu correo"}</h1>
          <p className="mt-2 text-sm text-ink-muted">
            {step === "email" ? "Te enviamos un código de un solo uso. No necesitas contraseña." : `Escribe el código que enviamos a ${email}.`}
          </p>
        </div>

        {!configured ? (
          <div className="space-y-4">
            <p role="status" className="rounded-xl border border-line bg-shade p-3 text-sm text-ink-soft">
              Este entorno no tiene base de datos conectada: la aplicación funciona en modo demostración, sin guardar nada.
            </p>
            <Link href="/dashboard" className={buttonClass("primary", "md", "w-full")}>
              Abrir la demostración
              <ArrowRight aria-hidden className="h-4 w-4" />
            </Link>
          </div>
        ) : step === "email" ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label htmlFor="login-email" className={LABEL}>
                Correo electrónico
              </label>
              <input id="login-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="field min-h-12 text-base" />
            </div>
            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              <Mail aria-hidden className="h-4 w-4" />
              {busy ? "Enviando…" : "Enviarme el código"}
            </Button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <div>
              <label htmlFor="login-code" className={LABEL}>
                Código
              </label>
              <input
                id="login-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,10}"
                required
                maxLength={10}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className="field min-h-12 text-center text-xl tracking-widest"
              />
            </div>
            <Button type="submit" variant="primary" disabled={busy} className="w-full">
              <KeyRound aria-hidden className="h-4 w-4" />
              {busy ? "Verificando…" : "Entrar"}
            </Button>
            <button type="button" onClick={() => { setStep("email"); setCode(""); setError(null); }} className="w-full text-sm text-ink-muted underline-offset-2 hover:underline">
              Usar otro correo
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="text-sm text-warning">
            {error}
          </p>
        )}
      </Card>
    </main>
  );
}
