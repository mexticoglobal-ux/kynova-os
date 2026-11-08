import { describe, expect, it } from "vitest";
import { PLATFORM_SECTIONS } from "@/app/(app)/platform/_components/catalog";
import { BRANDS, BRAND_KEYS, BRAND_TONES, SECTION_BRAND, brandOfSection } from "./brand";

describe("brand identity", () => {
  it("covers KYNOVA, NEX, KOE and every product", () => {
    expect(BRAND_KEYS.map((key) => BRANDS[key].name).sort()).toEqual(
      ["AI Studio", "Academy", "Billing", "CRM", "Communications", "Developer Platform", "Insights", "KOE", "KYNOVA", "Marketplace", "NEX", "Organization", "Workers"].sort(),
    );
  });

  it("gives each brand a distinct name, a line that says what it is, an icon and a design-system tone", () => {
    expect(new Set(BRAND_KEYS.map((key) => BRANDS[key].name)).size).toBe(BRAND_KEYS.length);
    for (const key of BRAND_KEYS) {
      const brand = BRANDS[key];
      expect(brand.tagline.length, key).toBeGreaterThan(10);
      expect(brand.icon, key).toBeTruthy();
      expect(Object.keys(BRAND_TONES), key).toContain(brand.tone);
    }
  });

  it("uses only design-system classes for the tones, so a brand looks right in both themes", () => {
    for (const tone of Object.values(BRAND_TONES)) {
      expect(tone.icon).toMatch(/^text-(primary-soft|accent|success|warning)$/);
      expect(tone.chip).toMatch(/^bg-(primary|accent|success|warning)\/15$/);
    }
  });

  it("dresses each platform screen in its brand, and the rest in KYNOVA", () => {
    const known = new Set(PLATFORM_SECTIONS.map((item) => item.key as string));
    for (const [section, brand] of Object.entries(SECTION_BRAND)) {
      expect(known.has(section), section).toBe(true);
      expect(BRAND_KEYS).toContain(brand);
    }
    expect(brandOfSection("billing").name).toBe("Billing");
    expect(brandOfSection("developers").name).toBe("Developer Platform");
    expect(brandOfSection("comms").name).toBe("Communications");
    expect(brandOfSection("org").name).toBe("Organization");
    expect(brandOfSection("studio").name).toBe("AI Studio");
    expect(brandOfSection("payments").name).toBe("KYNOVA");
  });
});
