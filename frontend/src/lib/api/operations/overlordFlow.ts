/**
 * `/operations` overlord session-flow read, proxied from coord's
 * `GET /coord/overlord/flow` (qontinui-coord `overlord_passes.rs`) — the flow
 * metrics derived over a window of `/triage-sessions` passes.
 *
 * Plan `2026-10-23-the-overlord-keeps-no-record-of-session-flow-so-its-development-runs-on-anecdote`
 * Phase 4. Same conventions as `operatorTouches.ts`: `httpClient.fetch` on the
 * RELATIVE `OPERATIONS_BASE`, the URL inline, and a non-2xx rejecting with
 * `GET <url> failed: <status> - <body>` — the web proxy passes coord's typed
 * 422/503 bodies through verbatim, so `<body>` is coord's `{error, …}`.
 *
 * The body is returned UNPARSED (`unknown`): the page's `readFlowBody` is the
 * one validator of the wire shape, so a coord that drifts reads as unknown
 * there rather than being cast here. The types below are the wire contract
 * that validator narrows to.
 */

import { httpClient } from "@/services/service-factory";
import { OPERATIONS_BASE, readJson } from "./base";

/** Who closed a session: triage's own close, or its absence from a full pass. */
export type FlowClosedBy = "triage" | "absent";

/** One session's stop-to-close interval. */
export interface FlowClosedSession {
  /** `claude_session_id`, else `terminal:<terminal_id>`. */
  key: string;
  first_stopped_at: string;
  closed_at: string;
  secs: number;
  closed_by: FlowClosedBy;
}

export interface FlowTimeToClose {
  count: number;
  /** `null` when `count == 0` — never a 0. */
  median_secs: number | null;
  p90_secs: number | null;
  closed_by: Partial<Record<FlowClosedBy, number>>;
  sessions: FlowClosedSession[];
}

export interface FlowNudge {
  nudged: number;
  progressed: number;
  finished: number;
  /** `null` when `nudged == 0`. */
  progress_rate: number | null;
  finish_rate: number | null;
  /** Nudges whose following rows all carried `progress_since_nudge = null`. */
  unmeasured_progress: number;
}

/** A session whose verdict and reasons held across consecutive full passes. */
export interface FlowUnchangedSession {
  key: string;
  /** `null` = no Claude session id was proven, never "no session". */
  claude_session_id: string | null;
  terminal_id: string;
  session_name: string | null;
  verdict: string;
  reason_codes: string[];
  consecutive_full_passes: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface FlowUnknownShare {
  pass_id: string;
  started_at: string;
  rows: number;
  unknown_rows: number;
  /** `null` when the pass has no rows. */
  share: number | null;
}

export interface FlowVerdictPass {
  pass_id: string;
  started_at: string;
  scope: "full" | "filtered";
  mode: "report" | "act";
  /** Verdict → row count. The verdict vocabulary is deliberately open. */
  histogram: Record<string, number>;
}

/** coord's `GET /coord/overlord/flow` answer (contract §2). */
export interface OverlordFlowResponse {
  ok: true;
  window: { since: string; until: string };
  /** A capped read: every derived number is over the truncated set. */
  truncated: boolean;
  passes_considered: number;
  full_passes_considered: number;
  time_to_close: FlowTimeToClose;
  nudge: FlowNudge;
  unchanged: FlowUnchangedSession[];
  unknown_share: FlowUnknownShare[];
  /** Oldest first. */
  verdict_series: FlowVerdictPass[];
}

/**
 * `GET /coord/overlord/flow?<query>` — `query` is the already-encoded query
 * string (`window_hours`, and optionally `device_id`, `runner_port`,
 * `unchanged_min_passes`, `nudge_window_passes`, `group_by`).
 */
export async function fetchOverlordFlow(query: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/overlord/flow?${query}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}
