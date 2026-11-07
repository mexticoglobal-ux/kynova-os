import { Plug } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ACTION_LEVELS, WORKER_TEMPLATES } from "@/lib/contracts/platform/workers";
import { AUTOMATION_TEMPLATES, validateAutomation } from "@/lib/contracts/platform/automations";

const LEVEL_TONE: Record<1 | 2 | 3, BadgeTone> = { 1: "success", 2: "warning", 3: "danger" };
const LEVEL_LABEL = { 1: "Nivel 1 · observa y prepara", 2: "Nivel 2 · autorizado", 3: "Nivel 3 · siempre confirma" } as const;

const Soon = ({ children }: { children: string }) => (
  <Button variant="secondary" size="sm" disabled title="Disponible cuando se conecte el proveedor">
    {children}
  </Button>
);

export function AcademySection() {
  return (
    <div className="space-y-4">
      <EmptyState icon={Plug} title="Aún no hay cursos">
        Los cursos tendrán lecciones, una prueba opcional y certificado al completar lo obligatorio.
      </EmptyState>
      <Soon>Crear curso</Soon>
    </div>
  );
}

export function WorkersSection() {
  return (
    <div className="space-y-4">
      <ul className="grid gap-4 sm:grid-cols-2">
        {WORKER_TEMPLATES.map((worker) => (
          <Card as="li" key={worker.id} className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{worker.name}</h2>
              <Badge tone={LEVEL_TONE[worker.highestLevel]}>{LEVEL_LABEL[worker.highestLevel]}</Badge>
            </div>
            <p className="text-sm text-ink-muted">{worker.summary}</p>
            <p className="text-xs text-ink-muted">Herramientas: {worker.tools.length} · inactivo</p>
            <Soon>Activar</Soon>
          </Card>
        ))}
      </ul>
      <p className="text-xs text-ink-muted">
        El nivel de cada acción lo decide el código, no el modelo; lo desconocido pide confirmación. {Object.keys(ACTION_LEVELS).length} acciones catalogadas.
      </p>
    </div>
  );
}

export function AutomationsSection() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {AUTOMATION_TEMPLATES.map((template) => {
        const report = validateAutomation(template);
        return (
          <Card as="li" key={template.name} className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold">{template.name}</h2>
              <Badge>Plantilla</Badge>
            </div>
            <p className="text-sm text-ink-muted">{template.actions.length} acciones · modo de prueba</p>
            {report.approvalActions.length > 0 && <Badge tone="accent">Pide aprobación antes de enviar</Badge>}
            <Soon>Usar plantilla</Soon>
          </Card>
        );
      })}
    </ul>
  );
}
