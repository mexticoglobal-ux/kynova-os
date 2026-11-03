import { ModuleView } from "@/components/module/ModuleView";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.modules.finance.title,
  description: es.modules.finance.subtitle,
  path: "/finance",
});

export default function FinancePage() {
  return <ModuleView moduleKey="finance" />;
}
