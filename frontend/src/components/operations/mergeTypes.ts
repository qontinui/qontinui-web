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
  correlation_id: string | null;
}

export interface PrListResponse {
  prs: PrRow[];
  total: number;
}

// ============================================================================
// PR Merge Orchestrator Phase 6 D6.2 — Escalation surface wire types.
//
// Mirrors coord's `GET /pr-merge/escalations` response (see
// `qontinui-coord/src/pr_merge/escalations_routes.rs::EscalationRow` /
// `EscalationListResponse`). The MergeTrain "Escalations" section
// renders one card per row above the existing PR-outer-state +
// cross-repo-dependencies sections.
// ============================================================================

export type EscalationSeverity = "critical" | "warning" | "info" | string;

export type EscalationResolutionAction =
  | "approve_merge"
  | "reject"
  | "approve_with_modification"
  | "add_to_rulebook";

/** One row in the alternatives JSONB array — a button on the card. */
export interface EscalationAlternative {
  action: EscalationResolutionAction;
  label: string;
  /** Optional MERGE_DECISION-shaped modification (e.g. {merge_strategy: "rebase"}). */
  modification?: Record<string, unknown> | null;
}

export interface EscalationRow {
  alert_id: number;
  tenant_id: string;
  repo: string;
  pr_number: number;
  severity: EscalationSeverity;
  summary: string;
  /** Free-form payload from coord.alerts.detail (PR refs, system_reason, etc.). */
  detail: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  page_due_at: string | null;
  paged_at: string | null;
  resolved_at: string | null;
  resolution_action: string | null;
  resolution_by: string | null;
  /** Linked specialist merge_decisions.decision_id (null on system-injected rows). */
  decision_id: string | null;
  /** Specialist's free-form rationale, joined from coord.merge_decisions. */
  specialist_rationale: string | null;
  /** Specialist's rule_citations[], joined from coord.merge_decisions. */
  specialist_rule_citations: string[];
  /** Suggested action text from the sidecar. */
  suggested_action: string | null;
  /** Operator-targeted question if the specialist posed one. */
  operator_question: string | null;
  /** Structured alternatives — one per button on the card. */
  alternatives: EscalationAlternative[];
}

export interface EscalationListResponse {
  escalations: EscalationRow[];
  total: number;
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
  process.env.NEXT_PUBLIC_DEMO_FRONTEND_URL ||
  "https://demo.staging.qontinui.io";

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
