"use client";

/**
 * LandCard — render a single declared land (its `LandSignature`) plus,
 * when present, its composed `LandVerification` with the per-dimension
 * verdict row.
 *
 * Plan `2026-05-31-push-land-action-effect-signatures-plan.md` Phase 4 —
 * pre-land impact preview surface. This card is the "recent lands"
 * history element on `/admin/coord/lands`.
 *
 * Wire shapes mirror coord's `/coord/lands` response (snake_case serde).
 * Rendered defensively (optional chaining + fallbacks) because the
 * `PredictedLandEffect` field set may grow — the plan explicitly calls
 * for inspecting field names at runtime rather than assuming them.
 */

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Anchor,
  GitBranch,
  GitPullRequest,
  Loader2,
  Network,
  ShieldQuestion,
} from "lucide-react";
import { httpClient } from "@/services/service-factory";

// ---- Wire types -----------------------------------------------------------
//
// Coord serializes these as snake_case. The generated `@qontinui/shared-types`
// land exports are not yet published (they regenerate via CI on merge of the
// schemas package); these local interfaces are intentionally identical in
// shape and should be swapped for the generated exports once republished.

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

// ---- Outcome → badge variant (the testable source of truth) ---------------
//
// Color tokens per the plan's binding spec:
//   confirmed    → green   (success)
//   surprise     → amber   (warning)
//   partial      → gray/blue (info — distinct neutral-informational)
//   failure      → red     (destructive)
//   contradiction→ red     (destructive)
// Unknown / unsettled-null falls back to the neutral `outline`.

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

const OUTCOME_VARIANT: Record<ComposedOutcome, BadgeVariant> = {
  confirmed: "success",
  surprise: "warning",
  partial: "info",
  failure: "destructive",
  contradiction: "destructive",
};

/**
 * Map a composed-outcome token to its badge variant. Null/unknown → outline.
 * Exported (and unit-tested) so the color contract can't silently drift.
 */
export function composedOutcomeVariant(
  outcome?: string | null
): BadgeVariant {
  if (!outcome) return "outline";
  return OUTCOME_VARIANT[outcome as ComposedOutcome] ?? "outline";
}

/**
 * Map a per-dimension verdict `outcome` to a badge variant. Uses the same
 * green/amber/red ladder as the composed outcome, but a single-dimension
 * verdict only ever carries confirmed/surprise/failure/contradiction-style
 * tokens — anything unrecognized falls back to a neutral outline.
 */
export function dimensionOutcomeVariant(
  outcome?: string | null
): BadgeVariant {
  if (!outcome) return "outline";
  const o = outcome.toLowerCase();
  if (o === "confirmed") return "success";
  if (o === "surprise") return "warning";
  if (o === "partial") return "info";
  if (o === "failure" || o === "contradiction") return "destructive";
  return "outline";
}

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

function shortSha(sha?: string | null): string {
  if (!sha) return "—";
  return sha.length > 8 ? sha.slice(0, 8) : sha;
}

function formatTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ---- Cross-repo verdict panel ---------------------------------------------
//
// When a recent land carries a `correlation_id`, its cascade may have fanned
// out to sibling repos. The composed restack-verification verdict lives on
// coord at `/coord/restacks/verifications`; the web backend proxies it at
// `${API}/lands/verifications?correlation_id=…`. This panel fetches that ONCE
// on first expand (LandCard is otherwise presentational), using the same
// `httpClient.get` pattern the lands page uses.

const API = "/api/v1/operations";

// Wire shapes mirror coord's `/coord/restacks/verifications` response
// (snake_case). Rendered defensively — `worst_drift_class` / `d3_outcome` /
// `verified_at` are null until a repo is verified.
export interface RepoVerification {
  repo: string;
  signature_id?: string | null;
  worst_drift_class?: string | null;
  d3_outcome?: string | null;
  verified_at?: string | null;
  edge_verdicts?: unknown[] | null;
}

export interface ComposedVerification {
  worst_drift_class?: string | null;
  repo_count?: number | null;
  verified_count?: number | null;
}

export interface CrossRepoVerifications {
  correlation_id?: string | null;
  repos?: RepoVerification[] | null;
  composed?: ComposedVerification | null;
}

