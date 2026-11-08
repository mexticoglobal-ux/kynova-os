"use client";

import clsx from "clsx";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { Dialog } from "@/components/ui/Dialog";
import { searchEntries, type SearchEntry } from "@/lib/nav-memory";
import { shellText } from "@/lib/i18n/shell-messages";

// The quick search (Ctrl or Cmd + K): type a few letters of a screen and open it. It is loaded only when someone opens it.
export default function QuickSearch({ open, onClose, entries }: { open: boolean; onClose: () => void; entries: readonly SearchEntry[] }) {
  const { locale } = useI18n();
  const t = shellText(locale);
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchEntries(entries, query), [entries, query]);

  function go(entry: SearchEntry | undefined) {
    if (!entry) return;
    onClose();
    setQuery("");
    router.push(entry.href);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => (results.length === 0 ? 0 : (value + 1) % results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => (results.length === 0 ? 0 : (value - 1 + results.length) % results.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      go(results[active]);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} label={t.searchTitle} className="overflow-hidden p-0">
      <div className="flex items-center gap-3 border-b border-line-soft px-4 py-3 focus-within:border-primary-soft/60">
        <Search aria-hidden className="h-5 w-5 shrink-0 text-ink-muted" />
        <input
          data-autofocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
          aria-label={t.searchPlaceholder}
          autoComplete="off"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t.searchPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
        />
      </div>
      <ul id={listId} role="listbox" aria-label={t.searchTitle} className="max-h-[50vh] overflow-y-auto p-2">
        {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-muted">{t.searchEmpty}</li>}
        {results.map((entry, index) => (
          <li key={entry.href} id={`${listId}-${index}`} role="option" aria-selected={index === active}>
            <button
              type="button"
              tabIndex={-1}
              onMouseEnter={() => setActive(index)}
              onClick={() => go(entry)}
              className={clsx("flex w-full items-baseline justify-between gap-3 rounded-xl px-3 py-2 text-left transition", index === active ? "bg-primary/15 text-ink" : "text-ink-soft hover:bg-raised")}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{entry.label}</span>
                {entry.hint && <span className="block truncate text-xs text-ink-muted">{entry.hint}</span>}
              </span>
              <span className="shrink-0 text-xs text-ink-muted">{entry.group}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="border-t border-line-soft px-4 py-2 text-xs text-ink-muted">{t.searchHint}</p>
    </Dialog>
  );
}
