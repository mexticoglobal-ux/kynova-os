"use client";

import clsx from "clsx";
import { useRef, type KeyboardEvent } from "react";

export type TabItem<K extends string> = { key: K; label: string };

// The one tab control of the product: a segmented bar that scrolls on a phone and works with the keyboard
// (arrows, Home and End move between tabs; only the selected tab is in the tab order). The look lives in app/globals.css (.tabs, .tab).
// With `idPrefix`, each tab gets the ids a panel needs (`${idPrefix}-tab-KEY` and aria-controls `${idPrefix}-panel-KEY`).
export function Tabs<K extends string>({ label, items, value, onChange, idPrefix, className }: { label: string; items: readonly TabItem<K>[]; value: K; onChange: (key: K) => void; idPrefix?: string; className?: string }) {
  const nodes = useRef(new Map<K, HTMLButtonElement>());

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const target = event.key === "ArrowRight" ? (index === last ? 0 : index + 1) : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1) : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    const next = items[target];
    if (!next) return;
    event.preventDefault();
    onChange(next.key);
    nodes.current.get(next.key)?.focus();
  }

  return (
    <div role="tablist" aria-label={label} className={clsx("tabs", className)}>
      {items.map((item, index) => (
        <button
          key={item.key}
          ref={(node) => {
            if (node) nodes.current.set(item.key, node);
          }}
          role="tab"
          type="button"
          id={idPrefix ? `${idPrefix}-tab-${item.key}` : undefined}
          aria-controls={idPrefix ? `${idPrefix}-panel-${item.key}` : undefined}
          aria-selected={item.key === value}
          tabIndex={item.key === value ? 0 : -1}
          onClick={() => onChange(item.key)}
          onKeyDown={(event) => onKeyDown(event, index)}
          className="tab"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
