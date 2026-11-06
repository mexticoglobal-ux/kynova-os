import type { Metadata } from "next";
import { DesignSystemView } from "./DesignSystemView";

// Internal reference: not for search engines and not in the sitemap.
export const metadata: Metadata = {
  title: "Design System",
  description: "Colores, botones, tarjetas, badges, gráficos, iconos, sombras y espaciados de KYNOVA.",
  robots: { index: false, follow: false },
};

export default function DesignSystemPage() {
  return <DesignSystemView />;
}
