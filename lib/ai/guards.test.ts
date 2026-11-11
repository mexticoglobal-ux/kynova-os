import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (["node_modules", ".next", ".open-next", ".git", ".wrangler"].includes(name)) continue;
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path.split("\\").join("/"));
  }
  return out;
};
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const source = (files: string[]) => files.filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));

describe("lib/ai is the only place that talks to an AI provider", () => {
  const all = source([...walk("lib"), ...walk("app"), ...walk("components")]);
  it("sends the request in lib/ai/http.ts and nowhere else in lib/ai", () => {
    const users = source(walk("lib/ai")).filter((file) => /\bfetch(Impl)?\(/.test(read(file)));
    expect(users).toEqual(["lib/ai/http.ts"]);
  });
  it("names a provider host only inside lib/ai and the Gateway's catalog", () => {
    const hosts = /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|openrouter\.ai|api\.x\.ai|api\.deepseek\.com|api\.mistral\.ai/;
    const offenders = all.filter((file) => !file.startsWith("lib/ai/") && hosts.test(read(file)));
    expect(offenders).toEqual([]);
  });
  it("is imported by no module, page or component", () => {
    const importers = all.filter((file) => !file.startsWith("lib/ai/") && /from\s+["']@\/lib\/ai(\/|["'])/.test(read(file)));
    expect(importers).toEqual([]);
  });
  it("reads no environment variable directly: secrets come through the Secrets Manager", () => {
    expect(source(walk("lib/ai")).filter((file) => /process\.env/.test(read(file)))).toEqual([]);
  });
  it("uses no provider SDK", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.filter((name) => /^(openai|@anthropic-ai\/|@google\/generative-ai|@google\/genai|@mistralai\/|ollama)/.test(name))).toEqual([]);
  });
  it("keeps every file of lib/ai relative to the repository, with no secret literal", () => {
    for (const file of walk("lib/ai")) expect(relative(ROOT, join(ROOT, file)).startsWith("..")).toBe(false);
    expect(source(walk("lib/ai")).filter((file) => /sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}/.test(read(file)))).toEqual([]);
  });
});
