import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";
import { NexChat } from "./_components/NexChat";

export const metadata = pageMetadata({ title: es.nav.nex, description: es.nex.subtitle, path: "/nex" });

export default function NexPage() {
  return <NexChat />;
}
