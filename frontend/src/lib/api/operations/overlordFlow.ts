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
  /**
   * When the LAST stop before the close began. Differs from `first_stopped_at`
   * when the session recovered in between; `secs` still counts from the first
   * stop, so a recovery inflates it and this is how a reader sees that.
   */
  stop_episode_started_at: string;
  closed_at: string;
  secs: number;
  closed_by: FlowClosedBy;
  /** `null` for a pass written by a non-device token. */
  device_id: string | null;
  runner_port: number;
}

export interface FlowTimeToClose {
  count: number;
  /** `null` when `count == 0` — never a 0. */
  median_secs: number | null;
  p90_secs: number | null;
  closed_by: Partial<Record<FlowClosedBy, number>>;
  /** Went missing across a runner build change: not in `count`. */
  absent_unproven: number;
  /**
   * When cut, the sessions that FIRST STOPPED most recently (not those closed
   * most recently); `count` and the percentiles cover them all.
   */
  sessions: FlowClosedSession[];
  sessions_truncated: boolean;
}

export interface FlowNudge {
  nudged: number;
  progressed: number;
  finished: number;
  /** `progressed / (nudged - unmeasured_progress)`; `null` when none measured. */
  progress_rate: number | null;
  /** `finished / (nudged - finish_unproven)`; `null` when that is `0 / 0`. */
  finish_rate: number | null;
  /** Went missing across a runner build change: not in `finish_rate`. */
  finish_unproven: number;
  /** Nudges whose following rows all carried `progress_since_nudge = null`. */
  unmeasured_progress: number;
  /**
   * Delivered nudges with no later sighting of the session and no close yet:
   * in neither `nudged` nor a rate, since they had no chance to show an effect.
   */
  pending: number;
}

/** The newest `/next-move` judgment recorded for a session. */
export interface FlowLastIntervention {
  intervention_id: string;
  stop_class: string;
  verb: string;
  mode: string;
  /** `null` = the row predates the `executed` flag: unknown, not false. */
  executed: boolean | null;
  /** `null` = no outcome observed yet. */
  outcome: string | null;
  /** When the judged stop was observed; dates the judgment, not a later edit. */
  observed_at: string;
}

/** A session whose verdict and reasons held across consecutive full passes. */
export interface FlowUnchangedSession {
  key: string;
  /** `null` for a pass written by a non-device token. */
  device_id?: string | null;
  runner_port?: number;
  /** `null` = no Claude session id was proven, never "no session". */
  claude_session_id: string | null;
  terminal_id: string;
  session_name: string | null;
  verdict: string;
  reason_codes: string[];
  consecutive_full_passes: number;
  first_seen_at: string;
  last_seen_at: string;
  /**
   * `null` = none recorded, or no Claude session id to join on. Absent = a
   * coord that predates the join, which says nothing either way.
   */
  last_intervention?: FlowLastIntervention | null;
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

/**
 * One runner's pass counts in the window. `unchanged` is decided per
 * `(device_id, runner_port)`, so whether an empty unchanged list can be
 * trusted is a per-runner question — never one a tenant-wide total answers.
 */
export interface FlowRunnerPasses {
  /** `null` for a pass written by a non-device token. */
  device_id: string | null;
  runner_port: number;
  passes: number;
  full_passes: number;
  latest_full_pass_at: string | null;
}

/** The thresholds coord actually applied to this answer. */
export interface FlowParams {
  unchanged_min_passes: number;
  nudge_window_passes: number;
}

/** The metric blocks coord derives over one set of passes. */
export interface FlowBlocks {
  passes_considered: number;
  full_passes_considered: number;
  /**
   * Those full passes with stored rows and no failed run: the only ones
   * absence and unchanged runs are read from.
   */
  census_passes_considered: number;
  rows_considered: number;
  time_to_close: FlowTimeToClose;
  nudge: FlowNudge;
  unchanged: FlowUnchangedSession[];
  unchanged_truncated: boolean;
  unknown_share: FlowUnknownShare[];
  unknown_share_truncated: boolean;
  /** Oldest first. */
  verdict_series: FlowVerdictPass[];
  verdict_series_truncated: boolean;
}

/**
 * One `group_by=overlord_version` group: the blocks over ONLY the passes that
 * ran one `triage-sessions.py` blob sha, oldest group first.
 */
export interface FlowVersionGroup extends FlowBlocks {
  /** `null` = those passes recorded no version. */
  overlord_version: string | null;
}

/** coord's `GET /coord/overlord/flow` answer (contract §2). */
export interface OverlordFlowResponse extends FlowBlocks {
  ok: true;
  window: { since: string; until: string; hours?: number };
  /** A capped read: every derived number is over the truncated set. */
  truncated: boolean;
  group_by: "overlord_version" | null;
  /** `null` unless asked for with `group_by=overlord_version`. */
  groups: FlowVersionGroup[] | null;
  /** Per-runner pass counts; absent on a coord that predates the field. */
  full_passes_by_runner?: FlowRunnerPasses[];
  /** The thresholds applied; absent on a coord that predates the field. */
  params?: FlowParams;
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

/** One pass of `GET /coord/overlord/passes`, without its rows. */
export interface OverlordPass {
  pass_id: string;
  /** `null` for a pass written by a non-device token. */
  device_id: string | null;
  runner_port: number;
  runner_build: string | null;
  scope: "full" | "filtered";
  mode: "report" | "act";
  skipped_steps: string[];
  started_at: string;
  ended_at: string | null;
  exit_code: number | null;
  verdict_histogram: Record<string, number>;
  /** File or `runner_git_sha` → blob or commit sha, as run. */
  overlord_versions: Record<string, string | null>;
  row_count: number;
}

/** coord's `GET /coord/overlord/passes` answer. Newest `started_at` first. */
export interface OverlordPassList {
  ok: true;
  passes: OverlordPass[];
  total_matching: number;
  truncated: boolean;
  limit: number;
  offset: number;
}

/** One terminal as one pass screened it. */
export interface OverlordPassRow {
  terminal_id: string;
  observed_at: string;
  claude_session_id: string | null;
  session_name: string | null;
  tab: string | null;
  account: string | null;
  screen_verdict: string | null;
  verdict: string;
  reason_codes: string[];
  state_since_ms: number | null;
  progress_since_nudge: boolean | null;
  action: string;
  action_outcome: string | null;
  /** Free-form; `reasons` is the screen's prose when no code was emitted. */
  detail: { reasons?: string[] } & Record<string, unknown>;
}

/** coord's `GET /coord/overlord/passes/{pass_id}` answer. */
export interface OverlordPassDetail {
  ok: true;
  pass: OverlordPass & { rows: OverlordPassRow[] };
}

/**
 * `GET /coord/overlord/passes?<query>` — `query` is the already-encoded query
 * string (`since`, `limit`, and optionally `device_id`, `runner_port`, `scope`,
 * `mode`, `offset`). Returned unparsed, for the same reason as the flow read.
 */
export async function fetchOverlordPasses(query: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/overlord/passes?${query}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}

/** `GET /coord/overlord/passes/{pass_id}` — one pass with its rows. */
export async function fetchOverlordPass(passId: string): Promise<unknown> {
  const url = `${OPERATIONS_BASE}/coord/overlord/passes/${encodeURIComponent(passId)}`;
  const res = await httpClient.fetch(url, { method: "GET", idempotent: true });
  return readJson<unknown>(res, `GET ${url}`);
}
