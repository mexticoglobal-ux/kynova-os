import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES, THEME_COLOR, type Theme } from "@/lib/theme";

// Design System V3 (NOVA): what makes the new identity, kept true by tests. The identity is a very dark blue canvas lit by electric blue and
// cyan, glass cards, premium type and one gradient for the main action. This file only reads the stylesheet and the config: no logic is involved.
const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const css = read("app/globals.css");
const tailwind = read("tailwind.config.ts");
const layout = read("app/layout.tsx");

type Rgb = [number, number, number];
function tokensOf(theme: Theme): Record<string, Rgb> {
  const selector = theme === "nova-dark" ? ':root,\n[data-theme="nova-dark"]' : `[data-theme="${theme}"]`;
  const start = css.indexOf(`${selector} {`);
  expect(start, `block for ${theme}`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("\n}", start));
  const tokens: Record<string, Rgb> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(\d+) (\d+) (\d+);/g)) tokens[match[1] as string] = [Number(match[2]), Number(match[3]), Number(match[4])];
  return tokens;
}
const channel = (value: number) => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
/** The CSS rule that starts with this selector, up to its closing brace. */
const rule = (selector: string): string => {
  const start = css.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("\n  }", start) >= 0 ? css.indexOf("\n  }", start) : css.indexOf("\n}", start));
};

describe("NOVA colors", () => {
  it("makes the dark canvas a very dark blue, and keeps the light canvas cool", () => {
    const dark = tokensOf("nova-dark");
    const [r, g, b] = dark["canvas"] as Rgb;
    expect(b).toBeGreaterThan(g);
    expect(b).toBeGreaterThan(r);
    expect(luminance(dark["canvas"] as Rgb)).toBeLessThan(0.01);
    const light = tokensOf("nova-light")["canvas"] as Rgb;
    expect(light[2]).toBeGreaterThan(light[0]);
    expect(luminance(light)).toBeGreaterThan(0.8);
  });

  it.each(THEMES)("%s: the primary is a blue and the accent a cyan, in the same family as the other theme", (theme) => {
    const t = tokensOf(theme);
    const [pr, pg, pb] = t["primary"] as Rgb;
    expect(pb, "primary is blue").toBeGreaterThan(pr);
    expect(pb, "primary is blue").toBeGreaterThan(pg);
    const [ar, ag, ab] = t["accent"] as Rgb;
    expect(ab, "accent is cyan").toBeGreaterThan(ar);
    expect(ag, "accent is cyan").toBeGreaterThan(ar);
    const [dr] = t["primary-deep"] as Rgb;
    expect(dr, "the end of the gradient is a cyan-blue").toBeLessThan(40);
  });

  it("has no gold left: the identity is blue and cyan, not petrol and gold", () => {
    expect(css).not.toMatch(/gold|dorado|petrol/i);
    for (const theme of THEMES) {
      const [r, g, b] = tokensOf(theme)["accent"] as Rgb;
      expect(r < g && r < b, `${theme} accent is not warm`).toBe(true);
    }
  });

  it.each(THEMES)("%s: white or dark text stays readable (AA) on both ends of the electric gradient and on the cyan", (theme) => {
    const t = tokensOf(theme);
    expect(contrast(t["on-primary"] as Rgb, t["primary"] as Rgb)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["on-primary"] as Rgb, t["primary-deep"] as Rgb)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["on-accent"] as Rgb, t["accent"] as Rgb)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["on-accent"] as Rgb, t["accent-soft"] as Rgb)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("%s: keeps muted text readable on the raised controls and the glass tint", (theme) => {
    const t = tokensOf(theme);
    for (const background of ["raised", "shade", "glass"]) expect(contrast(t["ink-muted"] as Rgb, t[background] as Rgb), `${theme}: ink-muted on ${background}`).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["accent-soft"] as Rgb, t["raised"] as Rgb)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(t["primary-soft"] as Rgb, t["raised"] as Rgb)).toBeGreaterThanOrEqual(4.5);
  });

  it("lights the page with two auras, stronger on the dark theme", () => {
    expect(css).toMatch(/--aurora-strength: 0\.3;/);
    expect(css).toMatch(/--aurora-strength: 0\.16;/);
    const body = rule("body::before");
    expect(body).toContain("position: fixed");
    expect(body).toContain("pointer-events: none");
    expect(body).toContain("var(--aurora-a)");
    expect(body).toContain("var(--aurora-b)");
  });

  it("paints the browser bar and the installed app with the canvas of each theme", () => {
    for (const theme of THEMES) expect(THEME_COLOR[theme]).toBe(hex(tokensOf(theme)["canvas"] as Rgb));
    expect(read("public/icon-maskable.svg")).toContain(`fill="${THEME_COLOR["nova-dark"]}"`);
  });
});

