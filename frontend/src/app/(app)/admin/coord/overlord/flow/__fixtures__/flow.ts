/**
 * Contract-§2 fixtures for `GET /coord/overlord/flow`, shared by the page and
 * derivation tests (plan
 * `2026-10-23-the-overlord-keeps-no-record-of-session-flow-so-its-development-runs-on-anecdote`).
 */

export const SESSION_ID = "6f1c2d3e-4b5a-4978-8a9b-0c1d2e3f4a5b";

export const VERSION_OLD = "2d0c39d0d58ee0ae011096161ac49047d66dcf3c";

/** coord's 16-hex digest over a group's `overlord_versions`. */
export const VERSION_DIGEST = "9f86d081884c7d65";

export const DEVICE_ID = "0d1e2f3a-4b5c-4d6e-8f70-819203a4b5c6";
export const DEVICE_ID_2 = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

/** Two runners with 2 full passes each: a tenant total of 4, and still none covered. */
export const RUNNERS_TWO_SHORT = [
  {
    device_id: DEVICE_ID,
    runner_port: 9876,
    passes: 3,
    full_passes: 2,
    latest_full_pass_at: "2026-10-23T20:00:00Z",
  },
  {
    device_id: DEVICE_ID_2,
    runner_port: 9876,
    passes: 2,
    full_passes: 2,
    latest_full_pass_at: "2026-10-23T19:00:00Z",
  },
];

/** Every runner ran at least 3 full passes. */
export const RUNNERS_ALL_COVERED = [
  { ...RUNNERS_TWO_SHORT[0], passes: 4, full_passes: 3 },
  { ...RUNNERS_TWO_SHORT[1], passes: 5, full_passes: 4 },
];

