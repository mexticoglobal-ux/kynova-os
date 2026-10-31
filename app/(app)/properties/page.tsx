import { ModuleView } from "@/components/module/ModuleView";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.modules.properties.title,
  description: es.modules.properties.subtitle,
  path: "/properties",
});

export default function PropertiesPage() {
  return <ModuleView moduleKey="properties" />;
}
