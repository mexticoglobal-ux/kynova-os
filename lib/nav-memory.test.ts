import { describe, expect, it } from "vitest";
import {
  EMPTY_NAV_MEMORY, MAX_FAVORITES, MAX_RECENTS, isInternalPath, normalize, parseNavMemory, pushRecent, searchEntries, serializeNavMemory, setCollapsed, toggleFavorite, type SearchEntry,
} from "./nav-memory";

describe("navigation memory", () => {
  it("accepts only paths of this site", () => {
    expect(isInternalPath("/platform/crm")).toBe(true);
    for (const bad of ["https://evil.example", "//evil.example", "platform", "/a\\b", 7, null, undefined, `/${"x".repeat(250)}`]) expect(isInternalPath(bad)).toBe(false);
  });

  it("reads what was stored and treats anything damaged as empty", () => {
    const stored = serializeNavMemory({ favorites: ["/nex"], recents: ["/sales", "/nex"], collapsed: true });
    expect(parseNavMemory(stored)).toEqual({ favorites: ["/nex"], recents: ["/sales", "/nex"], collapsed: true });
    for (const raw of [null, "", "not json", "42", "null", '"text"', "[]"]) expect(parseNavMemory(raw)).toEqual(EMPTY_NAV_MEMORY);
    expect(parseNavMemory(JSON.stringify({ favorites: ["/ok", "https://evil.example", 3, "/ok"], recents: "no", collapsed: "yes" }))).toEqual({ favorites: ["/ok"], recents: [], collapsed: false });
  });

  it("pins and unpins a favorite, with a limit", () => {
    let memory = toggleFavorite(EMPTY_NAV_MEMORY, "/nex");
    expect(memory.favorites).toEqual(["/nex"]);
    memory = toggleFavorite(memory, "/nex");
    expect(memory.favorites).toEqual([]);
    expect(toggleFavorite(memory, "https://evil.example")).toBe(memory);
    for (let index = 0; index < MAX_FAVORITES + 3; index += 1) memory = toggleFavorite(memory, `/p${index}`);
    expect(memory.favorites).toHaveLength(MAX_FAVORITES);
    expect(memory.favorites.at(-1)).toBe(`/p${MAX_FAVORITES + 2}`); // the newest stays
  });

  it("remembers the screens opened last, newest first, without repeats", () => {
    let memory = pushRecent(EMPTY_NAV_MEMORY, "/a");
    memory = pushRecent(memory, "/b");
    memory = pushRecent(memory, "/a");
    expect(memory.recents).toEqual(["/a", "/b"]);
    expect(pushRecent(memory, "/a")).toBe(memory); // already first: nothing changes
    for (let index = 0; index < MAX_RECENTS + 3; index += 1) memory = pushRecent(memory, `/r${index}`);
    expect(memory.recents).toHaveLength(MAX_RECENTS);
    expect(memory.recents[0]).toBe(`/r${MAX_RECENTS + 2}`);
    expect(pushRecent(memory, "//evil.example")).toBe(memory);
  });

  it("collapses the sidebar only when it changes", () => {
    const collapsed = setCollapsed(EMPTY_NAV_MEMORY, true);
    expect(collapsed.collapsed).toBe(true);
    expect(setCollapsed(collapsed, true)).toBe(collapsed);
  });
});

describe("quick search", () => {
  const entries: SearchEntry[] = [
    { href: "/platform/billing", label: "Facturación y suscripciones", hint: "Plan, límites y facturas", group: "Plataforma" },
    { href: "/platform/payments", label: "Pagos", hint: "Enlaces de cobro y facturas", group: "Plataforma" },
    { href: "/platform/crm", label: "CRM inteligente", hint: "Pipeline y clientes", group: "Plataforma" },
    { href: "/sales", label: "Ventas", group: "Navegación" },
  ];

  it("finds a screen without caring about accents or capitals", () => {
    expect(normalize("  Facturación ")).toBe("facturacion");
    expect(searchEntries(entries, "FACTURACION")[0]?.href).toBe("/platform/billing");
    expect(searchEntries(entries, "crm").map((item) => item.href)).toEqual(["/platform/crm"]);
  });

  it("ranks a name that starts with the text before one that only mentions it", () => {
    expect(searchEntries(entries, "factura").map((item) => item.href)).toEqual(["/platform/billing", "/platform/payments"]);
    expect(searchEntries(entries, "pipeline clientes").map((item) => item.href)).toEqual(["/platform/crm"]); // every word must match
  });

  it("shows the first entries when nothing is typed, and nothing when nothing matches", () => {
    expect(searchEntries(entries, "", 2)).toHaveLength(2);
    expect(searchEntries(entries, "zzz")).toEqual([]);
  });
});
