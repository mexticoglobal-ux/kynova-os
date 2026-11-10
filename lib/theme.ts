// KYNOVA has two themes, NOVA Dark and NOVA Light. They share one set of design tokens (app/globals.css): switching a theme only
// changes `data-theme` on <html>, never a component.
export const THEMES = ["nova-dark", "nova-light"] as const;
export type Theme = (typeof THEMES)[number];

// NOVA Dark (a very dark blue lit by electric blue and cyan) is the product identity.
export const DEFAULT_THEME: Theme = "nova-dark";

export const THEME_LABEL: Record<Theme, string> = { "nova-dark": "NOVA Dark", "nova-light": "NOVA Light" };
/** The color of the browser bar and of the installed app's frame for each theme (the canvas token of each theme). */
export const THEME_COLOR: Record<Theme, string> = { "nova-dark": "#060B18", "nova-light": "#EDF2FC" };

export const THEME_STORAGE_KEY = "kynova_theme";
export const isTheme = (value: unknown): value is Theme => typeof value === "string" && (THEMES as readonly string[]).includes(value);

// Runs before the first paint (inline in <head>), so a returning visitor never sees the wrong theme flash. Storage can be blocked: it fails closed.
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});if(t===${JSON.stringify(THEMES[0])}||t===${JSON.stringify(THEMES[1])})document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : null;
  } catch {
    return null;
  }
}

/** Applies a theme to the document (and the browser bar color) and remembers it; storage that is blocked is ignored. */
export function applyTheme(theme: Theme, remember = true): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  if (!remember) return;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // private window or blocked storage: the theme still applies to this visit
  }
}
