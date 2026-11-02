/**
 * `/operations` unfinished-sessions routes: the fleet-wide read, the per-row
 * dismiss and resume, and the tenant `resume_unfinished_enabled` flag.
 *
 * Part of the typed `/operations` client (plan
 * `2026-10-04-web-coord-operator-pages-are-monolith-components-with-hand-typed-urls`,
 * Phase 7). Same conventions as `coordMembers.ts`: `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE`, the URL inline, the retry policy stated, and a
 * non-2xx rejecting with `<METHOD> <url> failed: <status> - <body>`.
 *
 * The wire types mirror `UnfinishedSessionsView` and the tenant resume-flag
 * models in `backend/app/api/v1/endpoints/operations/__init__.py`, which
 * project coord's `GET /coord/sessions/unfinished` (qontinui-coord
 * `session_unfinished.rs`).
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

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

/** `GET /unfinished-sessions` — coord's fleet-wide answer, `unknown` included. */
export async function fetchUnfinishedSessions(): Promise<UnfinishedSessionsView> {
  const url = `${OPERATIONS_BASE}/unfinished-sessions`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<UnfinishedSessionsView>(res, `GET ${url}`);
}

/** `POST /unfinished-sessions/{id}/dismiss` — mark the session finished. */
export async function dismissUnfinishedSession(
  claudeSessionId: string
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/unfinished-sessions/${encodeURIComponent(claudeSessionId)}/dismiss`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify({}),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/**
 * `POST /unfinished-sessions/{id}/resume` — queue a resume on a device. Never
 * re-sent on a 5xx: a repeat could request a second resume.
 */
export async function resumeUnfinishedSession(
  coordSessionId: string,
  target: { target_device_id: string | null; account: string }
): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/unfinished-sessions/${encodeURIComponent(coordSessionId)}/resume`;
  const res = await httpClient.fetch(url, {
    method: "POST",
    body: JSON.stringify(target),
    idempotent: false,
  });
  return readJson<unknown>(res, `POST ${url}`, { unparseable: "null" });
}

/** `GET /tenant-policy/resume-unfinished` — the tenant's flag. */
export async function fetchResumeUnfinishedPolicy(): Promise<ResumeUnfinishedView> {
  const url = `${OPERATIONS_BASE}/tenant-policy/resume-unfinished`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<ResumeUnfinishedView>(res, `GET ${url}`);
}

/**
 * `PATCH /tenant-policy/resume-unfinished` — set the flag. Never re-sent on a
 * 5xx: a 504 means coord's answer was lost and it may have committed, which
 * the caller reports as unknown rather than retrying.
 */
export async function patchResumeUnfinishedPolicy(
  enabled: boolean
): Promise<ResumeUnfinishedWriteResult> {
  const url = `${OPERATIONS_BASE}/tenant-policy/resume-unfinished`;
  const res = await httpClient.fetch(url, {
    method: "PATCH",
    body: JSON.stringify({ resume_unfinished_enabled: enabled }),
    idempotent: false,
  });
  return readJson<ResumeUnfinishedWriteResult>(res, `PATCH ${url}`);
}
