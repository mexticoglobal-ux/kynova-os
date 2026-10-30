import type { Locale } from "../config";
import { es, type Messages } from "./es";

export type { Messages };

// Spanish ships with the page; every other locale is code-split and loaded on demand.
const loaders: Record<Exclude<Locale, "es">, () => Promise<Messages>> = {
  en: () => import("./en").then((mod) => mod.en),
  fr: () => import("./fr").then((mod) => mod.fr),
  de: () => import("./de").then((mod) => mod.de),
  it: () => import("./it").then((mod) => mod.it),
  pt: () => import("./pt").then((mod) => mod.pt),
  ja: () => import("./ja").then((mod) => mod.ja),
  zh: () => import("./zh").then((mod) => mod.zh),
};

export const defaultMessages: Messages = es;

export function loadMessages(locale: Locale): Promise<Messages> {
  return locale === "es" ? Promise.resolve(es) : loaders[locale]();
}
