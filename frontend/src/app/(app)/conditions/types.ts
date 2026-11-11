/**
 * Condition Groups (regression tests) — shared types.
 *
 * A condition group is a regression test made of natural-language conditions
 * ("no duplicate menu items"). These mirror the backend proxy contract at
 * `/api/v1/conditions/*` (see the backend `conditions` router). The web
 * frontend authors + reads the same typed shapes; the backend owns persistence
 * and the on-demand / scheduled run execution.
 */

/**
 * Terminal status of the most recent run for a group (drives the status
 * badge). `running` is transient; a group that has never run reports no
 * status (`null`/absent) which the UI renders as "Never run". `unknown` means
 * the run produced no verdict that can be trusted (no report arrived, the
 * check never ran, or a condition got no verdict): it is never a pass.
 *
 * The wire is wider than this union: the backend proxy passes coord's status
 * through unchanged, so `StatusBadge` renders any other word as itself.
 */
export type ConditionStatus = "pass" | "fail" | "error" | "running" | "unknown";

/** How a run was triggered. */
export type ConditionRunTrigger = "manual" | "scheduled";

/**
 * Per-condition verdict inside a completed run. `unknown` means the condition
 * could not be judged; like any word outside this union, it is never a pass.
 */
export type ConditionVerdict = "pass" | "fail" | "unknown";

/**
 * Optional auth-setup blob stored on a group. Kept as a free-form JSON object
 * for v1 (the editor exposes it as a JSON textarea); the runner interprets a
 * `{ loginUrl, usernameSelector, passwordSelector, username, submitSelector }`
 * shape but any JSON object round-trips.
 */
export type ConditionAuthSetup = Record<string, unknown>;

/** A condition group as returned by `GET /groups` (list shape). */
export interface ConditionGroup {
  group_id: string;
  name: string;
  description?: string | null;
  target_url: string;
  /** null / absent = on demand only (no schedule). */
  schedule_interval_secs?: number | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: ConditionStatus | null;
  enabled: boolean;
  condition_count: number;
  auth_setup?: ConditionAuthSetup | null;
}

/** A single natural-language condition within a group. */
export interface Condition {
  condition_id: string;
  group_id: string;
  text: string;
  position: number;
  enabled: boolean;
}

/**
 * A group plus its ordered conditions, as returned by
 * `GET /groups/{group_id}`.
 */
export interface ConditionGroupDetail extends ConditionGroup {
  conditions: Condition[];
}

/** What the check agent observed for one condition, with an optional note. */
export interface ConditionEvidence {
  note?: string;
  observed: string;
}

/** One condition's outcome inside a completed run. */
export interface ConditionRunResult {
  /** `null` when the report did not name it: coord stores the id as optional. */
  condition_id: string | null;
  verdict: ConditionVerdict;
  /**
   * A plain string, or `{note, observed}`. `null` or absent when the agent
   * sent none (coord stores a report's evidence as optional).
   */
  evidence?: string | ConditionEvidence | null;
}

/**
 * How much of what a run was dispatched with got a verdict. Coord serves it
 * once it derives a run's status from coverage; older runs carry none.
 */
export interface ConditionRunCoverage {
  /** Conditions the run needs a verdict for. */
  expected: number;
  /** Conditions that got a verdict. */
  reported: number;
  /** Conditions whose verdict is unknown, the missing ones included. */
  unknown: number;
  /** Ids of the conditions that got no verdict at all. */
  missing?: string[];
}

/** A single execution of a group, as returned by the run endpoints. */
export interface ConditionRun {
  run_id: string;
  status: ConditionStatus;
  trigger: ConditionRunTrigger;
  started_at: string;
  finished_at?: string | null;
  results?: ConditionRunResult[] | null;
  summary?: string | null;
  device_id?: string | null;
  /** `null` while the run is still running. */
  coverage?: ConditionRunCoverage | null;
  /**
   * The status the check agent itself reported. Coord derives `status` from
   * the verdicts, so this is only ever a claim, and it can be any word.
   */
  claimed_status?: string | null;
  /** Why the run reads unknown: a code from the shared unknown-code set. */
  unknown_reason?: string | null;
  /** What ended the run there, e.g. `no_report_within_deadline`. */
  unknown_detail?: string | null;
  /** When the agent committed its check plan, before any verdict counted. */
  plan_committed_at?: string | null;
}

/** `POST /groups/{group_id}/run` response. */
export interface RunTriggerResponse {
  run_id: string;
  status: ConditionStatus;
}

/** `POST /groups` body. */
export interface ConditionGroupCreate {
  name: string;
  description?: string | null;
  target_url: string;
  auth_setup?: ConditionAuthSetup | null;
  schedule_interval_secs?: number | null;
  enabled?: boolean;
}

/** `PATCH /groups/{group_id}` body (partial). */
export interface ConditionGroupUpdate {
  name?: string;
  description?: string | null;
  target_url?: string;
  auth_setup?: ConditionAuthSetup | null;
  schedule_interval_secs?: number | null;
  enabled?: boolean;
}

/** `POST /groups/{group_id}/conditions` body. */
export interface ConditionCreate {
  text: string;
  position?: number;
}

/**
 * `PATCH /items/{condition_id}` body. Setting `group_id` MOVES the condition
 * to another group; setting `position` reorders it within its group.
 */
export interface ConditionUpdate {
  text?: string;
  position?: number;
  group_id?: string;
  enabled?: boolean;
}
