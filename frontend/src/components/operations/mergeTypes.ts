// ============================================================================
// Merge-train wire types
// ============================================================================
//
// Mirrors the coord `GET /merge/queue` and `GET /merge/:id` response shapes
// defined in `qontinui-coord/src/merge.rs`. The web backend's
// `/api/v1/operations/merge/{queue,:id}` endpoints proxy these
// pass-through.

export type ProposalStatus =
  | "queued"
  | "dry-rebasing"
  | "awaiting-ci"
  | "landing"
  | "merged"
  | "conflict"
  | "blocked-by-overlap"
  | "cancelled";

export interface RepoDetail {
  repo: string;
  branch: string;
  head_sha: string;
  rebase_result?: unknown;
  ci_run_url?: string | null;
  overlap_paths?: string[] | null;
}

export interface ProposalDetail {
  proposal_id: string;
  agent_id: string;
  status: ProposalStatus;
  description?: string | null;
  requires_clean_ci: boolean;
  error?: string | null;
  created_at: string;
  updated_at: string;
  cancelled_at?: string | null;
  merged_at?: string | null;
  repos: RepoDetail[];
  /**
   * Number of times the leader-takeover recovery sweep blind-requeued this
   * proposal (coord PR #423, plan
   * `2026-06-07-merge-scheduler-takeover-requeue-starvation`). The durable
   * starvation signal: 0 = never churned; a rising value means takeover churn
   * is starving the proposal. Older coord deploys omit it — treat as 0.
   */
  requeue_count?: number;
}

export interface QueueResponse {
  proposals: ProposalDetail[];
}

// ============================================================================
// PR Merge Orchestrator Phase 1 D1.6 + D1.7 — PR Outer State wire types.
//
// Mirrors coord's `GET /pr-merge/prs` response (see
// `qontinui-coord/src/pr_merge.rs::PrRow` / `PrListResponse`). Joined to
// per-(repo, head_sha) lifecycle from `coord.pr_check_runs`. The MergeTrain
// dashboard renders this alongside the existing `coord.merge_proposals`
// stream so an operator sees BOTH the outer PR state (mergeable,
// mergeStateStatus, reviewDecision) AND the inner proposal lifecycle
// (queued -> dry-rebasing -> ... -> merged) in one card.
// ============================================================================

/** GitHub's PR-level merge state status -- values per the GraphQL enum. */
export type MergeStateStatus =
  | "CLEAN"
  | "DIRTY"
  | "UNSTABLE"
  | "BLOCKED"
  | "BEHIND"
  | "UNKNOWN"
  | "DRAFT"
  | string; // tolerate future enum additions

/** GitHub's reviewDecision enum (or null when no reviews required). */
export type ReviewDecision =
  | "APPROVED"
  | "REVIEW_REQUIRED"
  | "CHANGES_REQUESTED"
  | string;

export interface PrRow {
  repo: string;
  pr_number: number;
  branch: string;
  base_branch: string;
  head_sha: string;
  pr_state: "open" | "draft" | "closed" | "merged" | string;
  mergeable: boolean | null;
  merge_state_status: MergeStateStatus | null;
  review_decision: ReviewDecision | null;
  required_checks_satisfied: boolean | null;
  last_refreshed_at: string | null;
  last_predicate_eval_at: string | null;
  /** "pending" | "complete" -- matches pr_state::compute_lifecycle_and_conclusion. */
  ci_lifecycle: "pending" | "complete" | string | null;
  /** "success" | "failure" | null. */
  ci_conclusion: "success" | "failure" | string | null;
  /**
   * Names of COMPLETED non-passing check runs on the head sha (e.g.
   * `["security", "test (windows)"]`). Optional: omitted when empty AND
   * absent entirely on older coord deploys — every consumer must tolerate
   * absence and fall back to the aggregate `ci_lifecycle`/`ci_conclusion`.
   */
  failing_contexts?: string[];
  /**
   * Names of still-RUNNING check runs on the head sha. Same optionality
   * contract as `failing_contexts`.
   */
  pending_contexts?: string[];
  correlation_id: string | null;
  // ---- Recently-merged enrichment ------------------------------------------
  // Present only on the rows coord appends for `?include_merged=<hours>`
  // (`query_recently_merged_prs`). Every field is optional: a coord deploy
  // that predates the merged-row projection omits them entirely, and the
  // merged tab must degrade to "merge time unknown" rather than break.
  /** RFC3339 time the PR landed on its base branch (`repo_branches.merged_at`). */
  merged_at?: string | null;
  /** The commit that actually landed. Non-null is coord's land-path-independent
   *  "this PR merged" signal — a coord ff-land closes the PR with merged=false. */
  merge_commit_sha?: string | null;
  /** kebab-case deploy state ("has my merged PR deployed yet?"). */
  deploy_state?: string | null;
}

export interface PrListResponse {
  prs: PrRow[];
  total: number;
}

