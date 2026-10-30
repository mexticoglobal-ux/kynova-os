import { ComingSoon } from "@/components/public/ComingSoon";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.comingSoon.pages.docs.title,
  description: es.comingSoon.pages.docs.body,
  path: "/docs",
});

export default function DocsPage() {
  return <ComingSoon page="docs" />;
}
