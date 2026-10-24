/**
 * Contract-§2 fixtures for `GET /coord/overlord/flow`, shared by the page and
 * derivation tests (plan
 * `2026-10-23-the-overlord-keeps-no-record-of-session-flow-so-its-development-runs-on-anecdote`).
 */

export const SESSION_ID = "6f1c2d3e-4b5a-4978-8a9b-0c1d2e3f4a5b";

export const FULL_FLOW = {
  ok: true,
  window: { since: "2026-10-17T00:00:00Z", until: "2026-10-24T00:00:00Z" },
  truncated: false,
  passes_considered: 3,
  full_passes_considered: 2,
  time_to_close: {
    count: 4,
    median_secs: 5400,
    p90_secs: 20000,
    closed_by: { triage: 3, absent: 1 },
    sessions: [
      {
        key: SESSION_ID,
        first_stopped_at: "2026-10-20T10:00:00Z",
        closed_at: "2026-10-20T11:30:00Z",
        secs: 5400,
        closed_by: "triage",
      },
    ],
  },
  nudge: {
    nudged: 10,
    progressed: 4,
    finished: 2,
    progress_rate: 0.4,
    finish_rate: 0.2,
    unmeasured_progress: 3,
  },
  unchanged: [
    {
      key: SESSION_ID,
      claude_session_id: SESSION_ID,
      terminal_id: "term-7",
      session_name: "1234 fix the flaky gate",
      verdict: "STOPPED",
      reason_codes: ["stopped.no_progress"],
      consecutive_full_passes: 3,
      first_seen_at: "2026-10-23T08:00:00Z",
      last_seen_at: "2026-10-23T20:00:00Z",
    },
    {
      key: "terminal:term-9",
      claude_session_id: null,
      terminal_id: "term-9",
      session_name: null,
      verdict: "LIMITED",
      reason_codes: [],
      consecutive_full_passes: 4,
      first_seen_at: "2026-10-22T08:00:00Z",
      last_seen_at: "2026-10-23T20:00:00Z",
    },
  ],
  unknown_share: [
    {
      pass_id: "p-new",
      started_at: "2026-10-23T20:00:00Z",
      rows: 40,
      unknown_rows: 2,
      share: 0.05,
    },
    {
      pass_id: "p-old",
      started_at: "2026-10-23T08:00:00Z",
      rows: 38,
      unknown_rows: 19,
      share: 0.5,
    },
  ],
  verdict_series: [
    {
      pass_id: "p-new",
      started_at: "2026-10-23T20:00:00Z",
      scope: "full",
      mode: "report",
      histogram: { STOPPED: 3, BUSY: 33, UNKNOWN: 2, LIMITED: 2 },
    },
    {
      pass_id: "p-old",
      started_at: "2026-10-23T08:00:00Z",
      scope: "full",
      mode: "act",
      histogram: { STOPPED: 5, BUSY: 14, UNKNOWN: 19 },
    },
    {
      pass_id: "p-filtered",
      started_at: "2026-10-23T12:00:00Z",
      scope: "filtered",
      mode: "report",
      histogram: { FINISHED: 1 },
    },
  ],
};

/** A window coord answered with nothing measurable: nulls, never zeros. */
export const NULL_FLOW = {
  ok: true,
  window: { since: "2026-10-23T00:00:00Z", until: "2026-10-24T00:00:00Z" },
  truncated: false,
  passes_considered: 2,
  full_passes_considered: 2,
  time_to_close: {
    count: 0,
    median_secs: null,
    p90_secs: null,
    closed_by: {},
    sessions: [],
  },
  nudge: {
    nudged: 0,
    progressed: 0,
    finished: 0,
    progress_rate: null,
    finish_rate: null,
    unmeasured_progress: 0,
  },
  unchanged: [],
  unknown_share: [
    {
      pass_id: "p-empty",
      started_at: "2026-10-23T20:00:00Z",
      rows: 0,
      unknown_rows: 0,
      share: null,
    },
  ],
  verdict_series: [
    {
      pass_id: "p-empty",
      started_at: "2026-10-23T20:00:00Z",
      scope: "full",
      mode: "report",
      histogram: {},
    },
  ],
};
