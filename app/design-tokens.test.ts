import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES, DEFAULT_THEME, type Theme } from "@/lib/theme";

// The design tokens are the contract between the themes and every component: same names everywhere, readable everywhere.
const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

function tokensOf(theme: Theme): Record<string, [number, number, number]> {
  const selector = theme === "premium" ? ':root,\n[data-theme="premium"]' : `[data-theme="${theme}"]`;
  const start = css.indexOf(`${selector} {`);
  expect(start, `block for ${theme}`).toBeGreaterThanOrEqual(0);
  const block = css.slice(start, css.indexOf("}", start));
  const tokens: Record<string, [number, number, number]> = {};
  for (const match of block.matchAll(/--([a-z-]+):\s*(\d+) (\d+) (\d+);/g)) {
    tokens[match[1]] = [Number(match[2]), Number(match[3]), Number(match[4])];
  }
  return tokens;
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const contrast = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("design tokens", () => {
  it("declares three themes and defaults to premium", () => {
    expect([...THEMES]).toEqual(["premium", "dark", "light"]);
    expect(DEFAULT_THEME).toBe("premium");
  });

  it.each(THEMES)("%s defines exactly the same tokens as premium", (theme) => {
    expect(Object.keys(tokensOf(theme)).sort()).toEqual(Object.keys(tokensOf("premium")).sort());
  });

  it.each(THEMES)("%s never uses pure black or pure white for the page or cards", (theme) => {
    const tokens = tokensOf(theme);
    for (const name of ["canvas", "surface", "shade"]) {
      const sum = tokens[name].reduce((total, value) => total + value, 0);
      expect(sum, `${theme} ${name}`).toBeGreaterThan(0);
      expect(tokens[name].every((value) => value === 255), `${theme} ${name} is white`).toBe(false);
      expect(tokens[name].every((value) => value < 8), `${theme} ${name} is almost black`).toBe(false);
    }
  });

  // WCAG AA for normal text is 4.5:1.
  it.each(THEMES)("%s keeps text readable (AA) on the page and on cards", (theme) => {
    const t = tokensOf(theme);
    const pairs: [string, string][] = [
      ["ink", "canvas"], ["ink", "surface"], ["ink-soft", "canvas"], ["ink-soft", "surface"],
      ["ink-muted", "canvas"], ["ink-muted", "surface"], ["ink-muted", "raised"],
      ["primary-soft", "canvas"], ["primary-soft", "surface"], ["accent-soft", "surface"],
      ["success", "surface"], ["warning", "surface"], ["danger-soft", "surface"],
      ["on-primary", "primary"], ["on-accent", "accent"],
    ];
    for (const [foreground, background] of pairs) {
      expect(contrast(t[foreground], t[background]), `${theme}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
