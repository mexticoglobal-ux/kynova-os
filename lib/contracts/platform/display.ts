// Display limits live here, in the view, and nowhere else. Data is never trimmed: a record that existed stays.

export const DISPLAY_LIMIT = 40;

/** The newest `limit` items, newest first, and how many older ones are not shown. */
export function latest<T>(items: readonly T[], limit: number = DISPLAY_LIMIT): { shown: T[]; hidden: number } {
  const shown = items.slice(-limit).reverse();
  return { shown, hidden: Math.max(0, items.length - shown.length) };
}

export const hiddenNote = (hidden: number): string | null => (hidden > 0 ? `Mostrando lo más reciente; ${hidden} anteriores no se muestran aquí.` : null);