// ============================================================================
// Merge economics — CI-duration-aware severity inputs.
//
// Mirrors coord's NEW `coord_query_merge_economics` read (proxied by the web
// backend at `/api/v1/operations/pr-merge/merge-economics`). Per-repo merge
// timing/throughput the fleet page uses to decide whether a merge conflict is
// "act now" (RED) or "resolve just-before-merge" (AMBER): long candidate-CI
// DAMPENS conflict urgency, a shallow (near-front) queue AMPLIFIES it.
//
// EVERY field is optional. Coord may not have this read deployed yet, and even
// once it does older deploys can omit individual fields — every consumer MUST
// treat an absent field as "unknown" and fall back to the hardcoded thresholds
// / repo-name hint in prPipeline.ts. The page must render identically (just
// less precisely) with an empty `{}` economics map.
// ============================================================================

export interface MergeEconomics {
  /**
   * p90 of the repo's merge-candidate CI duration, in SECONDS. When present,
   * `prPipeline` treats the repo as long-CI iff `p90 * 1000 >=
   * LONG_CI_THRESHOLD_MS`. Absent ⇒ fall back to the static repo-name hint.
   */
  candidate_ci_p90_secs?: number | null;
  /** Observed lands per hour for the repo (throughput). Advisory/informational. */
  land_rate_per_hour?: number | null;
  /**
   * Coord's suggested "this is stuck" threshold in SECONDS (derived from the
   * repo's own timing). When present, `derivePipelineHealth` uses it as the
   * red CI-wait threshold (amber at half); absent ⇒ CI_WAIT_{AMBER,RED}_MS.
   */
  suggested_stuck_threshold_secs?: number | null;
  /**
   * Depth of the repo's land queue. A shallow queue means the merge train
   * reaches this repo's PRs soon, so a conflict here is near-front and stays
   * RED even on a long-CI repo. Absent ⇒ queue proximity defaults to
   * "not-front".
   */
  queue_depth?: number | null;
  /**
   * Per-open-PR "content is already on main" flag, keyed by PR number (as a
   * string). Surfaces the phantom-kill orphan wedge (content-on-main but the
   * PR is still open). Optional; absent ⇒ unknown.
   */
  already_landed?: Record<string, boolean> | null;
}

/**
 * Coord's `/pr-merge/merge-economics` response. The exact wire shape is coord's
 * to finalize; the frontend fetch tolerates all of: an object keyed by
 * `owner/name`, a `{ repos: {...} }` wrapper, or an array of
 * `{ repo, ...MergeEconomics }`. This declared type is the wrapper form; the
 * fetch normalizes every shape into a `Record<repo, MergeEconomics>`.
 */
export interface MergeEconomicsResponse {
  repos?: Record<string, MergeEconomics>;
}

// ============================================================================
// Per-PR check breakdown wire types.
//
// Mirrors coord's `GET /pr-state/:repo/:pr_number` response shapes
// (`qontinui-coord/src/pr_state.rs::PrStateResponse` / `CheckRunSummary`,
// lines 60-79), proxied by the web backend at
// `/operations/pr-merge/prs/{repo}/{pr_number}/checks`. Fetched on demand
// when an operator expands a failing pipeline row — never polled.
// ============================================================================

/** One check run on the PR's head sha (coord `pr_state.rs::CheckRunSummary`). */
export interface CheckRunSummary {
  name: string;
  /** `queued` | `in_progress` | `completed`. */
  status: string;
  /**
   * `success` | `failure` | `neutral` | `cancelled` | `timed_out` |
   * `action_required` | `skipped` | `stale`. Null while `status` is
   * non-terminal.
   */
  conclusion: string | null;
  /** RFC3339 completion time; null while the check is still running. */
  completed_at: string | null;
  /** Link to the run on GitHub; null when the provider sent none. */
  details_url: string | null;
}

/** Coord `pr_state.rs::PrStateResponse` — aggregate + per-check breakdown. */
export interface PrStateResponse {
  /** `"pending"` while any check still runs; `"complete"` when all terminal. */
  lifecycle: string;
  /** `"success"` / `"failure"` once complete; null while pending. */
  conclusion: string | null;
  checks: CheckRunSummary[];
}

// ============================================================================
// PR Merge Orchestrator Phase 8 D8.6 — Suggestions inbox wire types.
//
// Mirrors coord's `GET /pr-merge/suggestions` response (see
// `qontinui-coord/src/pr_merge/suggestions_routes.rs`). Drift suggestions
// (kind='profile_drift_suggestion') AND audit-stale alerts
// (kind='profile_audit_stale') ride the same card list. Per-card Accept
// / Reject / Mute-for-30-days buttons hit `POST /pr-merge/suggestions/:id/{accept,reject,mute}`.
// ============================================================================

export type SuggestionKind = "profile_drift_suggestion" | "profile_audit_stale";

