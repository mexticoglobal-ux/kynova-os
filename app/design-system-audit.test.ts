import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// The audit of the Design System V2: one visual system, so nothing is declared twice. These checks fail the moment a copy of a
// component, a repeated class, a loose color or a repeated variable appears again.
const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === ".open-next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const rel = (file: string) => relative(ROOT, file).split("\\").join("/");
const source = ["app", "components", "lib", "config"].flatMap((dir) => walk(join(ROOT, dir))).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !rel(file).startsWith("app/spike/")); // the spike is a throwaway page, not the product
const text = (file: string) => readFileSync(file, "utf8");
const css = readFileSync(join(ROOT, "app/globals.css"), "utf8").replace(/\r\n/g, "\n");
const tailwind = readFileSync(join(ROOT, "tailwind.config.ts"), "utf8");

describe("design system audit", () => {
  it("has no component that defines its own field, select or area classes", () => {
    const copies = source.filter((file) => /const (input|select|field|area|textarea)Class\s*=\s*["`]/.test(text(file))).map(rel);
    expect(copies).toEqual([]);
  });

  it("builds every tab bar with the shared Tabs, and nothing else declares a tablist", () => {
    const owners = source.filter((file) => /role=["']tablist["']/.test(text(file))).map(rel);
    expect(owners).toEqual(["components/ui/Tabs.tsx"]);
  });

  it("has one component for each job: the figure card and the table are not defined twice", () => {
    const defined = (pattern: RegExp) => source.filter((file) => pattern.test(text(file))).map(rel);
    expect(defined(/export (function|const) Kpi\b/)).toEqual(["app/(app)/platform/_components/InsightsCharts.tsx"]); // an alias of Stat
    expect(text(join(ROOT, "app/(app)/platform/_components/InsightsCharts.tsx"))).toContain("export const Kpi = Stat;");
    expect(defined(/export function Stat\b/)).toEqual(["components/ui/Stat.tsx"]);
    expect(defined(/export function Table\b/)).toEqual(["components/ui/Table.tsx"]);
    expect(defined(/export function Dialog\b/)).toEqual(["components/ui/Dialog.tsx"]);
    const names = source.filter((file) => rel(file).startsWith("components/ui/") && file.endsWith(".tsx")).flatMap((file) => [...text(file).matchAll(/export function (\w+)/g)].map((match) => match[1]));
    expect(new Set(names).size).toBe(names.length); // no two shared components with the same name
  });

  it("wraps every table that has a minimum width in the shared Table, so it scrolls inside its own box", () => {
    const loose = source.filter((file) => /<table[^>]*min-w-\[/.test(text(file))).map(rel);
    expect(loose).toEqual([]);
  });

  it("declares no color outside the theme tokens", () => {
    const hex = source.filter((file) => /(?<![&\w])#[0-9a-fA-F]{6}\b/.test(text(file))).map(rel);
    expect(hex).toEqual(["lib/theme.ts"]); // the two browser-bar colors, the only literal colors in code
    const functional = source.filter((file) => /\b(?:rgba?|hsla?)\((?!var\()/.test(text(file))).map(rel);
    expect(functional).toEqual([]);
    const palette = source.filter((file) => /\b(?:bg|text|border|ring|from|via|to|fill|stroke|divide|outline|shadow)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?\b/.test(text(file))).map(rel);
    expect(palette).toEqual([]); // only the design-system colors (bg-surface, text-ink-muted, bg-primary/15...)
  });

  it("derives the theme color of the site from the theme instead of repeating it", () => {
    expect(text(join(ROOT, "config/site.ts"))).toContain("THEME_COLOR[DEFAULT_THEME]");
  });

  it("declares each color token once per theme, and uses every one of them", () => {
    const blocks = [...css.matchAll(/(:root,\n\[data-theme="nova-dark"\]|\[data-theme="nova-light"\]) \{([\s\S]*?)\n\}/g)];
    expect(blocks).toHaveLength(2);
    const declared = blocks.map((block) => [...(block[2] ?? "").matchAll(/^\s*--([a-z-]+):/gm)].map((match) => match[1] as string));
    for (const names of declared) expect(new Set(names).size, "a token is declared twice in one theme").toBe(names.length);
    const used = (name: string) => css.replace(/^\s*--[a-z-]+:.*$/gm, "").includes(`var(--${name})`) || css.includes(`rgb(var(--${name})`) || tailwind.includes(`token("${name}")`) || source.some((file) => text(file).includes(`var(--${name})`));
    const unused = (declared[0] ?? []).filter((name) => !used(name));
    expect(unused).toEqual([]);
  });

  it("keeps only the two NOVA themes in the stylesheet", () => {
    expect([...css.matchAll(/\[data-theme="([a-z-]+)"\]/g)].map((match) => match[1])).toEqual(["nova-dark", "nova-light"]);
  });

  it("does not repeat the same animation or keyframe", () => {
    const keyframes = [...tailwind.matchAll(/^\s{8}(?:"([\w-]+)"|(\w+)): \{/gm)].map((match) => match[1] ?? match[2]);
    expect(new Set(keyframes).size).toBe(keyframes.length);
    for (const name of ["page-in", "pop-in", "shimmer", "fade-up"]) expect(keyframes).toContain(name);
  });

  it("respects reduced motion everywhere", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toMatch(/animation: none !important;\s*transition: none !important;/);
  });

  it("gives every interactive control a visible focus ring from one rule", () => {
    expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid rgb\(var\(--primary-soft\)\)/);
    const bare = source.filter((file) => /\boutline-none\b/.test(text(file)) && !/focus(-visible|-within)?:(ring|border|outline|shadow)/.test(text(file))).map(rel);
    // the only places that hide the outline are focus targets that are not controls: the main landmark and the dialog panel (a box that frames its own focus, like the search field, uses focus-within)
    expect(bare.sort()).toEqual(["components/shell/AppShell.tsx", "components/ui/Dialog.tsx"]);
  });
});
