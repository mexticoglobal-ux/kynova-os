import { describe, expect, it } from "vitest";
import { MODULE_KEYS, appNav } from "@/config/site";
import { LOCALES } from "@/lib/i18n/config";
import { loadMessages } from "@/lib/i18n/messages";
import { moduleRegistry } from "./registry";

describe("module registry (ADR-0005)", () => {
  it("every navigation module has data", () => {
    for (const key of MODULE_KEYS) expect(moduleRegistry[key]).toBeDefined();
  });

  it("navigation hrefs are unique and point to known routes", () => {
    const hrefs = appNav.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(hrefs).toEqual(["/dashboard", "/nex", ...MODULE_KEYS.map((key) => `/${key}`)]);
  });

  it.each(LOCALES)("%s: module copy matches module data", async (locale) => {
    const { modules } = await loadMessages(locale);
    for (const key of MODULE_KEYS) {
      const copy = modules[key];
      const data = moduleRegistry[key];
      expect(copy.kpis).toHaveLength(data.kpis.length);
      expect(copy.cards).toHaveLength(data.insightIcons.length);
      expect(copy.rows).toHaveLength(data.rows.length);
      expect(copy.columns).toHaveLength(4);
      expect(copy.actions).toHaveLength(3);
    }
  });
});
