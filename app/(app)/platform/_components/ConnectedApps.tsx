"use client";

import { useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  CONNECTORS, PROVIDER_FAMILIES, applyConnectorsEvents, connectedApps, connectorHealth, newConnectorsState, reduceConnectors,
  type ConnectorEnv, type ConnectorId, type ConnectorsEvent, type DisplayStatus, type HealthStatus,
} from "@/lib/contracts/platform/connectors";
import { workspaceView } from "@/lib/integrations/google/view";
import type { ConnectionActivity } from "@/lib/integrations/google/workspace";

const TENANT = "tenant-demo";
const OWNER = "demo-owner";
const AT = "2026-11-12T12:00:00.000Z";
const STATUS_LABEL: Record<DisplayStatus, string> = { Connected: "Conectada", Disconnected: "Desconectada", "Pending Authorization": "Pendiente de autorización", Error: "Con error" };
const STATUS_TONE: Record<DisplayStatus, BadgeTone> = { Connected: "success", Disconnected: "neutral", "Pending Authorization": "warning", Error: "danger" };
const HEALTH_LABEL: Record<HealthStatus, string> = { operational: "Operativo", degraded: "Degradado", down: "Caído", notConfigured: "Sin configurar" };
const HEALTH_TONE: Record<HealthStatus, BadgeTone> = { operational: "success", degraded: "warning", down: "danger", notConfigured: "neutral" };
const GRANT_LABEL = { off: "apagado", approval: "con aprobación", auto: "automático" } as const;
// In this preview the app credentials count as configured so the flow can be shown: nothing leaves the browser and no provider is contacted.
const ENV: ConnectorEnv = { configuredFamilies: [...PROVIDER_FAMILIES], workers: [] };
const th = "px-2 py-1.5 text-left text-xs font-medium text-ink-muted";
const td = "px-2 py-2 align-top text-sm";
const nonce = (counter: number) => `demo-state-${String(counter).padStart(8, "0")}-abcdef`;
const challenge = (counter: number) => `demo-challenge-${String(counter).padStart(8, "0")}-abcdefghijklmnopqrst`.padEnd(43, "x");

