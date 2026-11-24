"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useSession } from "@/components/session/SessionProvider";
import { apiFetch } from "@/lib/api/client";
import { FAILURE_MESSAGES, isFailureCode, type ConnectionState, type YoutubeStatus } from "@/lib/contracts/youtube-connection";

const LABEL: Record<ConnectionState, string> = { disconnected: "Desconectado", connected: "Conectado", expired: "Autorización vencida", error: "Con error" };
const TONE: Record<ConnectionState, BadgeTone> = { disconnected: "neutral", connected: "success", expired: "warning", error: "danger" };
const when = (value: string | null) => (value ? new Date(value).toLocaleString("es-CR") : "—");

const SETUP_STEPS = [
  "En Google Cloud Console crea un proyecto y activa la API «YouTube Data API v3».",
  "En «Pantalla de consentimiento de OAuth» elige «Externo», déjala en «Pruebas», añade como usuarios de prueba las cuentas de Google que van a conectar un canal y agrega solo el permiso youtube.readonly.",
  "En «Credenciales» crea un «ID de cliente de OAuth» de tipo «Aplicación web» y añade como URI de redireccionamiento autorizado: https://<tu-dominio>/api/v1/connections/youtube/callback (una por entorno).",
  "Guarda los valores como secretos de Wrangler (no en el repositorio ni en el chat): GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, KYNOVA_ENCRYPTION_KEY y SUPABASE_SERVICE_ROLE_KEY.",
  "Vuelve a cargar esta página: el botón «Conectar canal de YouTube» se activa cuando el servidor tiene todo.",
];

