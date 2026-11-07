import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { AUTOMATION_TEMPLATES, validateAutomation } from "@/lib/contracts/platform/automations";


const Soon = ({ children }: { children: string }) => (
  <Button variant="secondary" size="sm" disabled title="Disponible cuando se conecte el proveedor">
    {children}
  </Button>
);

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
