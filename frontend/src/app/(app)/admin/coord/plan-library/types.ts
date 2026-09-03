/**
 * Wire types for the Plan & Prompt Library operator page.
 *
 * Mirrors `backend/app/schemas/plan_library.py` and the two fleet-policy
 * models in `backend/app/api/v1/endpoints/operations.py`. Hand-written rather
 * than generated, matching the sibling `prompt-documents/types.ts` — the
 * generated client covers a different slice of the API surface.
 *
 * Four of these encode a distinction the page must never collapse:
 *
 * * `CoordLinkState` separates a work unit that is genuinely absent
 *   (`dangling` — the soft link has no FK and MAY dangle, which is normal)
 *   from one we could not ask about (`unavailable`).
 * * `CoordPrState` does the same for PR citations. `unavailable` means the
 *   citation read did not happen — coord unreachable, the door refused, or
 *   coord itself reported it could not read the relation — so the empty list
 *   is "we could not ask", NOT "there are no PRs". (It no longer means "coord
 *   has no HTTP route for this": coord ships both citation GET doors and the
 *   backend reads them.)
 * * `CandidateLinkedPr.state` carries that SAME distinction one level down, on
 *   ONE row's merged state: `unknown` is what a `merged: false` becomes while
 *   coord's merged predicate runs degraded, and it must not be rendered as the
 *   fact "unmerged".
 * * `FleetPolicyView.resolved_scope` separates "off because nobody wrote a
 *   row" (`none`) from "off because someone turned it off".
 */

// ───────────────────────────── artifacts ─────────────────────────────

export const WORK_ARTIFACT_KINDS = [
  "investigation_prompt",
  "plan_authoring_prompt",
  "implementation_prompt",
  "investigation_report",
  "handoff",
  "plan",
] as const;

export type WorkArtifactKind = (typeof WORK_ARTIFACT_KINDS)[number];

export const KIND_LABELS: Record<WorkArtifactKind, string> = {
  investigation_prompt: "Investigation prompt",
  plan_authoring_prompt: "Plan-authoring prompt",
  implementation_prompt: "Implementation prompt",
  investigation_report: "Investigation report",
  handoff: "Handoff",
  plan: "Plan",
};

/** Render an unrecognised kind as itself rather than as blank. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as WorkArtifactKind] ?? kind;
}

export const CAPTURE_DOORS = ["runner_scan", "agent", "operator"] as const;
export type CaptureDoor = (typeof CAPTURE_DOORS)[number];

export const CAPTURE_DOOR_LABELS: Record<CaptureDoor, string> = {
  runner_scan: "Runner scan",
  agent: "Agent write door",
  operator: "Operator",
};

export type WorkArtifactRelation =
  | "produced_report"
  | "feeds"
  | "authored_plan"
  | "supersedes"
  | "depends_on";

export interface WorkArtifactSummary {
  id: string;
  organization_id: string | null;
  created_by_user_id: string | null;
  kind: string;
  /** `true` when a human/agent asserted the kind and re-scans may not move it. */
  kind_locked: boolean;
  slug: string;
  title: string;
  /** Opaque free text mirroring plan front-matter. No vocabulary. */
  status: string;
  content_sha256: string;
  source_path: string | null;
  source_repo: string | null;
  /** Soft link to a coord work unit. No FK — it MAY dangle. */
  work_unit_slug: string | null;
  repos: string[];
  authored_at: string | null;
  captured_by: string;
  current_version: number;
  created_at: string;
  updated_at: string;
}

