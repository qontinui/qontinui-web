/**
 * Deploy verification WIRE TYPES and the deploy-specific verdict helpers.
 *
 * Extracted from `DeployCard.tsx` by plan
 * `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 3 Wave 2,
 * unchanged. The card became `<DeployRow>`; everything here is pure, was
 * already unit-tested through the card, and belongs in a module with no
 * `"use client"` and no JSX.
 *
 * Coord serializes these as snake_case; the interfaces mirror `/coord/deploys`'
 * projection (`row_to_deploy_entry`). The deploy dimensions are
 * release/infra/schema/health/ci/config — `DimensionVerdict` is reused from
 * `landTypes` (same {dimension, drift_class, outcome, detail} shape).
 */

import type { DimensionVerdict } from "@/components/admin/coord/landTypes";

export interface DeployVerification {
  id: string;
  dimension_verdicts?: DimensionVerdict[] | null;
  composed_outcome?: string | null;
  settled?: boolean | null;
  dimensions_predicted?: number | null;
  dimensions_observed?: number | null;
  coverage?: number | null;
  rationale?: string | null;
  created_at?: string | null;
}

export interface DeploySignature {
  id: string;
  service?: string | null;
  environment?: "staging" | "production" | string | null;
  /// The typed deploy target, e.g. {"commit": "<sha>"} / {"image_digest": "sha256:…"}.
  target?: Record<string, unknown> | null;
  source?: "ci" | "manual" | "orchestrator" | string | null;
  migration_required?: boolean | null;
  correlation_id?: string | null;
  predicted?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface DeployRow {
  signature: DeploySignature;
  verification: DeployVerification | null;
}

export interface RollbackProposal {
  failed_signature_id?: string | null;
  declare?: {
    service?: string | null;
    source_image_or_commit?: string | null;
    target_environment?: string | null;
    source?: string | null;
    correlation_id?: string | null;
  } | null;
  ci_action?: { repo?: string | null; workflow_file?: string | null } | null;
  auto_eligible?: boolean | null;
  rationale?: string | null;
}

/**
 * Render the typed deploy target as one short artifact token. Coord persists
 * `DeployTarget` adjacently tagged: `{kind: "image_digest"|"commit"|
 * "task_def_revision", value: …}`.
 */
export function shortTarget(target?: Record<string, unknown> | null): string {
  if (!target) return "—";
  const kind = target["kind"];
  const value = target["value"];
  if (kind === "image_digest" && typeof value === "string") {
    // sha256:abcd1234… → sha256:abcd123…
    return value.length > 15 ? `${value.slice(0, 15)}…` : value;
  }
  if (kind === "commit" && typeof value === "string") {
    return value.length > 8 ? value.slice(0, 8) : value;
  }
  if (kind === "task_def_revision" && typeof value === "number") {
    return `taskdef:${value}`;
  }
  return typeof value === "string" ? value.slice(0, 16) : "—";
}

/** A settled hard-terminal verification is the only state with a proposal. */
export function rollbackProposalPossible(
  ver?: DeployVerification | null
): boolean {
  if (!ver?.settled) return false;
  const o = (ver.composed_outcome ?? "").toLowerCase();
  return o === "failure" || o === "contradiction";
}

// ---- Schema-drift subclass → badge variant + label ------------------------
//
// The schema/migration dimension's drift verdict (coord's
// `coord_query_migration_state`) carries an optional `drift_subclass`. A
// *predicted alembic head-fork* arrives two ways:
//
//   schema:predicted_head_fork          — unmanaged / conflicting fork.
//                                         Stays a RED d3 Contradiction (the
//                                         per-dimension `outcome` already
//                                         colors it `destructive` — unchanged).
//   schema:predicted_head_fork_managed  — a fork coord can AUTO-RESOLVE
//                                         (d3 `Failure`, canonical drift_class
//                                         `pending`). Rendered AMBER
//                                         ("auto-managed") — visually distinct
//                                         from the red Contradiction and from
//                                         healthy green: coord owns it, no
//                                         operator action needed.
//
// Exported (and unit-tested) so this managed/unmanaged color+label contract
// can't silently drift from coord's subclass taxonomy.

export const MANAGED_HEAD_FORK_SUBCLASS =
  "schema:predicted_head_fork_managed";

/**
 * A managed predicted-head-fork is the one verdict whose `outcome`-derived
 * color we override: coord auto-resolves it, so it must read amber
 * ("auto-managed"), NOT the red its `Failure`/`Contradiction` outcome would
 * otherwise produce.
 */
export function isManagedPredictedHeadFork(
  v?: DimensionVerdict | null
): boolean {
  return v?.drift_subclass === MANAGED_HEAD_FORK_SUBCLASS;
}

// `verdictChipVariant` used to sit here. DELETED in Phase 3 Wave 2 with its
// test: `<DeployRow>` renders the per-dimension verdicts through
// `<VerdictChips>`, which encodes the outcome as a colourblind-safe GLYPH
// rather than a `BadgeVariant`, so nothing called it any more — and its test
// still described the managed head-fork as "forced amber", which is no longer
// what the surface does (it gets the calm `~`). `isManagedPredictedHeadFork`
// and `verdictChipLabel` below are both still live.

/**
 * Friendly chip label. A managed predicted-head-fork reads "auto-managed"
 * (its raw d3 outcome would otherwise read "Failure"/"contradiction", which
 * misleads — coord is resolving it). All other verdicts show their raw
 * outcome token unchanged.
 */
export function verdictChipLabel(v?: DimensionVerdict | null): string {
  if (isManagedPredictedHeadFork(v)) return "auto-managed";
  return v?.outcome ?? "—";
}

