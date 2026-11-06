import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";
import { ClientsScreen } from "./_components/ClientsScreen";

export const metadata = pageMetadata({
  title: es.modules.clients.title,
  description: es.modules.clients.subtitle,
  path: "/clients",
});

export default function ClientsPage() {
  return <ClientsScreen />;
}
