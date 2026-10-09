/**
 * Wire types for /admin/coord/unfinished.
 *
 * Mirrors `UnfinishedSessionsView` and the tenant resume-flag models in
 * `backend/app/api/v1/endpoints/operations/__init__.py`, which in turn project
 * coord's `GET /coord/sessions/unfinished` (qontinui-coord
 * `session_unfinished.rs`). Plan
 * `2026-10-06-closed-sessions-whose-work-is-unfinished-are-found-fleet-wide-and-resumed`
 * Phase 7.
 */

export interface UnfinishedTranscript {
  /** Warm-tier bytes coord still holds (0 after the 7-day warm GC). */
  coord_warm_bytes: number;
  /** Coord has a cold tier configured; the object's existence is not probed. */
  coord_cold: boolean;
}

export interface UnfinishedSession {
  claude_session_id: string;
  coord_session_id: string;
  device_id: string | null;
  hostname: string | null;
  account_label: string | null;
  config_dir: string | null;
  working_dir: string | null;
  worktree_path: string | null;
  work_unit_slug: string | null;
  last_acted_at: string | null;
  closed_at: string | null;
  /** `process_gone` | `unknown`. */
  liveness: string;
  /** Set iff `liveness === "process_gone"`: `census` | `device_absent`. */
  liveness_basis: string | null;
  transcript: UnfinishedTranscript | null;
  last_resume_attempt_at: string | null;
  /** The sweep's last verdict on this row; null = never swept. */
  resume_verdict: string | null;
}

/** `unknown` carries `sessions: null` — it is NOT an empty list. */
export interface UnfinishedSessionsView {
  state: "ok" | "unknown";
  reason: string | null;
  detail: string | null;
  sessions: UnfinishedSession[] | null;
  truncated: boolean;
}

export interface ResumeUnfinishedView {
  /** `null` = coord did not report a boolean: UNKNOWN, never ON. */
  resume_unfinished_enabled: boolean | null;
  can_edit: boolean;
}

export interface ResumeUnfinishedWriteResult {
  written: boolean;
  effective: ResumeUnfinishedView | null;
  readback_error: string | null;
}