/** One pending suggestion / audit-stale alert. The drift watcher's
 *  detail JSON exposes `suggestion_kind`, `subject`, `rationale`,
 *  `supporting_overrides`, and `proposed_diff`. */
export interface SuggestionRow {
  alert_id: number;
  kind: SuggestionKind;
  severity: "info" | "warning" | "critical";
  summary: string;
  detail: {
    tenant_id?: string;
    suggestion_kind?: string;
    subject?: string;
    rationale?: string;
    supporting_overrides?: string[];
    proposed_diff?: Record<string, unknown>;
    repo?: string;
    trigger?: string;
    since_last_audit_days?: number;
  };
  first_seen_at: string;
  last_seen_at: string;
}

export interface SuggestionListResponse {
  suggestions: SuggestionRow[];
  total: number;
}

// ============================================================================
// Coordination-transparency — Gate-decisions / blast-radius-block wire types.
//
// Plan 2026-06-07-coordination-transparency-surfaces.md T2. Mirrors coord's
// `GET /pr-merge/blast-radius-blocks` response (see
// `qontinui-coord/src/pr_merge/blast_radius_monitor.rs::BlocksResponse` /
// `BlastRadiusBlock`), proxied by the web backend's
// `/operations/pr-merge/blast-radius-blocks`. The MergeTrain "Gate decisions"
// section renders one row per held PR with the reason, the removed-export
// evidence (`referenced_by [{file,line}]`), and an honesty label.
//
// Honesty note (binding cross-cutting gate): coord's current
// `BlastRadiusBlock` surfaces the per-reason evidence but does NOT yet stamp
// `coverage`/`graph_available` onto the `pr_events.payload` it reads back, so
// those two fields are OPTIONAL here. The renderer treats their absence as
// "coverage not reported" (NOT as authoritative full coverage) — when the T1
// coord keystone starts persisting them, this surface lights up automatically.
// ============================================================================

/** One file:line that still imports the removed export. */
export interface ReferencedBy {
  file: string;
  line: number;
}

/** One blast-radius gate block — a held PR + reason + evidence. */
export interface BlastRadiusBlock {
  repo: string;
  pr_number: number;
  tenant_id: string;
  /** The exported symbol the PR removed (null when the reason carries none). */
  removed_export_name: string | null;
  /** The file the export was removed from. */
  file: string | null;
  /** `[{file, line}, ...]` — untouched files still importing the export. */
  referenced_by: ReferencedBy[];
  evaluation_latency_secs: number | null;
  /** `created_at` of the underlying `pr_events` row, RFC3339. */
  at: string;
  // ---- Honesty fields (OPTIONAL — see header note) --------------------
  /** Graph coverage `[0,1]`; `<1` ⇒ partial mirror. Absent ⇒ not reported. */
  coverage?: number | null;
  /** Whether a resolved code graph backed the decision. Absent ⇒ not reported. */
  graph_available?: boolean | null;
  /** Present iff the blast-radius tier ran; absent ⇒ "gate did not run". */
  block_reason_code?: string | null;
  /** Outer (PR-level) state coord routed this PR to (e.g. SPECIALIST_REVIEW). */
  outer_state?: string | null;
}

export interface BlastRadiusBlocksResponse {
  tenant_id: string;
  repo: string | null;
  /** Durable cross-replica total of blocks for this tenant (+repo filter). */
  total_blocks: number;
  returned: number;
  blocks: BlastRadiusBlock[];
}

// ----------------------------------------------------------------------------
// Demo-feature catalog
// ----------------------------------------------------------------------------
//
// The three deterministic features the agents ship during the demo's
// headline run. The names match the branches authored in
// `plans/2026-05-18-coordination-layer-demos-feature-{1,2,3}-*.md`.
// LandedFeaturesPanel uses this list to render the iframe stack
// regardless of arrival order.

export interface DemoFeature {
  /** Stable slug used in the route + branch name. */
  slug: string;
  /** Human-readable title shown in the iframe panel header. */
  title: string;
  /** Agent branch name prefix — used to match `events.merge.landed.<repo>` payloads. */
  branch: string;
  /** Public-facing URL the iframe loads when the feature lands. */
  url: string;
}

const DEMO_FRONTEND_URL =
  process.env.NEXT_PUBLIC_DEMO_FRONTEND_URL || "https://qontinui.io";

export const DEMO_FEATURES: ReadonlyArray<DemoFeature> = [
  {
    slug: "profile",
    title: "Profile",
    branch: "demo-feature-profile",
    url: `${DEMO_FRONTEND_URL}/demo/profile`,
  },
  {
    slug: "fleet-pulse",
    title: "Fleet Pulse",
    branch: "demo-feature-fleet-pulse",
    url: `${DEMO_FRONTEND_URL}/demo/fleet-pulse`,
  },
  {
    slug: "clock",
    title: "Clock",
    branch: "demo-feature-clock",
    url: `${DEMO_FRONTEND_URL}/demo/clock`,
  },
];
