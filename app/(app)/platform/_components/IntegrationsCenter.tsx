"use client";

import { useMemo, useState } from "react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Plug } from "lucide-react";
import { newConnection, reduce, type Connection, type ConnectionEvent } from "@/lib/contracts/platform/connection";
import { ConnectionPanel } from "./ConnectionPanel";
import { PROVIDER_IDS, PROVIDER_MANIFESTS, type ConnectionStatus, type ProviderId } from "@/lib/contracts/platform/integrations";

const STATUS_LABEL: Record<ConnectionStatus, string> = { notConnected: "No conectado", pending: "Pendiente", active: "Activo", degraded: "Degradado", paused: "Pausado", error: "Con error", revoked: "Revocado" };
const STATUS_TONE: Record<ConnectionStatus, BadgeTone> = { notConnected: "neutral", pending: "warning", active: "success", degraded: "warning", paused: "neutral", error: "danger", revoked: "danger" };

// Demo state only: nothing here reaches a provider. The same reducer will run on the server once adapters exist.
export function IntegrationsCenter() {
  const [connections, setConnections] = useState<Record<ProviderId, Connection>>(() => Object.fromEntries(PROVIDER_IDS.map((id) => [id, newConnection(id)])) as Record<ProviderId, Connection>);
  const [selected, setSelected] = useState<ProviderId | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const send = (provider: ProviderId, event: ConnectionEvent) => {
    const result = reduce(connections[provider], event);
    setConnections((current) => ({ ...current, [provider]: result.connection }));
    setMessage(result.error ?? null);
  };

  const active = useMemo(() => PROVIDER_IDS.filter((id) => connections[id].status === "active").length, [connections]);

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted" aria-live="polite">
        {active} de {PROVIDER_IDS.length} activos · simulación local: no se contacta a ningún proveedor.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PROVIDER_IDS.map((id) => {
          const connection = connections[id];
          return (
            <Card as="li" key={id} className="space-y-3 p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{PROVIDER_MANIFESTS[id].label}</h2>
                <Badge tone={STATUS_TONE[connection.status]}>{STATUS_LABEL[connection.status]}</Badge>
              </div>
              {connection.errors.length > 0 && <p className="text-xs text-danger">{connection.errors.length} errores registrados</p>}
              <Button size="sm" variant={selected === id ? "primary" : "secondary"} onClick={() => { setSelected(selected === id ? null : id); setMessage(null); }}>
                {selected === id ? "Cerrar" : "Administrar"}
              </Button>
            </Card>
          );
        })}
      </ul>
      {selected ? (
        <ConnectionPanel connection={connections[selected]} message={message} send={(event) => send(selected, event)} />
      ) : (
        <EmptyState icon={Plug} title="Elija una integración">Aquí verá su configuración, permisos, registros, errores y auditoría.</EmptyState>
      )}
    </div>
  );
}
