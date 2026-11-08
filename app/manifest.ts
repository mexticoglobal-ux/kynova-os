import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { es } from "@/lib/i18n/messages/es";

// The installable app (PWA). The colors are the NOVA Dark canvas: the splash screen the system draws while the app opens uses
// the background color and the icon, so it already looks like KYNOVA before a single line of the app runs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: site.product,
    short_name: site.name,
    description: es.landing.subtitle,
    start_url: "/dashboard?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "any",
    background_color: site.themeColor,
    theme_color: site.themeColor,
    lang: "es",
    dir: "ltr",
    categories: ["business", "productivity"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    shortcuts: [
      { name: "Panel", url: "/dashboard?source=shortcut", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "NEX", url: "/nex?source=shortcut", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
      { name: "Plataforma", url: "/platform?source=shortcut", icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }] },
    ],
  };
}