describe("NOVA pieces", () => {
  it("makes cards glass, and solid again where blur is unavailable or less transparency is asked for", () => {
    const card = rule(".card");
    expect(card).toContain("backdrop-filter: blur(");
    expect(card).toContain("var(--glass)");
    expect(css).toMatch(/@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/);
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)[\s\S]*background: rgb\(var\(--surface\)\)/);
  });

  it("uses one electric gradient for the main action and the selected tab, with a soft glow", () => {
    for (const selector of [".btn-primary", '.tab[aria-selected="true"]']) {
      const body = rule(selector);
      expect(body, selector).toMatch(/linear-gradient\(135deg, rgb\(var\(--primary\)\), rgb\(var\(--primary-deep\)\)\)/);
      expect(body, selector).toContain("var(--shadow-glow)");
    }
  });

  it("gives fields a cyan focus ring that does not depend on color alone", () => {
    const focus = rule(".field:focus-visible,\n  .field-sm:focus-visible");
    expect(focus).toContain("box-shadow: 0 0 0 3px rgb(var(--accent) / 0.25)");
    expect(focus).toContain("border-color: rgb(var(--accent))");
  });

  it("shows the current page in the navigation with a light bar, and every figure with a light line on top", () => {
    expect(rule('.nav-item[aria-current="page"]::before')).toContain("linear-gradient(180deg");
    expect(rule(".stat::before")).toContain("linear-gradient(90deg");
  });

  it("styles every table the same way: framed, a quiet header, separators, soft zebra and a hover", () => {
    expect(css).toContain(".table-wrap {");
    expect(css).toMatch(/main thead th \{[\s\S]*text-transform: uppercase/);
    expect(css).toMatch(/main tbody tr \{[\s\S]*border-top: 1px solid rgb\(var\(--line-soft\)\)/);
    expect(css).toContain("main tbody tr:nth-child(even)");
    expect(css).toContain("main tbody tr:hover");
  });

  it("keeps the focus ring, the skip link and reduced motion", () => {
    expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid rgb\(var\(--primary-soft\)\)/);
    expect(css).toContain(".skip-link");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important;\s*transition: none !important;/);
  });

  it("adds only two animations, both gentle: a fade and a slow breathing light", () => {
    expect(tailwind).toMatch(/"fade-in": \{/);
    expect(tailwind).toMatch(/breathe: \{/);
    expect(tailwind).toMatch(/breathe: "breathe 4s ease-in-out infinite"/);
  });
});

describe("premium type", () => {
  it("loads one display face next to the text face, latin only, and applies it to headings and figures", () => {
    expect(layout).toMatch(/import \{ Inter, Manrope \} from "next\/font\/google"/);
    expect(layout).toMatch(/Manrope\(\{ subsets: \["latin"\], display: "swap", variable: "--font-display" \}\)/);
    expect(layout).toContain("display.variable");
    expect(tailwind).toMatch(/display: \["var\(--font-display\)"/);
    expect(css).toMatch(/h1,\s*h2,\s*h3 \{\s*font-family: theme\("fontFamily.display"\)/);
    expect(rule(".stat-value")).toContain('font-family: theme("fontFamily.display")');
    expect(rule(".stat-value")).toContain("tabular-nums");
  });

  it("scales figures with the screen instead of jumping", () => {
    expect(rule(".stat-value")).toMatch(/font-size: clamp\(/);
  });
});
