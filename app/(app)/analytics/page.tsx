import { ModuleView } from "@/components/module/ModuleView";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.modules.analytics.title,
  description: es.modules.analytics.subtitle,
  path: "/analytics",
});

export default function AnalyticsPage() {
  return <ModuleView moduleKey="analytics" />;
}
