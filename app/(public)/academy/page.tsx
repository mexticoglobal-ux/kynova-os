import { ComingSoon } from "@/components/public/ComingSoon";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.comingSoon.pages.academy.title,
  description: es.comingSoon.pages.academy.body,
  path: "/academy",
});

export default function AcademyPage() {
  return <ComingSoon page="academy" />;
}
