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
  | "cancelled"
  // Wave-6 speculative pipelining: candidate CI is running on a SPECULATIVE
  // tip stacked on an unlanded predecessor (`coord.speculative_chains`).
  | "speculative-ci"
  // `COORD_MERGE_DRY_LAND=1` — the scheduler completed every phase but parked
  // instead of pushing. Terminal, and NOT a landing.
  | "shadow-landed";

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
  /**
   * Typed "why isn't this merging" classification (kebab-case), computed by
   * coord's `classify_merge_status`. See {@link MergeStatusToken}.
   *
   * OPTIONAL by contract: coord only began emitting it on 2026-06-18
   * (`pr_merge: classify merge_status + blocking_summary on GET
   * /pr-merge/prs`), so a coord deploy predating that omits the field
   * entirely. Consumers MUST treat absence as "no verdict available" and fall
   * back to the raw signals (`ci_conclusion`, `merge_state_status`, …) rather
   * than rendering a wrong reason.
   */
  merge_status?: MergeStatusToken | string;
  /** Short human one-liner explaining {@link PrRow.merge_status}. Same
   *  optionality contract. */
  blocking_summary?: string;
  /**
   * Status of the latest non-cancelled `merge_proposal` linked to this PR via
   * `coord.merge_proposal_repos (repo, head_sha)`. Same optionality contract;
   * also absent whenever no proposal was ever cut at this head.
   */
  proposal_status?: ProposalStatus | string | null;
  /** Age in seconds of that latest proposal, at coord's query time. */
  proposal_age_secs?: number | null;
  /**
   * Seconds this PR has been stuck in conflict on its CURRENT head — coord's
   * strand clock (`MIN(created_at)` over the head's `conflict` proposals).
   *
   * NOT interchangeable with a proposal age: coord re-proposes a conflicting PR
   * indefinitely, so the latest proposal is always minutes old and reports
   * minutes for a PR stranded for weeks. This is the only field that can tell
   * a fresh conflict from a strand.
   *
   * Optional: absent on coord deploys predating the projection, and absent on
   * any PR with no conflict proposals on its head. Consumers MUST treat absence
   * as "no evidence" and never as "not stranded".
   */
  conflict_age_secs?: number | null;
  /**
   * Seconds since coord last observed GitHub activity on this PR — the
   * universal staleness clock (coord-side floor over `coord.pr_events`
   * ingest/review rows, so a comment or review resets it; coord-authored
   * notices do not).
   *
   * Optional: absent on coord deploys predating the projection, and absent on
   * any PR with no recorded events (activity predating coord's webhook
   * subscription, or lost webhooks). Consumers MUST treat absence as "no
   * evidence" — never as fresh, and never as stale.
   */
  last_activity_secs?: number | null;
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
  /**
   * How the PR closed (`repo_branches.close_cause`). `commits_landed_via_other_pr`
   * is a coord rebase fast-forward land — GitHub shows the PR **Closed, not
   * Merged**, though its commits are on the base branch; `merged` is a normal
   * GitHub merge. Lets the detail view explain the closed-not-merged appearance
   * instead of guessing from pr_state (coord stamps that `merged` for both).
   * Absent on coord deploys predating the projection — treat absence as
   * "unknown", never assert the ff-land caveat without it.
   */
  close_cause?: string | null;
  /** kebab-case deploy state ("has my merged PR deployed yet?"). */
  deploy_state?: string | null;
}

export interface PrListResponse {
  prs: PrRow[];
  total: number;
  /**
   * How many PRs landed inside the `?merged_count_hours=` window — the count
   * alone, without the expensive per-PR deploy classification `include_merged`
   * pays for. Absent when we didn't ask, and also when coord's count failed or
   * the deploy predates the param: absent means UNKNOWN, never zero.
   */
  merged_recent_count?: number | null;
}

/**
 * coord's `classify_merge_status` verdict tokens, in the classifier's own
 * precedence order (first match wins). Kept as a union for exhaustive
 * rendering, but every consumer must tolerate an unknown string — coord may
 * add a token before the frontend knows about it.
 */
export type MergeStatusToken =
  | "draft"
  | "ci-failed"
  | "ci-pending"
  | "conflicts"
  | "behind-base"
  | "review-required"
  | "blast-radius-block"
  | "ready"
  | "queued"
  /** Green + CLEAN + open, but no fresh proposal — the orchestrator is
   *  stalled. The single highest-signal token for "why the pause". */
  | "ready-but-unlanded"
  | "unknown";

// ============================================================================
// Merge-train health — `GET /api/v1/operations/pr-merge/health`
//
// Mirrors coord's `GET /pr-merge/health` (`src/pr_merge/ops_routes.rs::
// assemble_health`). EVERY field is optional: the web proxy degrades a 404 /
// coord outage to `{}`, so the Train tab must render from an empty object.
// ============================================================================

