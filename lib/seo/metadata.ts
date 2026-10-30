import type { Metadata } from "next";
import { site } from "@/config/site";

// Server-side metadata is rendered in the default locale, Spanish (ADR-0004).
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { title: `${title} | ${site.name}`, description, url: path, siteName: site.product, locale: "es_ES", type: "website" },
    twitter: { card: "summary_large_image", title: `${title} | ${site.name}`, description },
  };
}
