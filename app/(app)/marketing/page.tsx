import { ModuleView } from "@/components/module/ModuleView";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.modules.marketing.title,
  description: es.modules.marketing.subtitle,
  path: "/marketing",
});

export default function MarketingPage() {
  return <ModuleView moduleKey="marketing" />;
}