export const FULL_FLOW = {
  ok: true,
  window: { since: "2026-10-17T00:00:00Z", until: "2026-10-24T00:00:00Z" },
  truncated: false,
  passes_considered: 3,
  full_passes_considered: 2,
  census_passes_considered: 2,
  rows_considered: 79,
  unchanged_truncated: false,
  unknown_share_truncated: false,
  verdict_series_truncated: false,
  group_by: "overlord_version",
  groups: [
    {
      overlord_version: VERSION_DIGEST,
      overlord_versions: {
        "triage-sessions.py": VERSION_OLD,
        runner_git_sha: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
      },
      passes_considered: 2,
      census_passes_considered: 1,
      unchanged_truncated: false,
      time_to_close: { count: 0, median_secs: null, p90_secs: null },
      nudge: { nudged: 0, progress_rate: null, finish_rate: null },
      unchanged: [],
      unknown_share: [
        {
          pass_id: "p-old",
          started_at: "2026-10-23T08:00:00Z",
          rows: 38,
          unknown_rows: 19,
          share: 0.5,
        },
      ],
    },
    {
      overlord_version: null,
      overlord_versions: null,
      passes_considered: 3,
      census_passes_considered: 3,
      unchanged_truncated: false,
      time_to_close: { count: 4, median_secs: 5400, p90_secs: 20000 },
      nudge: { nudged: 10, progress_rate: 0.4, finish_rate: 0.2 },
      unchanged: [
        {
          key: SESSION_ID,
          terminal_id: "term-7",
          verdict: "STOPPED",
          reason_codes: [],
          consecutive_full_passes: 3,
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
      ],
    },
  ],
  time_to_close: {
    count: 4,
    median_secs: 5400,
    p90_secs: 20000,
    closed_by: { triage: 3, absent: 1 },
    absent_unproven: 2,
    sessions: [
      {
        key: "8b1c2d3e-4b5a-4978-8a9b-0c1d2e3f4a52",
        first_stopped_at: "2026-10-18T09:00:00Z",
        closed_at: "2026-10-18T14:33:20Z",
        secs: 20000,
        closed_by: "triage",
        stop_episode_started_at: "2026-10-18T09:00:00Z",
        device_id: DEVICE_ID,
        runner_port: 9876,
      },
      {
        key: "7a1c2d3e-4b5a-4978-8a9b-0c1d2e3f4a51",
        first_stopped_at: "2026-10-18T10:00:00Z",
        closed_at: "2026-10-18T15:00:00Z",
        secs: 18000,
        closed_by: "triage",
        stop_episode_started_at: "2026-10-18T10:00:00Z",
        device_id: DEVICE_ID,
        runner_port: 9876,
      },
      {
        key: SESSION_ID,
        first_stopped_at: "2026-10-20T10:00:00Z",
        closed_at: "2026-10-20T11:30:00Z",
        secs: 5400,
        closed_by: "triage",
        stop_episode_started_at: "2026-10-20T11:00:00Z",
        device_id: DEVICE_ID,
        runner_port: 9876,
      },
      {
        key: "terminal:term-3",
        first_stopped_at: "2026-10-21T10:00:00Z",
        closed_at: "2026-10-21T10:30:00Z",
        secs: 1800,
        closed_by: "absent",
        stop_episode_started_at: "2026-10-21T10:00:00Z",
        device_id: DEVICE_ID,
        runner_port: 9876,
      },
    ],
    sessions_truncated: false,
  },
  nudge: {
    nudged: 10,
    progressed: 4,
    finished: 2,
    finish_unproven: 2,
    progress_rate: 0.4,
    finish_rate: 0.25,
    unmeasured_progress: 3,
    pending: 1,
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
      last_intervention: {
        intervention_id: "0190aaaa-0000-7000-8000-000000000001",
        stop_class: "A",
        verb: "nudge",
        mode: "live",
        executed: true,
        outcome: "did_work",
        observed_at: "2026-10-23T19:00:00Z",
      },
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
  full_passes_by_runner: [RUNNERS_TWO_SHORT[0]],
  params: { unchanged_min_passes: 3, nudge_window_passes: 3 },
};

/** A window coord answered with nothing measurable: nulls, never zeros. */
export const NULL_FLOW = {
  ok: true,
  window: { since: "2026-10-23T00:00:00Z", until: "2026-10-24T00:00:00Z" },
  truncated: false,
  passes_considered: 2,
  full_passes_considered: 2,
  census_passes_considered: 2,
  rows_considered: 0,
  unchanged_truncated: false,
  unknown_share_truncated: false,
  verdict_series_truncated: false,
  group_by: "overlord_version",
  groups: [],
  time_to_close: {
    count: 0,
    median_secs: null,
    p90_secs: null,
    closed_by: {},
    absent_unproven: 0,
    sessions: [],
    sessions_truncated: false,
  },
  nudge: {
    nudged: 0,
    progressed: 0,
    finished: 0,
    progress_rate: null,
    finish_rate: null,
    finish_unproven: 0,
    unmeasured_progress: 0,
    pending: 0,
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
  full_passes_by_runner: [RUNNERS_TWO_SHORT[0]],
  params: { unchanged_min_passes: 3, nudge_window_passes: 3 },
};

/** A `GET /coord/overlord/passes` answer: newest first. */
export const PASS_LIST = {
  ok: true,
  passes: [
    {
      pass_id: "p-new",
      device_id: DEVICE_ID,
      runner_port: 9876,
      runner_build: "6274df4f809f",
      scope: "full",
      mode: "report",
      skipped_steps: [],
      started_at: "2026-10-23T20:00:00Z",
      ended_at: "2026-10-23T20:01:00Z",
      exit_code: 1,
      verdict_histogram: { BUSY: 1, UNKNOWN: 1, STOPPED: 1 },
      overlord_versions: { "triage-sessions.py": VERSION_OLD },
      row_count: 3,
    },
    {
      pass_id: "p-old",
      device_id: DEVICE_ID,
      runner_port: 9876,
      runner_build: null,
      scope: "filtered",
      mode: "act",
      skipped_steps: ["layout"],
      started_at: "2026-10-23T08:00:00Z",
      ended_at: null,
      exit_code: null,
      verdict_histogram: {},
      overlord_versions: {},
      row_count: 0,
    },
  ],
  total_matching: 2,
  truncated: false,
  limit: 200,
  offset: 0,
};

/** A `GET /coord/overlord/passes/p-new` answer, in coord's `terminal_id` order. */
export const PASS_DETAIL = {
  ok: true,
  pass: {
    ...PASS_LIST.passes[0],
    rows: [
      {
        terminal_id: "term-1",
        observed_at: "2026-10-23T20:00:00Z",
        claude_session_id: SESSION_ID,
        session_name: "1234 fix the flaky gate",
        account: "jan",
        verdict: "BUSY",
        reason_codes: [],
        action: "none",
        action_outcome: null,
        detail: { reasons: ["input prompt not found on screen"] },
      },
      {
        terminal_id: "term-2",
        observed_at: "2026-10-23T20:00:00Z",
        claude_session_id: null,
        session_name: null,
        account: null,
        verdict: "UNKNOWN",
        reason_codes: ["unknown.pid_absent"],
        action: "none",
        action_outcome: null,
        detail: {},
      },
      {
        terminal_id: "term-3",
        observed_at: "2026-10-23T20:00:00Z",
        claude_session_id: null,
        session_name: "stuck one",
        account: "jan",
        verdict: "STOPPED",
        reason_codes: ["stopped.no_progress"],
        action: "nudge",
        action_outcome: "sent_unconfirmed",
        detail: {},
      },
    ],
  },
};
