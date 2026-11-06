// Themes share one set of design tokens (app/globals.css). Switching a theme only changes `data-theme` on <html>.
export const THEMES = ["premium", "dark", "light"] as const;
export type Theme = (typeof THEMES)[number];

// Premium (petrol blue + graphite + gold) is the product identity; Dark and Light are ready for when they are offered.
export const DEFAULT_THEME: Theme = "premium";

export const THEME_LABEL: Record<Theme, string> = { premium: "Premium", dark: "Oscuro", light: "Claro" };
