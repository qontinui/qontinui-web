/**
 * Reading and writing the overview's money and decimals.
 *
 * Money crosses the wire as an integer count of **micros** — millionths of a
 * currency unit, the spelling the fleet already uses for prepaid balances
 * (`balance_micros: 19280000` is 19.28). Every other decimal (person-days,
 * weeks, FTE, percentages) crosses as a decimal **string**, because
 * `jsonable_encoder` would otherwise turn it into a float. Nothing here
 * re-derives a total: the backend's rollup owns all arithmetic, and these are
 * display and input helpers only.
 */

const MICROS_PER_UNIT = 1_000_000;

/**
 * Format micros as an amount a reader recognises. Returns `null` for `null`
 * so a caller has to decide what "not available" looks like — this helper
 * never invents a zero.
 */
export function formatMicros(
  micros: number | null | undefined,
  currency: string | null | undefined,
  options: { maximumFractionDigits?: number } = {}
): string | null {
  if (micros === null || micros === undefined) return null;
  const amount = micros / MICROS_PER_UNIT;
  const maximumFractionDigits = options.maximumFractionDigits ?? 0;
  if (currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits,
        minimumFractionDigits: 0,
      }).format(amount);
    } catch {
      // An unknown ISO code must not blank the figure — show the number and
      // the code the tenant actually entered.
      return `${new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(amount)} ${currency}`;
    }
  }
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(
    amount
  );
}

/** A low–high band, or the single figure when both ends agree. */
export function formatMicrosRange(
  low: number | null | undefined,
  high: number | null | undefined,
  currency: string | null | undefined
): string | null {
  const lowText = formatMicros(low, currency);
  if (lowText === null) return null;
  if (high === null || high === undefined || high === low) return lowText;
  const highText = formatMicros(high, currency);
  return highText === null ? lowText : `${lowText} – ${highText}`;
}

/**
 * Parse a decimal STRING from the wire into a number for display maths only
 * (widths, shares). Returns `null` for null/undefined/unparseable, so an
 * absent figure never becomes 0.
 */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Render a wire decimal with a fixed number of places, trimming a trailing
 * `.00`. `null` in, `null` out.
 */
export function formatDecimal(
  value: string | number | null | undefined,
  places = 2
): string | null {
  const parsed = toNumber(value);
  if (parsed === null) return null;
  const fixed = parsed.toFixed(places);
  return fixed.replace(/\.?0+$/, "") || "0";
}

/** Whole-currency-unit input (e.g. `900` or `1,200.50`) to integer micros. */
export function parseAmountToMicros(input: string): number | null {
  const cleaned = input.replace(/[\s,]/g, "").trim();
  if (cleaned === "") return null;
  if (!/^-?\d*(\.\d+)?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  if (!Number.isFinite(amount)) return null;
  return Math.round(amount * MICROS_PER_UNIT);
}

/** Integer micros back to a plain editable number, e.g. `900` or `1200.5`. */
export function microsToAmountInput(
  micros: number | null | undefined
): string {
  if (micros === null || micros === undefined) return "";
  return String(micros / MICROS_PER_UNIT);
}