export interface WorkArtifactVersion {
  id: string;
  document_id: string;
  version_number: number;
  body: string;
  content_sha256: string;
  change_description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface WorkArtifactEdge {
  id: string;
  from_id: string;
  to_id: string;
  relation: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  /** Direction relative to the artifact being viewed. */
  direction: "outgoing" | "incoming";
  peer_kind: string | null;
  peer_slug: string | null;
  peer_title: string | null;
}

export interface WorkArtifactDetail extends WorkArtifactSummary {
  body: string;
  versions: WorkArtifactVersion[];
  edges: WorkArtifactEdge[];
  /**
   * The linked coord work unit and its PR citations. ALWAYS present — it
   * defaults to `work_unit_state: "unlinked"` — so a consumer never has to
   * distinguish "the field is missing" from "there is no link".
   */
  coord: CandidateCoordLink;
}

export interface WorkArtifactListResponse {
  items: WorkArtifactSummary[];
  /** This page's length (`items.length`); `total` is the unpaged total. */
  count: number;
  total: number;
  offset: number;
  limit: number;
}

// ───────────────────────────── divergence ─────────────────────────────

export interface DivergentVariant {
  id: string;
  kind: string;
  kind_locked: boolean;
  content_sha256: string;
  source_repo: string | null;
  source_path: string | null;
  title: string;
  status: string;
  current_version: number;
  updated_at: string;
}

/** Same `(kind, slug)`, different content digest. */
export interface DivergentGroup {
  kind: string;
  slug: string;
  variant_count: number;
  variants: DivergentVariant[];
}

/**
 * Same `(slug, source_repo)`, DIFFERENT kind — a fork whose whole
 * distinguishing feature is the kind, which grouping by `(kind, slug)`
 * structurally cannot see.
 *
 * `resolvable: false` means no single corrected (`kind_locked`) row exists to
 * prefer, so the scanner refuses to pick and an operator must correct one.
 */
export interface KindForkGroup {
  slug: string;
  source_repo: string | null;
  kinds: string[];
  variant_count: number;
  resolvable: boolean;
  variants: DivergentVariant[];
}

export interface DivergentResponse {
  groups: DivergentGroup[];
  total: number;
  kind_forks: KindForkGroup[];
  kind_fork_total: number;
}

// ─────────────────────────── capture health ───────────────────────────

export interface CaptureDoorHealth {
  captured_by: string;
  count: number;
  /** `false` = a door value this build does not recognise. Shown, not hidden. */
  known: boolean;
  first_at: string | null;
  /**
   * `max(updated_at)` — LAST TOUCHED, not last captured. A kind correction
   * bumps it without any capture having happened, so the UI must not label it
   * "last write".
   */
  last_touched_at: string | null;
}

export interface CaptureHealthResponse {
  total: number;
  doors: CaptureDoorHealth[];
}

// ──────────────────── coord link (candidates read) ────────────────────

export type CoordLinkState = "linked" | "dangling" | "unavailable" | "unlinked";

export type CoordPrState = "available" | "unavailable" | "unlinked";

/**
 * Whether a candidate has a plan DOCUMENT, and where.
 *
 * `/candidates` selects from the UNION of both corpus layers, so a row may
 * exist only as a coord work unit. `present` is an `agent.work_artifacts` row
 * (and the only state with an `id` to fetch a body with); `unsynced` is a plan
 * FILE coord recorded a `source_path` for whose body was never synced;
 * `absent` is a work unit with no document anywhere.
 */
export type DocumentState = "present" | "unsynced" | "absent";

/**
 * Whether the union's work-unit arm was read at all.
 *
 * `unavailable` means `total` counts the document layer only — UNKNOWN,
 * never "coord has no work units". Distinct from `coord_available`, which
 * reports the page-wide circuit: a 4xx on the population door is coord
 * ANSWERING and leaves that flag true.
 */
export type WorkUnitPopulationState = "included" | "unavailable";

export interface CandidateLinkedPr {
  repo: string | null;
  pr_number: number | null;
  state: "merged" | "unmerged" | "unknown";
  merged: boolean | null;
  branch: string | null;
  cited_at: string | null;
  sources: string[];
}

export interface CandidateCoordLink {
  work_unit_slug: string | null;
  work_unit_state: CoordLinkState;
  work_unit_status: string | null;
  work_unit_title: string | null;
  linked_prs_state: CoordPrState;
  linked_prs: CandidateLinkedPr[];
  unavailable_reason: string | null;
}

export interface PlanCandidate {
  /** `null` for a candidate that exists only as a coord work unit. */
  id: string | null;
  kind: string;
  kind_locked: boolean;
  slug: string;
  title: string;
  status: string;
  repos: string[];
  source_repo: string | null;
  source_path: string | null;
  work_unit_slug: string | null;
  authored_at: string | null;
  created_at: string;
  last_touched: string;
  age_days: number;
  unmet_depends_on: Array<{
    id: string;
    kind: string;
    slug: string;
    title: string;
    status: string;
  }>;
  prompt_chain: Array<{
    id: string;
    kind: string;
    slug: string;
    title: string;
    relation: string;
    depth: number;
  }>;
  coord: CandidateCoordLink;
  document_state: DocumentState;
}

export interface PlanCandidateResponse {
  items: PlanCandidate[];
  /** This page's length (`items.length`); `total` is the unpaged total. */
  count: number;
  total: number;
  offset: number;
  limit: number;
  ordering: "oldest_vetted_first";
  coord_available: boolean;
  work_unit_population_state: WorkUnitPopulationState;
  work_unit_population_reason: string | null;
}

// ───────────────────────────── fleet policy ─────────────────────────────

/** The domain the capture toggle writes. Levels: `off` | `record`. */
export const PLAN_CAPTURE_DOMAIN = "plan_capture";

export const PLAN_CAPTURE_LEVELS = ["off", "record"] as const;
export type PlanCaptureLevel = (typeof PLAN_CAPTURE_LEVELS)[number];

// `FleetPolicyView` / `FleetPolicyWriteResult` moved to the shared module when
// the `policy_write` dial became a second consumer — one wire contract, one
// definition. Re-exported here so this file's public surface is unchanged.
export type {
  FleetPolicyView,
  FleetPolicyWriteResult,
} from "../_shared/fleetPolicy";
