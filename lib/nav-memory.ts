// What the navigation remembers for each visitor: the favorites they pinned, the screens they opened last and whether the sidebar is collapsed.
// Pure functions, so they are easy to test; the browser storage lives in components/shell/useNavMemory.ts. Only same-site paths are ever stored.
export const NAV_MEMORY_KEY = "kynova_nav";
export const MAX_FAVORITES = 8;
export const MAX_RECENTS = 5;

export type NavMemory = { favorites: string[]; recents: string[]; collapsed: boolean };
export const EMPTY_NAV_MEMORY: NavMemory = { favorites: [], recents: [], collapsed: false };

/** A same-site path: starts with one slash, no protocol-relative address, no backslash. */
export const isInternalPath = (value: unknown): value is string => typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && value.length <= 200;

const clean = (value: unknown, limit: number): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const item of value) if (isInternalPath(item)) seen.add(item);
  return [...seen].slice(0, limit);
};

/** Reads what was stored, treating anything damaged or unexpected as empty. */
export function parseNavMemory(raw: string | null): NavMemory {
  if (!raw) return EMPTY_NAV_MEMORY;
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return EMPTY_NAV_MEMORY;
    const record = data as Record<string, unknown>;
    return { favorites: clean(record["favorites"], MAX_FAVORITES), recents: clean(record["recents"], MAX_RECENTS), collapsed: record["collapsed"] === true };
  } catch {
    return EMPTY_NAV_MEMORY;
  }
}

export const serializeNavMemory = (memory: NavMemory): string => JSON.stringify(memory);

export function toggleFavorite(memory: NavMemory, href: string): NavMemory {
  if (!isInternalPath(href)) return memory;
  const favorites = memory.favorites.includes(href) ? memory.favorites.filter((item) => item !== href) : [...memory.favorites, href].slice(-MAX_FAVORITES);
  return { ...memory, favorites };
}

/** The screen just opened goes to the front; a repeat moves up instead of appearing twice. */
export function pushRecent(memory: NavMemory, href: string): NavMemory {
  if (!isInternalPath(href) || memory.recents[0] === href) return memory;
  return { ...memory, recents: [href, ...memory.recents.filter((item) => item !== href)].slice(0, MAX_RECENTS) };
}

export const setCollapsed = (memory: NavMemory, collapsed: boolean): NavMemory => (memory.collapsed === collapsed ? memory : { ...memory, collapsed });

export type SearchEntry = { href: string; label: string; hint?: string; group: string };

/** Lowercase without accents, so "facturacion" finds "Facturación". */
export const normalize = (text: string): string => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** The entries that match every word typed, best first: a name that starts with the text, then a name that contains it, then the description. */
export function searchEntries(entries: readonly SearchEntry[], query: string, limit = 8): SearchEntry[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries.slice(0, limit);
  const scored: { entry: SearchEntry; score: number }[] = [];
  for (const entry of entries) {
    const label = normalize(entry.label);
    const hint = normalize(entry.hint ?? "");
    if (!words.every((word) => label.includes(word) || hint.includes(word))) continue;
    const score = words.every((word) => label.startsWith(word)) ? 0 : words.every((word) => label.includes(word)) ? 1 : 2;
    scored.push({ entry, score });
  }
  return scored.sort((a, b) => a.score - b.score || a.entry.label.localeCompare(b.entry.label)).map((item) => item.entry).slice(0, limit);
}
