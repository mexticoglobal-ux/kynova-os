import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { site } from "@/config/site";
import { es } from "@/lib/i18n/messages/es";
import { Providers } from "@/components/providers/Providers";

const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.product} — ${es.landing.title}`, template: `%s | ${site.name}` },
  description: es.landing.subtitle,
  applicationName: site.product,
  alternates: { canonical: "/" },
  openGraph: {
    title: `${site.product} — ${es.landing.title}`,
    description: es.landing.subtitle,
    url: "/",
    siteName: site.product,
    locale: "es_ES",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: `${site.product} — ${es.landing.title}`, description: es.landing.subtitle },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: site.themeColor,
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-ES" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
