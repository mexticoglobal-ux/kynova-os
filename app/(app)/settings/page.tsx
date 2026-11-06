import { ModuleView } from "@/components/module/ModuleView";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";
import { CompanyProfile } from "./_components/CompanyProfile";
import { WorkspaceAdmin } from "./_components/WorkspaceAdmin";

export const metadata = pageMetadata({
  title: es.modules.settings.title,
  description: es.modules.settings.subtitle,
  path: "/settings",
});

export default function SettingsPage() {
  return (
    <ModuleView moduleKey="settings">
      <div className="space-y-6">
        <WorkspaceAdmin />
        <CompanyProfile />
      </div>
    </ModuleView>
  );
}
