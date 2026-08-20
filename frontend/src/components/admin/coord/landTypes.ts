/**
 * Land / deploy verification WIRE TYPES and the D3 colour ladders.
 *
 * Extracted from `LandCard.tsx` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 2,
 * unchanged. The card became `<LandRow>`; these types and the three exported
 * `*Variant` ladders are pure, shared with `/admin/coord/deploys`, and were
 * already unit-tested through the card only because the card was where they
 * happened to live. A module with no `"use client"` and no JSX is the right
 * home for a contract two surfaces depend on.
 *
 * Wire shapes mirror coord's `/coord/lands` response (snake_case serde).
 * Rendered defensively (optional chaining + fallbacks) because the
 * `PredictedLandEffect` field set may grow — the plan explicitly calls for
 * inspecting field names at runtime rather than assuming them.
 */

export type LandAction = "push" | "land";

export type ComposedOutcome =
  | "confirmed"
  | "surprise"
  | "failure"
  | "contradiction"
  | "partial";

export type LandDimension = "git" | "cascade" | "ci" | "release";

export interface DimensionVerdict {
  dimension: LandDimension | string;
  drift_class?: string | null;
  // Optional finer-grained class coord may attach alongside `drift_class`
  // (e.g. the schema dimension's `schema:predicted_head_fork` /
  // `schema:predicted_head_fork_managed`). Mirrors the digital-twin verdict
  // wire shape's `drift_subclass`. Rendered defensively — absent on most rows.
  drift_subclass?: string | null;
  outcome?: string | null;
  detail?: string | null;
}

export interface LandVerification {
  id: string;
  dimension_verdicts?: DimensionVerdict[] | null;
  composed_outcome?: ComposedOutcome | string | null;
  settled?: boolean | null;
  dimensions_predicted?: number | null;
  dimensions_observed?: number | null;
  coverage?: number | null;
  rationale?: string | null;
  created_at?: string | null;
}

export interface LandSignature {
  id: string;
  action?: LandAction | string | null;
  repo?: string | null;
  pr_number?: number | null;
  branch?: string | null;
  from_sha?: string | null;
  to_sha?: string | null;
  merge_strategy?: "squash" | "merge" | "rebase" | string | null;
  correlation_id?: string | null;
  // PredictedLandEffect — rendered defensively; see PredictedLandEffect type.
  predicted?: PredictedLandEffect | null;
  created_at?: string | null;
}

export interface LandRow {
  signature: LandSignature;
  verification: LandVerification | null;
}

// PredictedLandEffect — mirrors coord's final serde shapes (snake_case).
// Every field is optional + rendered defensively (optional chaining) so a
// partial / future-extended payload still renders, but the PRIMARY field
// names below are the exact coord wire names — guessed aliases were removed.

// ConfidenceInterval is `{ point, low, high }` (NOT lower/upper).
export interface ConfidenceInterval {
  point?: number | null;
  low?: number | null;
  high?: number | null;
}

// A predicted cascade conflict. coord sends `child_ref` (the dependent ref
// that conflicts) + `hunk_overlaps`; there is NO affected_agents field — the
// child_ref IS the affected ref/agent chip.
export interface PredictedConflict {
  child_ref?: string | null;
  paths?: string[] | null;
  hunk_overlaps?: number | null;
  auto_resolvable?: boolean | null;
}

// A predicted CI workflow. Label = `workflow_name`. Per-workflow confidence
// = `expected_pass` (a ConfidenceInterval). `trigger_uncertain`,
// `path_conditioned`, `sample_size` are surfaced as subtle chips/tooltips.
export interface PredictedWorkflow {
  workflow_name?: string | null;
  trigger_uncertain?: boolean | null;
  expected_pass?: ConfidenceInterval | number | null;
  path_conditioned?: boolean | null;
  sample_size?: number | null;
}

// A predicted deploy: which `surface` (vercel/ecs/npm/…) + `target`.
export interface PredictedDeployService {
  surface?: string | null;
  target?: string | null;
}

