/**
 * A read's disclosure lines — what it did and did not measure.
 *
 * Extracted from `planReconciliationStatus.ts` by Phase 4c of plan
 * `2026-09-20-the-operator-plans-page-reads-the-wrong-store`, when
 * `/plan-library/candidates` turned out to owe the operator the **same three
 * disclosures** the reconciliation page already renders — a population state
 * whose `unavailable` arm silently narrows the denominator, a page-wide coord
 * circuit, and a corpus-health block that is `null`-means-UNKNOWN. Two
 * surfaces answering one contract want one vocabulary, not two that drift.
 *
 * The shape is deliberately tiny and carries no styling: a level, a sentence,
 * and an optional list of VERBATIM strings. That last field is the load-bearing
 * one on both surfaces — `work_unit_population_reason`,
 * `facets.corpus_incomplete_reasons`, `corpus_health_unavailable_reason` are
 * the fields that still say something true when the boolean flags do not, so
 * they are quoted rather than summarised.
 *
 * `planReconciliationStatus.ts` re-exports both types, so no existing importer
 * had to move.
 */

/**
 * How loudly a line reads.
 *
 * `critical` is NOT an R3 attention claim (nobody is being asked to act on a
 * row); it marks the line that every flag below it depends on. The general
 * rule both surfaces implement — **render the population state before any flag
 * derived from the population** — is what it exists to make visible.
 */
export type DisclosureLevel = "critical" | "caveat" | "note";

export interface DisclosureLine {
  key: string;
  level: DisclosureLevel;
  text: string;
  /**
   * Values carried VERBATIM from the route — reasons, gaps, violations.
   * Rendered as a list rather than folded into `text`, because these are the
   * fields that still say something true when the flags do not.
   */
  items?: string[];
}
