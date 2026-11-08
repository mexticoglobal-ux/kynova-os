// Form building blocks. The look of a field lives in app/globals.css (.field); these add size and layout.
export const FIELD = "field min-h-11 text-base";
export const FIELD_LG = "field min-h-12 text-base";
// The compact field of toolbars, tables and filters (app/globals.css .field-sm). INPUT sizes itself; INPUT_FULL fills its row.
export const INPUT = "field-sm";
export const INPUT_FULL = "field-sm w-full";
export const AREA = `${FIELD} py-2 leading-relaxed`;
export const LABEL = "mb-2 block text-sm font-medium text-ink-soft";
// <option> elements are drawn by the browser on the surface color, so they need an explicit pair.
export const OPTION = "bg-surface text-ink";
