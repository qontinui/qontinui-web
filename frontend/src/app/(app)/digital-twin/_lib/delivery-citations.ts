/**
 * One reader for coord's citation bookkeeping on a delivery verdict.
 *
 * Coord reports each citation bucket TWICE — as a number (`landed_count`,
 * `blocking_unmerged_count`, `terminal_unlanded_count`) and, when it fits, as
 * the list itself (`prs`, `unmerged_prs`, `terminal_unlanded_prs`) — and both
 * halves of every pair are independently optional. A surface that re-derives
 * citation state from its own favourite subset of those six fields drifts away
 * from the surfaces that picked a different subset, which is exactly how the
 * card came to render an amber "unmerged" badge beside prose saying the unit
 * had delivered.
 *
 * So the resolution rules live here once and both surfaces read them:
 * count first, list second, per-citation flags last.
 */

import type { DeliveryComponents, DeliveryPr } from "./types";

/** The three citation buckets, resolved to numbers a surface can render. */
export interface CitationCounts {
  /** Citations that positively landed. */
  landed: number;
  /** Citations that are still BLOCKING — the ones that actually pin the unit. */
  blocking: number;
  /** Citations retired as terminally unlanded (closed, never merged). */
  retired: number;
  /** Citations in total, as coord listed them in `prs`. */
  total: number;
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asList(value: unknown): DeliveryPr[] {
  return Array.isArray(value) ? (value as DeliveryPr[]) : [];
}

/**
 * Resolve every citation bucket to a number.
 *
 * Each bucket is read count-first because a verdict may carry the numbers
 * without the lists; falling straight to a list length then understates the
 * bucket to zero, and a zero is what turns the honest "3 still unmerged" into
 * the vague "merge state mixed" — or, when something was also retired, into the
 * flatly false "none landed".
 *
 * When neither the count nor the bucket's own list is served, the bucket is
 * derived from `prs` itself, so a verdict carrying only the citation list still
 * yields a literal breakdown rather than an unknown. That derivation subtracts
 * the retired citations through `isRetiredCitation`, not through the per-item
 * flag alone — otherwise a citation coord retired only in
 * `terminal_unlanded_prs` lands in the blocking bucket AND the retired one, and
 * a single dead citation reads as "1 still unmerged, 1 closed without landing".
 */
export function citationCounts(
  components: DeliveryComponents | undefined,
): CitationCounts {
  const c = components ?? {};
  const prs = asList(c.prs);

  const retired =
    asCount(c.terminal_unlanded_count) ??
    (c.terminal_unlanded_prs !== undefined
      ? asList(c.terminal_unlanded_prs).length
      : prs.filter((pr) => pr?.terminal_unlanded === true).length);

  const blocking =
    asCount(c.blocking_unmerged_count) ??
    (c.unmerged_prs !== undefined
      ? asList(c.unmerged_prs).length
      : prs.filter((pr) => pr?.merged !== true && !isRetiredCitation(pr, c))
          .length);

  const landed =
    asCount(c.landed_count) ?? prs.filter((pr) => pr?.merged === true).length;

  return { landed, blocking, retired, total: prs.length };
}

/**
 * Is this citation one coord RETIRED — closed, never merged, carrying no land
 * stamp of any provenance, and therefore neither blocking delivery nor counting
 * toward it (coord plan
 * `2026-08-18-closed-unmerged-citation-pins-shipped-forever`)?
 *
 * Retirement reaches a surface two ways and neither is guaranteed: coord stamps
 * `terminal_unlanded` on the citation, and it also lists the retired citations
 * in `terminal_unlanded_prs`. Reading only the per-item flag leaves a retired
 * citation wearing the amber "unmerged" badge — the contradiction beside a
 * no-drift verdict that the retirement rendering exists to remove.
 *
 * A citation with no PR number is matched on its own flag alone: `repo` cannot
 * tell two numberless citations in the same repo apart, and retiring the wrong
 * one is a worse error than missing the mark on it.
 */
export function isRetiredCitation(
  pr: DeliveryPr,
  components: DeliveryComponents | undefined,
): boolean {
  if (pr.merged === true) return false;
  if (pr.terminal_unlanded === true) return true;
  if (pr.pr === null || pr.pr === undefined) return false;
  return asList(components?.terminal_unlanded_prs).some(
    (retiredPr) => retiredPr?.repo === pr.repo && retiredPr?.pr === pr.pr,
  );
}