function CrossRepoVerdictPanel({ correlationId }: { correlationId: string }) {
  const [data, setData] = useState<CrossRepoVerifications | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch ONCE on mount — the panel only mounts when the operator expands it,
  // and unmounts/remounts on re-expand (acceptable: a fresh verdict each time).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ correlation_id: correlationId });
        const body = await httpClient.get<CrossRepoVerifications>(
          `${API}/lands/verifications?${qs.toString()}`
        );
        if (!cancelled) setData(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [correlationId]);

  const composed = data?.composed ?? null;
  const repos = data?.repos ?? [];

  return (
    <div
      className="rounded border border-border bg-muted/30 p-2.5 space-y-2 text-xs"
      data-testid="coord-land-crossrepo-panel"
    >
      {loading && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Loading cross-repo verdict…
        </span>
      )}
      {error && (
        <span
          className="text-muted-foreground italic"
          data-testid="coord-land-crossrepo-error"
        >
          Cross-repo verdict unavailable: {error}
        </span>
      )}
      {!loading && !error && data && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-muted-foreground">
              composed drift:
            </span>
            <Badge
              variant={driftClassVariant(composed?.worst_drift_class)}
              className="text-[10px]"
              data-testid="coord-land-crossrepo-composed-badge"
            >
              {composed?.worst_drift_class ?? "unknown"}
            </Badge>
            <span className="text-muted-foreground tabular-nums">
              {composed?.verified_count ?? 0}/{composed?.repo_count ?? 0} verified
            </span>
          </div>
          {repos.length > 0 ? (
            <div className="space-y-1">
              {repos.map((r, i) => (
                <div
                  key={`${r.repo}-${i}`}
                  className="flex items-center gap-2 flex-wrap"
                  data-testid="coord-land-crossrepo-repo-row"
                >
                  <span className="font-mono">{r.repo}</span>
                  {r.worst_drift_class ? (
                    <Badge
                      variant={driftClassVariant(r.worst_drift_class)}
                      className="text-[10px]"
                    >
                      {r.worst_drift_class}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] italic">
                      unverified
                    </Badge>
                  )}
                  {r.d3_outcome && (
                    <span className="text-muted-foreground">{r.d3_outcome}</span>
                  )}
                  {r.verified_at && (
                    <span className="ml-auto text-muted-foreground">
                      {formatTime(r.verified_at)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground italic">
              No sibling repos in this correlation.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ---- Card -----------------------------------------------------------------

export function LandCard({ row }: { row: LandRow }) {
  const { signature: sig, verification: ver } = row;
  const action = (sig.action ?? "land") as string;
  const verdicts = ver?.dimension_verdicts ?? [];
  const correlationId = sig.correlation_id ?? null;
  const [crossRepoOpen, setCrossRepoOpen] = useState(false);

  return (
    <Card data-testid="coord-land-card">
      <CardContent className="p-4 space-y-2.5">
        {/* Header line: action + repo#pr / branch + outcome badge */}
        <div className="flex items-start gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 font-medium">
            {action === "push" ? (
              <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <Anchor className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <Badge variant="outline" className="uppercase text-[10px]">
              {action}
            </Badge>
          </span>
          {sig.repo && (
            <span className="font-mono text-sm">
              {sig.repo}
              {typeof sig.pr_number === "number" && (
                <span className="inline-flex items-center gap-0.5 ml-1 text-muted-foreground">
                  <GitPullRequest className="h-3 w-3" />#{sig.pr_number}
                </span>
              )}
            </span>
          )}
          {sig.branch && (
            <span className="font-mono text-xs text-muted-foreground">
              {sig.branch}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {correlationId && (
              <Badge
                variant="outline"
                className="font-mono text-[10px] inline-flex items-center gap-1 cursor-pointer select-none"
                role="button"
                tabIndex={0}
                aria-expanded={crossRepoOpen}
                onClick={() => setCrossRepoOpen((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setCrossRepoOpen((v) => !v);
                  }
                }}
                data-testid="coord-land-crossrepo-badge"
              >
                <Network className="h-3 w-3" />
                cross-repo
              </Badge>
            )}
            {ver ? (
              <>
                <Badge
                  variant={composedOutcomeVariant(ver.composed_outcome)}
                  data-testid="coord-land-outcome-badge"
                >
                  {ver.composed_outcome ?? "pending"}
                </Badge>
                <Badge
                  variant={ver.settled ? "secondary" : "outline"}
                  className="text-[10px]"
                  data-testid="coord-land-settled-badge"
                >
                  {ver.settled ? "settled" : "open"}
                </Badge>
              </>
            ) : (
              <Badge
                variant="outline"
                className="inline-flex items-center gap-1"
                data-testid="coord-land-unverified-badge"
              >
                <ShieldQuestion className="h-3 w-3" />
                declared, not yet verified
              </Badge>
            )}
          </div>
        </div>

        {/* SHA + strategy line */}
        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground font-mono">
          <span>
            {shortSha(sig.from_sha)} → {shortSha(sig.to_sha)}
          </span>
          {sig.merge_strategy && (
            <Badge variant="outline" className="text-[10px]">
              {sig.merge_strategy}
            </Badge>
          )}
          {sig.created_at && (
            <span className="ml-auto">{formatTime(sig.created_at)}</span>
          )}
        </div>

        {/* Per-dimension verdict row */}
        {ver && verdicts.length > 0 && (
          <div
            className="flex flex-wrap gap-1.5 pt-1"
            data-testid="coord-land-verdicts"
          >
            {verdicts.map((v, i) => (
              <span
                key={`${v.dimension}-${i}`}
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]"
                title={v.detail ?? undefined}
                data-testid="coord-land-verdict-chip"
              >
                <span className="font-medium uppercase text-muted-foreground">
                  {v.dimension}
                </span>
                {v.drift_class && (
                  <span className="text-muted-foreground">{v.drift_class}</span>
                )}
                <Badge
                  variant={dimensionOutcomeVariant(v.outcome)}
                  className="text-[10px] px-1 py-0"
                >
                  {v.outcome ?? "—"}
                </Badge>
              </span>
            ))}
          </div>
        )}

        {/* Coverage + rationale */}
        {ver && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {typeof ver.coverage === "number" && (
              <span data-testid="coord-land-coverage">
                coverage {Math.round(ver.coverage * 100)}%
                {typeof ver.dimensions_observed === "number" &&
                  typeof ver.dimensions_predicted === "number" && (
                    <>
                      {" "}
                      ({ver.dimensions_observed}/{ver.dimensions_predicted} dims)
                    </>
                  )}
              </span>
            )}
            {ver.rationale && (
              <span className="italic truncate">{ver.rationale}</span>
            )}
          </div>
        )}

        {/* Cross-repo verdict — lazily fetched on expand */}
        {correlationId && crossRepoOpen && (
          <CrossRepoVerdictPanel correlationId={correlationId} />
        )}
      </CardContent>
    </Card>
  );
}
