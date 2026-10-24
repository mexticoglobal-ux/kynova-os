import { ModuleView } from "@/components/module/ModuleView";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.modules.settings.title,
  description: es.modules.settings.subtitle,
  path: "/settings",
});

export default function SettingsPage() {
  return <ModuleView moduleKey="settings" />;
}
