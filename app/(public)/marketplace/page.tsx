import { ComingSoon } from "@/components/public/ComingSoon";
import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: es.comingSoon.pages.marketplace.title,
  description: es.comingSoon.pages.marketplace.body,
  path: "/marketplace",
});

export default function MarketplacePage() {
  return <ComingSoon page="marketplace" />;
}