export interface PredictedLandEffect {
  cascade?: {
    dependent_refs_to_restack?: string[] | null;
    cascade_depth?: number | null;
    // bool — NOT a confidence interval; rendered as a badge.
    will_complete_cleanly?: boolean | null;
    expected_conflicts?: PredictedConflict[] | null;
  } | null;
  git?: {
    will_advance_to?: string | null;
    no_force_required?: boolean | null;
  } | null;
  ci?: {
    // `pending` = honest non-coverage; render `note` as the explanation.
    pending?: boolean | null;
    workflows?: PredictedWorkflow[] | null;
    expected_pass?: boolean | null;
    changed_paths?: string[] | null;
    note?: string | null;
  } | null;
  deploy?: {
    pending?: boolean | null;
    services_will_deploy?: PredictedDeployService[] | null;
    expected_health_check_pass?: boolean | null;
    note?: string | null;
  } | null;
  main_merge_overlap?: boolean | null;
  inferred_prior?: {
    adverse_freq?: number | null;
    samples?: number | null;
    applied?: boolean | null;
    provenance?: string | null;
  } | null;
  // Cross-repo cascade siblings — the correlated lands in OTHER repos that
  // this land's cascade fans out to. Empty array for single-repo lands;
  // older persisted rows may LACK the field entirely (hence `?`), so render
  // defensively. Each `cascade` is the same shape as `predicted.cascade`.
  sibling_cascades?: SiblingCascade[] | null;
}

// One correlated sibling-repo cascade. `cascade` is defensively nullable
// (a persisted row may carry the link without a re-computed cascade).
export interface SiblingCascade {
  repo: string;
  branch: string;
  correlated_via: string;
  cascade: PredictedLandEffect["cascade"] | null;
}

// ---- Badge variants -------------------------------------------------------
//
// `composedOutcomeVariant` and `dimensionOutcomeVariant` used to live here.
// They were DELETED in Phase 3 Wave 2, with their tests, once the composed-D3
// ladder moved into `verificationStatus.ts` and grew an audited attention
// table behind it. Keeping them would have left two sources of truth for one
// decision that DISAGREED: their contract pinned `surprise → warning (amber)`,
// which the new table reverses to calm on purpose (nothing clears a settled
// surprise, so amber was a promise it could not keep — see R3's third case).
// A dead ladder with a green test asserting the opposite of the shipped one is
// worse than no ladder.
//
// `driftClassVariant` below is the survivor: it maps a different vocabulary
// (coord's cross-repo `worst_drift_class`) and `<LandRow>`'s cross-repo panel
// still renders through it.

/**
 * The shadcn `<Badge variant>` union, as this surface's modules use it.
 *
 * Declared here rather than imported from `ui/badge` because two of the
 * variants (`success` / `warning` / `info` / `brand-*`) are local additions
 * and the ladders below are unit-tested WITHOUT rendering a badge.
 */
export type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info"
  | "brand-primary"
  | "brand-secondary"
  | "brand-success";

// ---- Drift-class → badge variant (cross-repo restack verdicts) ------------
//
// Coord's `worst_drift_class` tokens, mapped to the same color ladder used
// elsewhere on this surface. Exported + unit-tested so the cross-repo
// verdict colors can't silently drift from coord's taxonomy.
//   none          → green   (success)   — verified clean
//   benign_add    → blue    (info)      — additive, non-conflicting
//   pending       → blue    (info)      — not yet verified
//   in_place      → amber   (warning)   — restacked in place
//   active_negation→ red    (destructive)
//   divergent     → red     (destructive)
//   unknown       → neutral (outline)
const DRIFT_VARIANT: Record<string, BadgeVariant> = {
  none: "success",
  benign_add: "info",
  pending: "info",
  in_place: "warning",
  active_negation: "destructive",
  divergent: "destructive",
  unknown: "outline",
};

/**
 * Map a coord `worst_drift_class` token to its badge variant. Null/unknown →
 * outline (no fabricated color). Exported (and unit-tested) so the cross-repo
 * verdict color contract can't silently drift.
 */
export function driftClassVariant(
  driftClass?: string | null
): BadgeVariant {
  if (!driftClass) return "outline";
  return DRIFT_VARIANT[driftClass] ?? "outline";
}

export { DRIFT_VARIANT };

/**
 * A sha shortened to its recognisable prefix, with an EXPLICIT em dash for an
 * absent one rather than a blank.
 */
export function shortSha(sha?: string | null): string {
  if (!sha) return "—";
  return sha.length > 8 ? sha.slice(0, 8) : sha;
}

