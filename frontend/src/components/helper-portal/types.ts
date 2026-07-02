/**
 * Local wire types for the helper-task portal (/help).
 *
 * qontinui-schemas no longer ships committed TS bindings, so the portal
 * keeps a small local mirror of the coord wire contract
 * (`qontinui-schemas/rust/src/helper_task.rs`, `rename_all = "camelCase"`;
 * enum string values are lowercase snake_case). Keep in sync with the Rust
 * source of truth.
 */

/** Kind of human-judgment task. Phase 1 ships `spot_check` only. */
export type HelperTaskKind =
  | "spot_check"
  | "compare"
  | "walk_through"
  | "describe"
  | "sort";

/** Lifecycle status of a helper task. */
export type HelperTaskStatus = "open" | "answered" | "expired" | "cancelled";

/** A verdict a helper may submit. */
export type HelperVerdict =
  | "approve"
  | "reject"
  | "not_sure"
  | "choice_a"
  | "choice_b"
  | "choice_same";

/** Kind-specific content shown to the helper. */
export interface HelperTaskPayload {
  /** SpotCheck: URL of the screenshot to review. */
  screenshotUrl?: string;
  /** Compare: the two screenshot URLs to put side by side (A, B). */
  compareUrls?: string[];
  /** WalkThrough: ordered guided steps. */
  steps?: string[];
  /** Sort: feature cards to group. */
  cards?: string[];
  /** Describe: reference to the live screen. */
  liveTarget?: string;
}

/** The answers a helper may give + the preset reason codes offered. */
export interface HelperAnswerSchema {
  verdicts: HelperVerdict[];
  /** Reason codes offered as tap-to-select chips on a reject. */
  presetReasons: string[];
  allowFreeText: boolean;
  allowNotSure: boolean;
}

/** Provenance linking a task back to what produced it. */
export interface HelperTaskSource {
  findingId?: string;
  pageId?: string;
  matchRate?: number;
}

/** A human-judgment micro-task emitted by a runner. */
export interface HelperTask {
  id: string;
  tenantId: string;
  appId: string;
  kind: HelperTaskKind;
  /** Human-readable question shown to the helper. */
  prompt: string;
  payload: HelperTaskPayload;
  answerSchema: HelperAnswerSchema;
  requiredVotes: number;
  status: HelperTaskStatus;
  source: HelperTaskSource;
  /** ISO 8601 (UTC). */
  createdAt: string;
  /** ISO 8601 (UTC); absent means the task does not expire. */
  expiresAt?: string;
}

/** One helper's recorded answer. */
export interface HelperAnswer {
  id: string;
  taskId: string;
  helperUserId: string;
  verdict: HelperVerdict;
  reasons: string[];
  freeText?: string | null;
  createdAt: string;
}

/** Body for `POST /api/v1/helper-tasks/{id}/answer`. */
export interface HelperAnswerRequest {
  verdict: HelperVerdict;
  reasons?: string[];
  free_text?: string | null;
}

/** `GET /api/v1/helper-tasks` — web-backend wrapper around coord's array. */
export interface HelperTasksResponse {
  tasks: HelperTask[];
  /** False when the coord queue is unavailable (not migrated / unreachable). */
  available: boolean;
}

/** `GET /api/v1/helper-tasks/status` — the caller's helper standing. */
export interface HelperStatusResponse {
  is_helper: boolean;
  is_helper_only: boolean;
}