// The Connected Apps screen. It runs the same reducer the server will run, in the browser, with simulated providers: the provider's consent is a click, tokens do not exist and nothing
// is persisted or sent. Connecting asks the reducer to start the authorization and then simulates the provider's callback.
export function ConnectedApps() {
  const [state, setState] = useState(() => applyConnectorsEvents(newConnectorsState(), [{ tenantId: TENANT, actor: OWNER, at: AT, type: "tenant.enable" }], ENV).state);
  const [counter, setCounter] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const [activities, setActivities] = useState<readonly ConnectionActivity[]>([]);

  const run = (events: ConnectorsEvent[]) => {
    let current = state;
    let error: string | null = null;
    for (const event of events) {
      const result = reduceConnectors(current, event, ENV);
      if (result.error) { error = result.error; break; }
      current = result.state;
    }
    setState(current);
    setMessage(error);
  };
  const connect = (id: ConnectorId) => {
    const reads = CONNECTORS[id].scopes.filter((scope) => scope.effect === "read").map((scope) => scope.id);
    const code = counter;
    setCounter(code + 1);
    run([
      { tenantId: TENANT, actor: OWNER, at: AT, type: "connect.start", connectorId: id, scopes: reads, redirectUri: "https://kynova.example/oauth/callback", state: nonce(code), codeChallenge: challenge(code) },
      { tenantId: TENANT, actor: "system", at: AT, type: "oauth.callback", connectorId: id, state: nonce(code), code: "simulated-code", accountId: `${id}-demo-account`, accountLabel: `cuenta-de-ejemplo@${id}.test`, grantedScopes: reads },
    ]);
  };
  const disconnect = (connectionId: string) => { run([{ tenantId: TENANT, actor: OWNER, at: AT, type: "connection.disconnect", connectionId }]); setActivities((current) => current.filter((item) => item.connectionId !== connectionId)); };
  // The example sync turns the read permission on and records a run with example items (opaque ids): no Google call is made here.
  const syncExample = (connectionId: string, connectorId: ConnectorId) => {
    const connection = state.connections.find((row) => row.id === connectionId);
    if (!connection) return;
    const reads = CONNECTORS[connectorId].scopes.filter((scope) => scope.effect === "read" && connection.grantedScopes.includes(scope.id));
    run([
      ...reads.map((scope): ConnectorsEvent => ({ tenantId: TENANT, actor: OWNER, at: AT, type: "permissions.set", connectionId, scope: scope.id, grant: "auto" })),
      ...CONNECTORS[connectorId].syncKinds.map((kind): ConnectorsEvent => ({ tenantId: TENANT, actor: "system", at: AT, type: "sync.run", connectionId, kind })),
    ]);
    const seen = { id: `ejemplo-${connectorId}`, at: AT };
    setActivities((current) => [...current.filter((item) => item.connectionId !== connectionId), { connectionId, tenantId: TENANT, lastSyncAt: AT, recent: ["ok"], consecutiveFailures: 0, needsReauthorization: false, ...(connectorId === "gmail" ? { lastEmail: seen } : connectorId === "googleCalendar" ? { lastEvent: seen } : { lastFile: seen }) }]);
  };

  const rows = connectedApps(state, TENANT, ENV, AT);
  const health = connectorHealth(state, ENV, TENANT);
  const google = workspaceView(state, activities, TENANT, AT);
  const when = (value?: string) => (value ? new Date(value).toLocaleString("es-CR") : "—");
  const connected = rows.filter((row) => row.display === "Connected").length;

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted" aria-live="polite">{connected} de {rows.length} conectadas · simulación local: no se contacta a ningún proveedor ni se guarda ninguna credencial.</p>
      {message && <p role="alert" className="text-sm text-danger">{message}</p>}
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Salud por proveedor</h2>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" aria-label="Salud por proveedor">
          {health.map((row) => (
            <li key={row.group} className="flex items-center justify-between gap-2 rounded-xl bg-raised/60 px-3 py-2">
              <span className="text-sm font-medium">{row.label}</span>
              <Badge tone={HEALTH_TONE[row.status]}>{HEALTH_LABEL[row.status]}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <div className="overflow-x-auto">
          <table className="w-full" aria-label="Aplicaciones conectadas">
            <thead>
              <tr><th className={th}>Aplicación</th><th className={th}>Estado</th><th className={th}>Última sincronización</th><th className={th}>Permisos</th><th className={th}>Empresa</th><th className={th}><span className="sr-only">Acción</span></th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.connectorId} className="border-t border-line">
                  <td className={td}><div className="font-medium">{row.label}</div><div className="text-xs text-ink-muted">{row.provider}</div></td>
                  <td className={td}><Badge tone={STATUS_TONE[row.display]}>{STATUS_LABEL[row.display]}</Badge>{row.error && <div className="mt-1 text-xs text-danger">{row.error}</div>}</td>
                  <td className={td}>{row.lastSyncAt ? new Date(row.lastSyncAt).toLocaleString("es-CR") : "Nunca"}</td>
                  <td className={td}>
                    {row.permissions.length === 0 ? <span className="text-ink-muted">—</span> : <ul className="space-y-0.5 text-xs">{row.permissions.map((permission) => <li key={permission.scope}>{permission.label}: {GRANT_LABEL[permission.grant]}</li>)}</ul>}
                  </td>
                  <td className={td}>{row.tenantId}</td>
                  <td className={td}>
                    {row.canDisconnect && row.connectionId
                      ? <Button size="sm" variant="secondary" onClick={() => disconnect(row.connectionId as string)} aria-label={`Desconectar ${row.label}`}>Desconectar</Button>
                      : <Button size="sm" variant="primary" disabled={!row.canConnect} onClick={() => connect(row.connectorId)} aria-label={`Conectar ${row.label}`}>Conectar</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="space-y-3 p-5">
        <h2 className="font-semibold">Google Workspace</h2>
        <div className="overflow-x-auto">
          <table className="w-full" aria-label="Google Workspace">
            <thead>
              <tr><th className={th}>Aplicación</th><th className={th}>Cuenta</th><th className={th}>Estado</th><th className={th}>Última sincronización</th><th className={th}>Último correo</th><th className={th}>Último evento</th><th className={th}>Último archivo</th><th className={th}>Health Score</th><th className={th}><span className="sr-only">Acción</span></th></tr>
            </thead>
            <tbody>
              {google.map((row) => (
                <tr key={row.connectorId} className="border-t border-line">
                  <td className={td}>{row.label}</td>
                  <td className={td}>{row.account ?? "—"}</td>
                  <td className={td}><Badge tone={STATUS_TONE[row.display]}>{STATUS_LABEL[row.display]}</Badge></td>
                  <td className={td}>{when(row.lastSyncAt)}</td>
                  <td className={td}>{when(row.lastEmail?.at)}</td>
                  <td className={td}>{when(row.lastEvent?.at)}</td>
                  <td className={td}>{when(row.lastFile?.at)}</td>
                  <td className={td}><span aria-label={`Health Score de ${row.label}`}>{row.healthScore}</span></td>
                  <td className={td}>{row.connectionId && row.display === "Connected" ? <Button size="sm" variant="secondary" onClick={() => syncExample(row.connectionId as string, row.connectorId)} aria-label={`Sincronizar ${row.label} (ejemplo)`}>Sincronizar (ejemplo)</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-muted">Datos de ejemplo: la conexión real con Google se activa con las credenciales de la aplicación en Wrangler. Aquí nunca se muestra el contenido de un correo, un evento o un archivo.</p>
      </Card>
      <p className="text-xs text-ink-muted">Cada empresa autoriza solo sus cuentas. Los Agentes IA no hablan con ningún proveedor: piden a un Worker, y el conector ejecuta. Lo que sale de la plataforma siempre lo aprueba una persona.</p>
    </div>
  );
}
