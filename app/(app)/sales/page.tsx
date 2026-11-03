import { ModuleView } from "@/components/module/ModuleView";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.modules.sales.title,
  description: es.modules.sales.subtitle,
  path: "/sales",
});

export default function SalesPage() {
  return <ModuleView moduleKey="sales" />;
}
