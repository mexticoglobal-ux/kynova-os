import type { MetadataRoute } from "next";
import { appNav, publicNav, site } from "@/config/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const publicRoutes = ["/", ...publicNav.map((item) => item.href), "/contact"];
  const appRoutes = appNav.map((item) => item.href);

  return [
    ...publicRoutes.map((path) => ({ url: `${site.url}${path === "/" ? "" : path}`, changeFrequency: "weekly" as const, priority: path === "/" ? 1 : 0.8 })),
    ...appRoutes.map((path) => ({ url: `${site.url}${path}`, changeFrequency: "monthly" as const, priority: 0.5 })),
  ];
}
