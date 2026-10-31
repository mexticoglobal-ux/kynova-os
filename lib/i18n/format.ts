import type { ValueFormat } from "@/lib/contracts/module";

export function formatValue(value: number, format: ValueFormat, tag: string): string {
  if (format === "currency") {
    return new Intl.NumberFormat(tag, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
  }
  if (format === "percent") {
    return new Intl.NumberFormat(tag, { style: "percent", maximumFractionDigits: 1 }).format(value / 100);
  }
  return new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(value);
}

export function formatDelta(delta: number, tag: string): string {
  const formatted = new Intl.NumberFormat(tag, { maximumFractionDigits: 1, signDisplay: "always" }).format(delta);
  return `${formatted} %`;
}
