import { es } from "@/lib/i18n/messages/es";
import { pageMetadata } from "@/lib/seo/metadata";
import { PricingView } from "./_components/PricingView";

export const metadata = pageMetadata({ title: es.pricing.title, description: es.pricing.subtitle, path: "/pricing" });

export default function PricingPage() {
  return <PricingView />;
}
