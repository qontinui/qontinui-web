/**
 * share — the console's ONE percentage formatter for a part of a whole.
 *
 * **Supports §3.2's `ShareBar` / `ShareList`** (`console-ui-style-guide.md`
 * §3.6). Promoted out of `plan-library/_components/PlanCoveragePanel.tsx` by
 * plan `2026-08-27-operator-touch-read-and-surface` Phase C3 rather than
 * written a third time: that panel's `share()` and `MergeOrchestrationSettings`'
 * `fmtRate` were already two, and the operator-touch surface needed a third.
 *
 * A bare `toFixed(1)` is wrong in both directions at the ends of the range,
 * and both errors are the class the console exists to delete:
 *
 * * **9999 of 10000 rounds to `100.0%`** — full coverage, rendered for an
 *   incomplete whole.
 * * **1 of 10000 rounds to `0.0%`** — "none of it" when there is some;
 *   absence-is-not-zero, one level down.
 *
 * So the two ends are reserved for the EXACT cases and everything between
 * them is hedged with `>` or `<`. `100%` and `0%` are then load-bearing: they
 * mean exactly that.
 *
 * And a share over NOTHING is not a share. A zero, negative or non-finite
 * denominator, or a part outside `0..whole`, renders the console's unknown
 * dash `–` (R6) — never `0%`, which would assert a measured absence, and never
 * `100%`, which is what `0 of 0` used to compute to.
 */

/** The console's "we cannot say" glyph — the same dash R6 puts on a count. */
export const SHARE_UNKNOWN = "–";

/**
 * A fraction in `[0, 1]`, formatted to one decimal with exact ends.
 *
 * `null`/`undefined` (coord's "no signal"), a non-finite value, or anything
 * outside the unit interval renders {@link SHARE_UNKNOWN}. Exact ends are
 * exact floats: `n / n === 1` and `0 / n === 0` for any positive integer `n`,
 * so a server-computed rate hedges identically to a count pair.
 */
export function shareOfFraction(fraction: number | null | undefined): string {
  if (fraction == null || !Number.isFinite(fraction)) return SHARE_UNKNOWN;
  if (fraction < 0 || fraction > 1) return SHARE_UNKNOWN;
  if (fraction === 1) return "100%";
  if (fraction === 0) return "0%";
  const rounded = (fraction * 100).toFixed(1);
  if (rounded === "100.0") return ">99.9%";
  if (rounded === "0.0") return "<0.1%";
  return `${rounded}%`;
}

/** `numerator` of `denominator`, as a share — see the module doc. */
export function share(numerator: number, denominator: number): string {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return SHARE_UNKNOWN;
  }
  if (denominator <= 0 || numerator < 0 || numerator > denominator) {
    return SHARE_UNKNOWN;
  }
  return shareOfFraction(numerator / denominator);
}
