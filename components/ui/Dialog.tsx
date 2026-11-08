"use client";

import clsx from "clsx";
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

// The one modal of the product: it traps the focus, closes with Escape or a click on the scrim, gives the focus back to what opened it,
// and holds the page still while it is open. The look lives in app/globals.css (.dialog-scrim) and the card.
export function Dialog({ open, onClose, label, children, className }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = panel.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel.current)?.focus();
    return () => {
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    const [firstItem, lastItem] = [items[0], items[items.length - 1]];
    if (!firstItem || !lastItem) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === firstItem) {
      event.preventDefault();
      lastItem.focus();
    } else if (!event.shiftKey && document.activeElement === lastItem) {
      event.preventDefault();
      firstItem.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:pt-[12vh]" onKeyDown={onKeyDown}>
      <button type="button" tabIndex={-1} aria-label="Cerrar" onClick={onClose} className="dialog-scrim absolute inset-0 cursor-default" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={clsx("card relative w-full max-w-xl animate-pop-in outline-none", className)}>
        {children}
      </div>
    </div>
  );
}
