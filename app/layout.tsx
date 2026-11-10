import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, Manrope } from "next/font/google";
import { site } from "@/config/site";
import { es } from "@/lib/i18n/messages/es";
import { Providers } from "@/components/providers/Providers";
import { PwaRuntime } from "@/components/pwa/PwaRuntime";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";

const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-inter" });
// The display face of headings and figures: one variable font, latin only, so the premium type costs a single small file.
const display = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-display" });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.product} — ${es.landing.title}`, template: `%s | ${site.name}` },
  description: es.landing.subtitle,
  applicationName: site.product,
  alternates: { canonical: "/" },
  appleWebApp: { capable: true, title: site.name, statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
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
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme chosen on this device is applied before the first paint (see lib/theme.ts), so the attribute can differ from the server's.
    <html lang="es-ES" data-theme={DEFAULT_THEME} className={`${inter.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          {children}
          <PwaRuntime />
        </Providers>
      </body>
    </html>
  );
}
