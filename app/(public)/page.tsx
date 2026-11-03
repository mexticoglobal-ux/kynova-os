import dynamic from "next/dynamic";
import { site } from "@/config/site";
import { es } from "@/lib/i18n/messages/es";
import { LandingHero } from "./_components/LandingHero";

// Below-the-fold sections ship in their own chunk (code splitting); they are still server-rendered.
const LandingSections = dynamic(() => import("./_components/LandingSections").then((mod) => mod.LandingSections));

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: site.name,
      url: site.url,
      logo: `${site.url}/icon.svg`,
    },
    {
      "@type": "SoftwareApplication",
      name: site.product,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description: es.landing.subtitle,
      url: site.url,
      offers: [
        { "@type": "Offer", name: es.pricing.plans.starter.name, price: "49", priceCurrency: "USD" },
        { "@type": "Offer", name: es.pricing.plans.professional.name, price: "149", priceCurrency: "USD" },
        { "@type": "Offer", name: es.pricing.plans.business.name, price: "399", priceCurrency: "USD" },
      ],
    },
  ],
};

export default function LandingPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <LandingHero />
      <LandingSections />
    </>
  );
}