// The REAL connection of a YouTube channel (ADR-0038). Everything it shows comes from the server: "Conectado" appears only when the database says the connection exists with the channel Google returned
// for the account that authorized. Nothing here is simulated, and the browser never sees a credential: it only receives a name, an id, a state and dates. Read only: this screen cannot upload, schedule or publish.
export function YouTubeConnection() {
  const session = useSession();
  const tenantId = session.mode === "backend" ? session.tenantId : null;
  const canManage = session.can("admin");
  const [status, setStatus] = useState<YoutubeStatus | null>(null);
  const [loading, setLoading] = useState(tenantId !== null);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const result = await apiFetch<YoutubeStatus>(`/api/v1/connections/youtube?tenantId=${encodeURIComponent(tenantId)}`);
    setLoading(false);
    if (result.ok) { setStatus(result.data); return; }
    setStatus(null);
    setProblem(result.error === "forbidden" ? FAILURE_MESSAGES.forbidden : FAILURE_MESSAGES.unavailable);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  // The result of the OAuth return arrives as a short word in the address; it is shown once and removed from the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const error = params.get("youtube_error");
    if (params.get("youtube") === "connected") setNotice("Canal conectado: KYNOVA confirmó su nombre e identificador con YouTube.");
    else if (error) setProblem(isFailureCode(error) ? FAILURE_MESSAGES[error] : FAILURE_MESSAGES.unavailable);
    else return;
    params.delete("youtube"); params.delete("youtube_error");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }, []);

  const connect = async () => {
    if (!tenantId) return;
    setBusy(true); setProblem(null); setNotice(null);
    const result = await apiFetch<{ url: string }>("/api/v1/connections/youtube/start", { body: { tenantId } });
    if (result.ok && typeof result.data.url === "string" && result.data.url.startsWith("https://accounts.google.com/")) { window.location.assign(result.data.url); return; }
    setBusy(false);
    if (!result.ok && result.error === "not_configured") { await load(); return; }
    setProblem(!result.ok && result.error === "forbidden" ? FAILURE_MESSAGES.forbidden : FAILURE_MESSAGES.unavailable);
  };

  const verify = async () => {
    if (!tenantId) return;
    setBusy(true); setProblem(null); setNotice(null);
    const result = await apiFetch<{ status: YoutubeStatus; code: string | null }>("/api/v1/connections/youtube/verify", { body: { tenantId } });
    setBusy(false);
    if (!result.ok) { setProblem(result.error === "forbidden" ? FAILURE_MESSAGES.forbidden : FAILURE_MESSAGES.unavailable); return; }
    setStatus(result.data.status);
    if (result.data.code && isFailureCode(result.data.code)) setProblem(FAILURE_MESSAGES[result.data.code]);
    else setNotice("La autorización sigue vigente y el canal coincide.");
  };

  const disconnect = async () => {
    if (!tenantId) return;
    setBusy(true); setProblem(null); setNotice(null); setConfirming(false);
    const result = await apiFetch<{ revoked: boolean }>("/api/v1/connections/youtube/disconnect", { body: { tenantId } });
    setBusy(false);
    if (!result.ok) { setProblem(result.error === "forbidden" ? FAILURE_MESSAGES.forbidden : FAILURE_MESSAGES.unavailable); return; }
    setNotice(result.data.revoked
      ? "Canal desconectado: el permiso se eliminó de KYNOVA y se revocó en Google."
      : "Canal desconectado: el permiso se eliminó de KYNOVA. No se pudo confirmar la revocación en Google; puedes quitar el acceso en la configuración de tu cuenta de Google.");
    await load();
  };

  return (
    <Card className="space-y-4 p-5" aria-label="Conexión real de YouTube">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">YouTube — conexión real del canal</h2>
          <p className="text-xs text-ink-muted">Solo lectura: KYNOVA consulta el nombre y el identificador de tu canal. No sube, programa ni publica videos.</p>
        </div>
        {status && <Badge tone={TONE[status.state]}>{LABEL[status.state]}</Badge>}
      </div>

      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}

      {tenantId === null && <p className="text-sm text-ink-muted">Inicia sesión con una empresa para conectar un canal real.</p>}
      {tenantId !== null && loading && <p className="text-sm text-ink-muted" aria-live="polite">Consultando el estado…</p>}

      {status && !status.configured && (
        <div className="space-y-2 rounded-xl bg-raised/60 p-3 text-sm">
          <p className="font-medium">Falta configurar Google en el servidor: {status.missing.join(", ")}.</p>
          <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-muted">{SETUP_STEPS.map((step) => <li key={step}>{step}</li>)}</ol>
        </div>
      )}

      {status?.state === "connected" && status.channel && (
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="text-xs text-ink-muted">Canal</dt><dd className="font-medium">{status.channel.title}</dd></div>
          <div><dt className="text-xs text-ink-muted">Identificador del canal</dt><dd className="font-mono text-xs">{status.channel.id}</dd></div>
          <div><dt className="text-xs text-ink-muted">Conectado el</dt><dd>{when(status.connectedAt)}</dd></div>
          <div><dt className="text-xs text-ink-muted">Última verificación con YouTube</dt><dd>{when(status.lastVerifiedAt)}</dd></div>
        </dl>
      )}
      {status?.state === "expired" && <p className="text-sm text-warning">La autorización venció o fue revocada en Google. Autoriza de nuevo para seguir usando el canal.</p>}
      {status?.state === "error" && <p className="text-sm text-danger">La última verificación falló{status.lastErrorCode ? ` (${status.lastErrorCode})` : ""}. Reintenta la verificación o autoriza de nuevo.</p>}

      {status && tenantId !== null && !canManage && <p className="text-xs text-ink-muted">Solo el propietario o un administrador puede conectar o desconectar el canal.</p>}

      {status && canManage && (
        <div className="flex flex-wrap gap-2">
          {(status.state === "disconnected" || status.state === "expired") && (
            <Button size="sm" variant="primary" disabled={busy || !status.configured} onClick={() => void connect()} aria-label={status.state === "expired" ? "Autorizar YouTube de nuevo" : "Conectar canal de YouTube"}>
              {status.state === "expired" ? "Autorizar de nuevo" : "Conectar canal de YouTube"}
            </Button>
          )}
          {(status.state === "connected" || status.state === "error") && (
            <>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void verify()}>Verificar de nuevo</Button>
              {status.state === "error" && <Button size="sm" variant="secondary" disabled={busy || !status.configured} onClick={() => void connect()}>Autorizar de nuevo</Button>}
            </>
          )}
          {status.state !== "disconnected" && !confirming && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>Desconectar</Button>}
          {confirming && (
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <span>¿Desconectar y eliminar el permiso guardado?</span>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => void disconnect()}>Sí, desconectar</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancelar</Button>
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
