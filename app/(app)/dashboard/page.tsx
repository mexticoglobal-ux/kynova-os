import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";
import { NexDashboard } from "./_components/NexDashboard";

export const metadata = pageMetadata({ title: es.nav.dashboard, description: es.dashboard.subtitle, path: "/dashboard" });

export default function DashboardPage() {
  return <NexDashboard />;
}
