import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { APP_PATHS, safeNext } from "./paths";

describe("safeNext", () => {
  it("returns to an app page", () => {
    expect(safeNext("/sales")).toBe("/sales");
    expect(safeNext("/nex/chat?x=1")).toBe("/nex/chat?x=1");
  });

  it("never redirects off-site or to the onboarding loop", () => {
    for (const value of [null, undefined, "", "https://evil.test", "//evil.test", "/\\evil", "javascript:alert(1)", "/onboarding", "/login", "/api/v1/me"]) {
      expect(safeNext(value as string | null | undefined)).toBe("/dashboard");
    }
  });
});

describe("middleware matcher", () => {
  it("covers every app path, so no screen is left unguarded", () => {
    const source = readFileSync(path.join(process.cwd(), "middleware.ts"), "utf8");
    for (const prefix of APP_PATHS) {
      expect(source, `/${prefix}`).toContain(`"/${prefix}",`);
      expect(source, `/${prefix}/:path*`).toContain(`"/${prefix}/:path*",`);
    }
  });
});
