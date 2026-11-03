import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { es } from "@/lib/i18n/messages/es";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.product,
    short_name: site.name,
    description: es.landing.subtitle,
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: site.themeColor,
    theme_color: site.themeColor,
    lang: "es",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
  };
}
