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
