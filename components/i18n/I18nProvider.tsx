"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, LOCALE_STORAGE_KEY, LOCALE_TAGS, isLocale, type Locale } from "@/lib/i18n/config";
import { defaultMessages, loadMessages, type Messages } from "@/lib/i18n/messages";

type I18nContextValue = {
  locale: Locale;
  tag: string;
  m: Messages;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function readStoredLocale(): Locale | null {
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [messages, setMessages] = useState<Messages>(defaultMessages);

  const applyLocale = useCallback((next: Locale) => {
    void loadMessages(next).then((loaded) => {
      setMessages(loaded);
      setLocaleState(next);
      document.documentElement.lang = LOCALE_TAGS[next];
    });
  }, []);

  useEffect(() => {
    const stored = readStoredLocale();
    if (stored && stored !== DEFAULT_LOCALE) applyLocale(stored);
  }, [applyLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      } catch {
        // Storage can be unavailable (private mode); the change still applies for this visit.
      }
      applyLocale(next);
    },
    [applyLocale],
  );

  const value = useMemo(
    () => ({ locale, tag: LOCALE_TAGS[locale], m: messages, setLocale }),
    [locale, messages, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}
