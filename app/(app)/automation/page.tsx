import { ModuleView } from "@/components/module/ModuleView";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.modules.automation.title,
  description: es.modules.automation.subtitle,
  path: "/automation",
});

export default function AutomationPage() {
  return <ModuleView moduleKey="automation" />;
}
