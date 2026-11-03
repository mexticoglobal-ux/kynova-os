import { ModuleView } from "@/components/module/ModuleView";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.modules.clients.title,
  description: es.modules.clients.subtitle,
  path: "/clients",
});

export default function ClientsPage() {
  return <ModuleView moduleKey="clients" />;
}
