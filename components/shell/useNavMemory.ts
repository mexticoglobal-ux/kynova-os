"use client";

import { useCallback, useEffect, useState } from "react";
import { EMPTY_NAV_MEMORY, NAV_MEMORY_KEY, parseNavMemory, pushRecent, serializeNavMemory, setCollapsed, toggleFavorite, type NavMemory } from "@/lib/nav-memory";

// Keeps the navigation memory (favorites, recents, collapsed sidebar) on this device. Storage can be blocked or empty: it then simply starts empty.
export function useNavMemory() {
  const [memory, setMemory] = useState<NavMemory>(EMPTY_NAV_MEMORY);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setMemory(parseNavMemory(window.localStorage.getItem(NAV_MEMORY_KEY)));
    } catch {
      // storage blocked: start empty
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      window.localStorage.setItem(NAV_MEMORY_KEY, serializeNavMemory(memory));
    } catch {
      // storage blocked or full: the memory still works for this visit
    }
  }, [memory, ready]);

  const toggle = useCallback((href: string) => setMemory((current) => toggleFavorite(current, href)), []);
  const visit = useCallback((href: string) => setMemory((current) => pushRecent(current, href)), []);
  const collapse = useCallback((collapsed: boolean) => setMemory((current) => setCollapsed(current, collapsed)), []);
  return { memory, toggle, visit, collapse };
}
