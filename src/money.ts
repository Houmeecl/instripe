/**
 * Currencies with no minor unit (amounts are already whole units).
 * Stripe treats these as "zero-decimal" currencies.
 */
const ZERO_DECIMAL = new Set(["clp", "jpy", "krw", "vnd", "pyg", "xaf", "xof"]);

export function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL.has(currency.toLowerCase());
}

/** Convert a stored smallest-unit amount to a major-unit number for display. */
export function toMajorUnits(amount: number, currency: string): number {
  return isZeroDecimal(currency) ? amount : amount / 100;
}

export function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(currency.toLowerCase() === "clp" ? "es-CL" : "en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: isZeroDecimal(currency) ? 0 : 2,
    }).format(toMajorUnits(amount, currency));
  } catch {
    return `${toMajorUnits(amount, currency)} ${currency.toUpperCase()}`;
  }
}