/** The live `coord.leader_lease` row (scope `global`). */
export interface TrainLeader {
  holder_id?: string;
  fenced_token?: number;
  acquired_at?: string | null;
  heartbeat_at?: string | null;
  heartbeat_age_seconds?: number | null;
  /**
   * Heartbeat younger than the election TTL. `false` means leadership is
   * genuinely lapsing — which stalls EVERY repo at once, so it outranks any
   * per-repo reason. `null`/absent = coord could not compute it.
   */
  lease_fresh?: boolean | null;
}

/**
 * A PR coord judges ready (CLEAN + terminal-complete checks + required
 * satisfied + no blocking label) that is nonetheless unmerged.
 */
export interface ReadyUnmergedPr {
  repo: string;
  pr_number: number;
  /** Readiness-onset timestamp; `null` when no check row carried one. */
  ready_since?: string | null;
  /** Seconds since readiness onset. This is the pause clock PER PR. */
  age_seconds?: number | null;
  /** `status` of the latest proposal at this PR's CURRENT head (so it
   *  self-clears on force-push). Absent when none was ever cut. */
  latest_proposal_status?: string;
  /**
   * That proposal's `error` text — the WHY behind a green-but-unlanded PR.
   *
   * SECURITY: coord's `set_error` embeds the failing git command verbatim,
   * including the `https://x-access-token:<token>@github.com/...` clone URL.
   * NEVER render this raw — pass it through {@link redactSecrets} first.
   */
  latest_proposal_error?: string;
}

/**
 * Per-repo view of coord's **per-repo in-flight fairness cap**
 * (`COORD_MERGE_PER_REPO_CAP`, default 2).
 *
 * This cap is why "free slots + a green PR + nothing happening" is possible: a
 * repo already holding `per_repo_cap` in-flight proposals is SKIPPED by the
 * dequeue even when a global slot is free. It was added by the 2026-07-04
 * awaiting-ci churn fix, after six qontinui-runner proposals held the whole
 * queue while other repos' green PRs starved.
 */
export interface RepoSlotSaturation {
  repo: string;
  /** Proposals in `dry-rebasing` / `awaiting-ci` / `landing` for this repo. */
  in_flight: number;
  queued: number;
  /** `in_flight >= per_repo_cap` — the dequeue skips this repo's next proposal. */
  at_repo_cap: boolean;
  oldest_queued_wait_seconds?: number | null;
}

/**
 * Merge-slot saturation — "is the train paused because it has no room?".
 *
 * Every field is DB+env derived by coord, so it is identical from any replica.
 * `occupied` is a status count, NOT a reading of the leader's semaphore (the
 * two disagree briefly around each status transition) — do not present it as
 * one.
 */
export interface SlotSaturation {
  /** `COORD_MERGE_SLOTS` as configured. */
  configured_cap: number;
  /** The cap actually applied — clamped to online CI runners when `dynamic`,
   *  and 0 when none are online, which halts dispatch entirely. */
  effective_cap: number;
  dynamic: boolean;
  /** Online (idle+busy) CI runners; `null` when the cap is static. */
  online_ci_runners?: number | null;
  occupied: number;
  available: number;
  saturated: boolean;
  queued_depth: number;
  /** Seconds the oldest queued proposal has waited for a slot. The number that
   *  separates a throughput ceiling from a healthy train at full rate. */
  oldest_queued_wait_seconds?: number | null;
  per_repo_cap: number;
  repos?: RepoSlotSaturation[];
  repos_at_cap?: string[];
  /**
   * coord's own one-sentence interpretation, absent when there is no slot
   * pressure. Provided for non-dashboard consumers (the merge-train steward,
   * agents curling `/pr-merge/health`); this dashboard renders its own richer
   * banner from the structured fields and deliberately ignores it, so the two
   * can be worded for their different audiences.
   */
  headline?: string;
}

