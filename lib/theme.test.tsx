import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_THEME, THEMES, THEME_COLOR, THEME_INIT_SCRIPT, THEME_LABEL, THEME_STORAGE_KEY, applyTheme, isTheme, readStoredTheme } from "./theme";

beforeEach(() => {
  document.head.innerHTML = '<meta name="theme-color" content="#000000">';
  document.documentElement.setAttribute("data-theme", DEFAULT_THEME);
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("themes", () => {
  it("has exactly NOVA Dark and NOVA Light, each with a name and a browser-bar color", () => {
    expect([...THEMES]).toEqual(["nova-dark", "nova-light"]);
    expect(THEME_LABEL).toEqual({ "nova-dark": "NOVA Dark", "nova-light": "NOVA Light" });
    expect(THEME_COLOR["nova-dark"]).toBe("#060B18");
    expect(isTheme("nova-light")).toBe(true);
    expect(isTheme("premium")).toBe(false);
  });

  it("applies a theme to the document and the browser bar, and remembers it", () => {
    applyTheme("nova-light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("nova-light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content")).toBe(THEME_COLOR["nova-light"]);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("nova-light");
    expect(readStoredTheme()).toBe("nova-light");
  });

  it("can apply a theme without remembering it, and ignores a stored value it does not know", () => {
    applyTheme("nova-light", false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    window.localStorage.setItem(THEME_STORAGE_KEY, "premium");
    expect(readStoredTheme()).toBeNull();
  });

  it("still applies the theme when the storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(() => applyTheme("nova-light")).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("nova-light");
    expect(readStoredTheme()).toBeNull();
  });

  it("sets the remembered theme before the first paint through the inline script, and ignores anything else", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "nova-light");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("nova-light");
    window.localStorage.setItem(THEME_STORAGE_KEY, "<script>");
    document.documentElement.setAttribute("data-theme", "nova-dark");
    new Function(THEME_INIT_SCRIPT)();
    expect(document.documentElement.getAttribute("data-theme")).toBe("nova-dark");
  });
});
