/**
 * Wire types for the Plan & Prompt Library operator page.
 *
 * Mirrors `backend/app/schemas/plan_library.py` and the two fleet-policy
 * models in `backend/app/api/v1/endpoints/operations.py`. Hand-written rather
 * than generated, matching the sibling `prompt-documents/types.ts` — the
 * generated client covers a different slice of the API surface.
 *
 * Three of these types encode a distinction the page must never collapse:
 *
 * * `CoordLinkState` separates a work unit that is genuinely absent
 *   (`dangling` — the soft link has no FK and MAY dangle, which is normal)
 *   from one we could not ask about (`unavailable`).
 * * `CoordPrState` does the same for PR citations. `unavailable` means coord
 *   exposes no HTTP citation-list route today (it is MCP-only), so the empty
 *   list is "we could not ask", NOT "there are no PRs".
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

export type CoordLinkState =
  | "linked"
  | "dangling"
  | "unavailable"
  | "unlinked";

export type CoordPrState = "available" | "unavailable" | "unlinked";

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
  id: string;
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
}

export interface PlanCandidateResponse {
  items: PlanCandidate[];
  total: number;
  offset: number;
  limit: number;
  ordering: "oldest_vetted_first";
  coord_available: boolean;
}

// ───────────────────────────── fleet policy ─────────────────────────────

/** The domain the capture toggle writes. Levels: `off` | `record`. */
export const PLAN_CAPTURE_DOMAIN = "plan_capture";

export const PLAN_CAPTURE_LEVELS = ["off", "record"] as const;
export type PlanCaptureLevel = (typeof PLAN_CAPTURE_LEVELS)[number];

export interface FleetPolicyView {
  domain: string;
  /** What devices ACTUALLY resolve — not necessarily what was last written. */
  effective_level: string;
  master_enabled: boolean;
  /** `"repo" | "tenant" | "system"`, or `"none"` when NO row matched. */
  resolved_scope: string;
  /**
   * Whether the caller may write, computed with the SAME effective-tenant rule
   * the PUT is gated on — not coord's cross-tenant `is_admin` union.
   */
  can_edit: boolean;
  /**
   * Control blocks coord returned that this view does not carry. Named rather
   * than silently dropped, so a reader who wonders where `controls` went gets
   * an answer.
   */
  keys_not_shown: string[];
  /**
   * `"fleet_resources_row"` — those blocks are a DIFFERENT domain's data and
   * must never be read as this domain's. `"this_domain"` — the caller asked
   * about `fleet_resources` itself. `null` — coord sent none.
   */
  keys_not_shown_source: "fleet_resources_row" | "this_domain" | null;
}

export interface FleetPolicyWriteResult {
  ok: boolean;
  domain: string;
  written_level: string | null;
  written_master_enabled: boolean | null;
  versioned: boolean | null;
  version: number | null;
  updated_by: string | null;
  /** A SECOND, fresh read. `null` + `readback_error` = UNKNOWN, not "applied". */
  effective: FleetPolicyView | null;
  readback_error: string | null;
}
