/**
 * currencyTokens — the one list of currency symbols and ISO 4217 codes the
 * lens's money checks know (plan `2026-10-23-console-presentation-spaces`
 * D3.1).
 *
 * The rendered-page check (`CURRENCY_FIGURE`, re-exported by
 * `presentation.tsx`) and the source scan (`costRenderScan.ts`) both build
 * their patterns from here, so a code one of them knows the other cannot
 * miss. Review round 4 of Phase 1 found what a second copy costs: the
 * classifier's text prefilter knew four codes of the nine, so a module whose
 * only money text was `CHF` was never classified, while the scan beside it
 * flagged the same text. The classifier now keeps no currency text at all.
 */

/** The ISO 4217 codes the checks know, each read as a word. */
export const CURRENCY_CODES: readonly string[] = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "INR",
  "CNY",
];

/** The currency symbols the checks know. `¢` follows its figure; `$` precedes it. */
export const CURRENCY_SYMBOLS: readonly string[] = [
  "$",
  "€",
  "£",
  "¥",
  "₹",
  "¢",
];

/** The codes as a regex alternation: `USD|EUR|…`. */
export const CURRENCY_CODE_PATTERN = CURRENCY_CODES.join("|");

/** A regex character class of `symbols` (`$` needs no escape inside one). */
function symbolClass(symbols: readonly string[]): string {
  return `[${symbols.join("")}]`;
}

/** A currency symbol, or a code standing as a word — a regex source. */
export const CURRENCY_TOKEN_PATTERN = `(?:${symbolClass(CURRENCY_SYMBOLS)}|\\b(?:${CURRENCY_CODE_PATTERN})\\b)`;

/** The symbols that are written BEFORE a figure: all but `¢`. */
const SYMBOLS_BEFORE = CURRENCY_SYMBOLS.filter((s) => s !== "¢");
/**
 * The symbols that are written AFTER a figure: all but `$`. A `$` after a
 * digit is not one — `^0$` in a pattern string would read as a figure.
 */
const SYMBOLS_AFTER = CURRENCY_SYMBOLS.filter((s) => s !== "$");

/**
 * A currency symbol or code next to a number, either order: `$12`, `$.50`,
 * `€-3`, `12 USD`, `12,00 €` and `12¢`.
 */
export const CURRENCY_FIGURE = new RegExp(
  `${symbolClass(SYMBOLS_BEFORE)}\\s?-?\\.?\\d|\\b(?:${CURRENCY_CODE_PATTERN})\\s?-?\\d|\\d\\s?(?:${CURRENCY_CODE_PATTERN})\\b|\\d\\s?${symbolClass(SYMBOLS_AFTER)}`
);
