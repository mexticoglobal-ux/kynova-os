// Currencies and exchange rates for the Payments Center. Money is always an integer in minor units; each currency
// says how many decimals its minor unit has. Crypto is reserved: it can be represented, never settled yet.

import type { Money } from "./payments";

export const CURRENCIES = {
  USD: { decimals: 2, kind: "fiat" },
  EUR: { decimals: 2, kind: "fiat" },
  CRC: { decimals: 2, kind: "fiat" },
  MXN: { decimals: 2, kind: "fiat" },
  JPY: { decimals: 0, kind: "fiat" },
  BTC: { decimals: 8, kind: "crypto" },
  USDC: { decimals: 6, kind: "crypto" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;
export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export const isCurrency = (code: string): code is CurrencyCode => Object.prototype.hasOwnProperty.call(CURRENCIES, code);
export const isCrypto = (code: string): boolean => isCurrency(code) && CURRENCIES[code].kind === "crypto";

export function formatMinor(money: Money, locale = "es-CR"): string {
  const decimals = isCurrency(money.currency) ? CURRENCIES[money.currency].decimals : 2;
  const major = money.amountMinor / 10 ** decimals;
  return `${major.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${money.currency}`;
}

// Rates are informational (reports and totals). They are never used to settle a payment, which always happens in its own currency.
export type FxRate = { from: CurrencyCode; to: CurrencyCode; rate: number };

/** Converts using a direct rate or the inverse of the opposite one. Returns null when no usable rate exists. */
export function convertMinor(money: Money, to: CurrencyCode, rates: readonly FxRate[]): Money | null {
  if (money.currency === to) return money;
  if (!isCurrency(money.currency)) return null;
  const direct = rates.find((rate) => rate.from === money.currency && rate.to === to);
  const inverse = rates.find((rate) => rate.from === to && rate.to === money.currency);
  const factor = direct ? direct.rate : inverse && inverse.rate > 0 ? 1 / inverse.rate : null;
  if (factor === null || !(factor > 0) || !Number.isFinite(factor)) return null;
  const shift = CURRENCIES[to].decimals - CURRENCIES[money.currency].decimals;
  return { amountMinor: Math.round(money.amountMinor * factor * 10 ** shift), currency: to };
}

/** Adds amounts in different currencies into one reporting currency. Currencies without a rate are listed, never guessed. */
export function totalIn(reporting: CurrencyCode, amounts: readonly Money[], rates: readonly FxRate[]): { total: Money; missing: string[] } {
  let total = 0;
  const missing = new Set<string>();
  for (const amount of amounts) {
    const converted = convertMinor(amount, reporting, rates);
    if (converted) total += converted.amountMinor;
    else missing.add(amount.currency);
  }
  return { total: { amountMinor: total, currency: reporting }, missing: [...missing].sort() };
}

/** Sums by currency without converting anything. */
export function sumByCurrency(amounts: readonly Money[]): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const amount of amounts) sums[amount.currency] = (sums[amount.currency] ?? 0) + amount.amountMinor;
  return sums;
}

/** "1234.50" → 123450 (USD). Rejects extra decimals, signs and anything else, so a typo never becomes money. */
export function parseMajor(text: string, currency: CurrencyCode): number | null {
  const match = /^(\d{1,12})(?:\.(\d+))?$/.exec(text.trim().replace(/,/g, ""));
  if (!match) return null;
  const decimals = CURRENCIES[currency].decimals;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const minor = Number(match[1]) * 10 ** decimals + Number(fraction.padEnd(decimals, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}