export interface TrainHealth {
  leader?: TrainLeader | null;
  /** Merge-slot saturation. `null`/absent on a coord deploy predating the
   *  observer, or when its read failed — never treat absence as "not
   *  saturated". */
  slots?: SlotSaturation | null;
  /** GREATEST(last proposal land, last observed MERGED transition). The
   *  fleet-wide pause clock. */
  last_merged_at?: string | null;
  /** Fleet-wide max `repo_branches.last_predicate_eval_at`. Advancing while
   *  `last_merged_at` is frozen = the train is suppressed, not idle. */
  last_predicate_eval_at?: string | null;
  /** False = coord has no GitHub app client, so stale `pr_state` is NEVER
   *  corrected and every verdict below is suspect. */
  hydration_enabled?: boolean;
  pr_state_stale_backlog?: number;
  reconcile_interval_seconds?: number;
  freshness_ttl_seconds?: number;
  ready_unmerged?: {
    count?: number;
    max_age_seconds?: number | null;
    prs?: ReadyUnmergedPr[];
  } | null;
  /** coord issue #776 — repos frozen in `rollout_state=dry_run` merge nothing
   *  while still evaluating, producing an otherwise silent freeze. */
  dry_run?: {
    would_merge_blocked_by_dry_run?: number;
    repos?: string[];
  } | null;
  generated_at?: string;
}

/**
 * The shared response body of coord's two merge-enablement mutations —
 * `POST /pr-merge/merge-enabled` (pin/clear) and `POST /pr-merge/kill-switch`
 * (the emergency pause). They deliberately return the SAME shape, so a caller
 * reports the outcome identically whichever door it used.
 *
 * `previous_merge_enabled` / `merge_enabled` are the RESOLVED booleans before
 * and after the write; `null` means "not pinned at this scope" (inheriting).
 * `affected_repos` is every repo the write reaches — one entry for a repo
 * scope, the tenant's whole fleet for a tenant scope, which is what makes the
 * blast radius legible in the confirmation UI.
 */
export interface MergeEnabledResponse {
  scope: string;
  previous_merge_enabled: boolean | null;
  merge_enabled: boolean | null;
  affected_repos: string[];
}

/**
 * Strip credentials out of coord-authored error text before it reaches the DOM.
 *
 * coord's merge scheduler stores the failing git command verbatim in
 * `merge_proposals.error`, which means a clone failure persists a live
 * installation token:
 *
 *     git clone https://x-access-token:gho_XXXX@github.com/o/r.git -> … failed
 *
 * That string is served by BOTH `/merge/queue` (`error`) and `/pr-merge/health`
 * (`ready_unmerged[].latest_proposal_error`), so any surface rendering merge
 * errors leaks it to every operator with dashboard access — and into browser
 * history, screenshots, and bug reports. Verified present in live coord data
 * on 2026-07-25.
 *
 * This is a display-side mitigation only; the durable fix is coord redacting
 * before it writes the column (it already has a `redact_token` helper for the
 * git-door push path).
 */
export function redactSecrets(text: string): string;
export function redactSecrets(
  text: string | null | undefined
): string | null | undefined;
export function redactSecrets(
  text: string | null | undefined
): string | null | undefined {
  if (!text) return text;
  return (
    text
      // Userinfo in any URL, WITH a colon: https://user:secret@host
      .replace(
        /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
        (_m, scheme: string) => `${scheme}***:***@`
      )
      // ...and WITHOUT one: https://<token>@host — the other standard git
      // credential URL form. Omitting it let any non-`gh*_`-prefixed token
      // (a 40-hex classic PAT, say) through untouched.
      .replace(
        /(https?:\/\/)[^/\s:@]+@/gi,
        (_m, scheme: string) => `${scheme}***@`
      )
      // Bare GitHub tokens (ghp_/gho_/ghu_/ghs_/ghr_ + github_pat_) anywhere
      // else in the text — e.g. an error that quotes a header, not a URL.
      .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "gh*_***")
      .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_***")
      // Authorization headers. coord's git-door push path carries an agent JWT
      // via `git -c http.extraHeader='Authorization: Bearer …'`, and that whole
      // command lands in the error text verbatim.
      //
      // Each rule is ANCHORED to a credential-bearing shape. An unanchored
      // `(Bearer|Basic|token)\s+\S{12,}` mangles ordinary prose — coord emits
      // "token authentication failed for user bob" and "basic reachability
      // check failed", both of which became "*** " noise. This is redaction,
      // not truncation: the diagnostic text has to survive.
      .replace(
        /\b(Authorization\s*:\s*)(Bearer|Basic|token)(\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
        "$1$2$3***"
      )
      // A bare `Bearer <credential>` — "Bearer" followed by a 20+ char opaque
      // blob is not a phrase that occurs in error prose.
      .replace(/\bBearer(\s+)[A-Za-z0-9._~+/=-]{20,}/g, "Bearer$1***")
      // `token=…`, `token: …`, `--token …` — flag/assignment shapes only.
      // Anchored on start-or-whitespace rather than `\b`: a leading `-` is a
      // non-word character, so `\b--token` never matches at all.
      .replace(
        /(^|[\s'"([])(--?token[=\s]+|token\s*[=:]\s*)[A-Za-z0-9._~+/=-]{12,}/gi,
        "$1$2***"
      )
  );
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
