import { ComingSoon } from "@/components/public/ComingSoon";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.comingSoon.pages.contact.title,
  description: es.comingSoon.pages.contact.body,
  path: "/contact",
});

export default function ContactPage() {
  return <ComingSoon page="contact" />;
}
