// ============================================================================
// gateDecision — pure derivation for coord's blast-radius merge-gate decisions.
// ============================================================================
//
// R8 ("no internal vocabulary on a primary surface", and its second half: the
// derivation is a pure, exhaustively-testable module, not inline JSX). These
// functions were module-private in `MergeTrain.tsx`, reachable only through a
// rendered row, so the honesty contract they encode could only be tested
// through the DOM. They move here unchanged in behaviour, plus the two joins
// the 2026-09-19 pipeline redesign needs.
//
// ## Why a join exists at all
//
// Before the redesign the gate decisions were a page-level SECTION below the
// PR list: a second list, over an overlapping population, in a second
// vocabulary, which the operator joined to the list above it by reading
// `repo#number` with their eyes. A gate decision for `repo#N` is *why that PR
// is not moving* — it is evidence belonging to that PR's row. `attachGateBlocks`
// is that join, and `unattachedGateBlocks` is the honest remainder: decisions
// whose PR is not in the current list at all.
//
// That remainder is not an error and must not be dropped. Coord returns the
// newest row per PR within its retention window, so a PR unblocked weeks ago —
// or closed, or outside the open/merged window this page fetches — still has a
// row. Those are audit records with no live symptom to attach to, and they go
// behind a disclosure rather than into the live list.

import { isAfter } from "./utils";
import type { BlastRadiusBlock } from "./mergeTypes";

// ----------------------------------------------------------------------------
// Honesty rendering
// ----------------------------------------------------------------------------
//
// Binding cross-cutting gate: a degraded decision is NEVER presented as
// authoritative.
//   - coverage < 1              -> "partial coverage"
//   - graph_available === false -> "non-authoritative (no resolved graph)"
//   - block_reason_code absent  -> "gate did not run" (distinct from "passed")
//   - coverage/graph absent     -> "coverage not reported" (NOT full coverage)

export type HonestyTone = "ok" | "degraded" | "unknown";

export interface HonestyLabel {
  text: string;
  tone: HonestyTone;
}

/**
 * Derive the coverage / honesty label for a gate block. Pure + total — every
 * branch returns a label, so a row never renders an undefined honesty state.
 */
export function honestyLabel(b: BlastRadiusBlock): HonestyLabel {
  // The gate did not run on this PR — the decision is not a gate verdict at
  // all. Distinct from "passed" and from a degraded run.
  if (b.block_reason_code === null || b.block_reason_code === undefined) {
    return { text: "gate did not run", tone: "unknown" };
  }
  // Ran without a resolved code graph — explicitly non-authoritative.
  if (b.graph_available === false) {
    return { text: "non-authoritative (no resolved graph)", tone: "degraded" };
  }
  // Ran on a partial/cold mirror — honest about incompleteness.
  if (typeof b.coverage === "number" && b.coverage < 1) {
    const pct = Math.round(b.coverage * 100);
    return { text: `partial coverage (${pct}%)`, tone: "degraded" };
  }
  // Authoritative full-coverage run.
  if (b.coverage === 1 && b.graph_available === true) {
    return { text: "full coverage", tone: "ok" };
  }
  // Coverage/graph fields not yet plumbed through coord — do NOT claim full
  // coverage we can't substantiate.
  return { text: "coverage not reported", tone: "unknown" };
}

/**
 * How many evaluations a gate-decision row stands for.
 *
 * Coord coalesces byte-identical repeat evaluations onto the newest row and
 * reports the run length as `repeat_count`; a coord that has not shipped that
 * yet omits the field, in which case the row is exactly one evaluation.
 * Clamped to >= 1 on purpose — rendering `×0` would claim the decision never
 * happened, which is the opposite of what the row proves.
 */
