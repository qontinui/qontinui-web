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
 * status (`null`/absent) which the UI renders as "Never run".
 */
export type ConditionStatus = "pass" | "fail" | "error" | "running";

/** How a run was triggered. */
export type ConditionRunTrigger = "manual" | "scheduled";

/** Per-condition verdict inside a completed run. */
export type ConditionVerdict = "pass" | "fail";

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

/** One condition's outcome inside a completed run. */
export interface ConditionRunResult {
  condition_id: string;
  verdict: ConditionVerdict;
  evidence: string;
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