export function gateRepeatCount(b: BlastRadiusBlock): number {
  const n = b.repeat_count;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/**
 * `YYYY-MM-DD` (UTC) for the repeat badge's "since" clause. Returns null both
 * when coord sent no `first_seen_at` AND when what it sent will not parse —
 * the badge then states the count alone rather than substituting `at`, which
 * would falsely claim a zero-length run. The two null causes are deliberately
 * NOT distinguished by the caller's copy: "unknown" is true of both, whereas
 * "not reported" would be a lie about the malformed case.
 */
export function gateFirstSeenDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// The join
// ----------------------------------------------------------------------------

/**
 * The join key between a gate decision and a pipeline row: `owner/name#123`.
 *
 * Deliberately NOT the row's own `key` (`singleKey`, a repo+branch pair):
 * coord's gate rows carry a PR NUMBER and no branch, so repo+number is the
 * only identity both sides actually hold. A row with a null `prNumber` (a
 * proposal-only row) therefore joins to nothing, which is correct — the gate
 * decides on PRs, not on scheduler proposals.
 */
export function gateBlockKey(repo: string, prNumber: number): string {
  return `${repo}#${prNumber}`;
}

/**
 * Index the decisions by `repo#number`, newest-first wins.
 *
 * Coord already returns the newest row per PR, so a duplicate key means either
 * an older coord (pre-coalescing, raw audit rows) or two replicas answering.
 * Keeping the newer `at` is the same choice coord's own coalescing makes, and
 * it keeps the row detail showing the decision that is current rather than
 * whichever the array happened to order first.
 *
 * `isAfter`, not `>`. The duplicate-key causes named above are precisely the
 * two-producer case, and two producers are what put mixed fractional-second
 * widths (and `Z` vs `+00:00`) in one array — where lexicographic order stops
 * being chronological. See `utils.ts`.
 */
export function indexGateBlocks(
  blocks: BlastRadiusBlock[] | null
): Map<string, BlastRadiusBlock> {
  const byPr = new Map<string, BlastRadiusBlock>();
  for (const b of blocks ?? []) {
    const key = gateBlockKey(b.repo, b.pr_number);
    const held = byPr.get(key);
    if (!held || isAfter(b.at, held.at)) byPr.set(key, b);
  }
  return byPr;
}

/**
 * The decisions that found no PR in the current list.
 *
 * `presentKeys` must be built from EVERY row the page holds, not from the
 * filtered/visible ones: a decision is "unattached" because its PR is absent
 * from the data, never because the operator picked the In-flight tab. Sorted
 * newest-first so the disclosure reads like the audit log it is.
 */
export function unattachedGateBlocks(
  blocks: BlastRadiusBlock[] | null,
  presentKeys: ReadonlySet<string>
): BlastRadiusBlock[] {
  return [...indexGateBlocks(blocks).entries()]
    .filter(([key]) => !presentKeys.has(key))
    .map(([, b]) => b)
    // `isAfter`, for the same reason `indexGateBlocks` uses it: this list is
    // assembled from rows more than one coord replica may have written.
    .sort((a, b) => (isAfter(a.at, b.at) ? -1 : isAfter(b.at, a.at) ? 1 : 0));
}

/**
 * Hover text for the health strip's `gate holds N` badge.
 *
 * `total_evals` is the discriminator for WHICH coord is on the other end.
 * Coord's pre-Phase-2 handler computed `total_blocks` as a raw `COUNT(*)` over
 * `coord.pr_events` — an EVALUATION count (measured 2026-08-20: 1899 rows for
 * 8 distinct PRs) — and reported no `total_evals` at all. So a number with no
 * `total_evals` beside it has UNKNOWN provenance, and this says so rather than
 * calling it a count of held PRs.
 */
export function gateProvenanceTitle(
  totalBlocks: number,
  totalEvals: number | null
): string {
  if (totalEvals === null) {
    return (
      "Coord has not reported whether this counts decisions or audit rows. " +
      "Older deploys returned a raw audit-row count here, which runs far " +
      "higher than the number of PRs actually held."
    );
  }
  const evals =
    totalEvals > totalBlocks
      ? ` ${totalEvals} raw evaluation rows sit behind them — coord re-evaluates every held PR on each scheduler tick.`
      : "";
  return `Distinct PRs the blast-radius gate is holding — decisions, not audit rows.${evals}`;
}
