/**
 * Wire fixtures for `/admin/coord/session-load`, in the exact shapes coord's
 * `crates/coord/src/session_runs/routes.rs` serves (plan
 * `2026-10-23-session-duration-by-work-type-and-per-device-session-load`
 * Phase 3), shared by the status module's tests and the page's.
 */

export const DEVICE_A = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
export const DEVICE_B = "7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
export const DEVICE_C = "8b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";
export const AS_OF = "2026-10-26T12:00:00Z";
export const DAY_MS = 86_400_000;
/** 2026-10-26T00:00:00Z — the bucket holding now in the growth fixture. */
export const TODAY_MS = Date.UTC(2026, 9, 26);

export const SCHEMA_MISSING = {
  error: "schema_missing",
  degraded: true,
  relation: "coord.session_runs",
  relations: ["coord.session_runs", "coord.session_run_hourly"],
  route: "GET /coord/session-runs/stats",
  detail: "coord.session_runs / coord.session_run_hourly are not provisioned",
};

export function groupFx(over: Record<string, unknown> = {}) {
  return {
    work_type: "post_merge",
    work_type_description:
      "A session continued from a gate that coord's auto-PR-merged producer registered.",
    runs: 10,
    open_now: 2,
    wall_seconds: {
      p50: 720,
      p90: 5400,
      p99: 7200,
      sum: 20000,
      samples: 7,
      excludes: "inferred ends and open runs",
    },
    slot_hours: 8,
    active_seconds: { p50: 300, samples: 7 },
    held_after_finish_seconds: { sum: 7200, samples: 3 },
    inferred_count: 1,
    reconciled_count: 0,
    unknown_count: 0,
    ...over,
  };
}

export function statsFx(
  groups: unknown[] = [
    groupFx(),
    groupFx({
      work_type: "vet_imp",
      work_type_description: "A vet-imp session.",
      runs: 4,
      open_now: 0,
      slot_hours: 12,
      wall_seconds: { p50: null, p90: null, p99: null, sum: null, samples: 0 },
      held_after_finish_seconds: { sum: null, samples: 0 },
      inferred_count: 0,
    }),
  ],
  windowSeconds = 7 * 86_400
) {
  return {
    window_seconds: windowSeconds,
    since: "2026-10-19T12:00:00Z",
    group_by: "work_type",
    population: "runs started in the window",
    slot_hours_definition:
      "sum over the population of (coalesce(ended_at, now) - started_at)",
    classifier_version: 1,
    groups,
    as_of: AS_OF,
  };
}

export function deviceStatsFx(windowSeconds = 7 * 86_400) {
  return statsFx(
    [
      { ...groupFx({ slot_hours: 6 }), device_id: DEVICE_A },
      {
        ...groupFx({ work_type: "vet_imp", slot_hours: 2 }),
        device_id: DEVICE_A,
      },
      { ...groupFx({ slot_hours: 2 }), device_id: DEVICE_B },
    ],
    windowSeconds
  );
}

export function deviceFx(over: Record<string, unknown> = {}) {
  return {
    device_id: DEVICE_A,
    name: "merytshost",
    budget: {
      state: "published",
      value: 14,
      label: "configured session budget",
    },
    last_heartbeat: "2026-10-26T11:59:30Z",
    heartbeat_age_seconds: 30,
    known_device: true,
    open_now: 5,
    peak: 9,
    p95: 6,
    p95_scope: "whole window",
    series: [
      {
        bucket_start: "2026-10-26T10:00:00Z",
        source: "raw",
        total: { peak: 4, p95: 3 },
        by_work_type: { post_merge: { peak: 4, p95: 3 } },
      },
      {
        bucket_start: "2026-10-26T11:00:00Z",
        source: "raw",
        total: { peak: 9, p95: 6 },
        by_work_type: {
          post_merge: { peak: 7, p95: 5 },
          vet_imp: { peak: 2, p95: 1 },
        },
      },
    ],
    ...over,
  };
}

export function concurrencyFx(
  devices: unknown[] = [deviceFx()],
  windowSeconds = 7 * 86_400
) {
  return {
    window_seconds: windowSeconds,
    bucket_seconds: 3600,
    since: "2026-10-19T12:00:00Z",
    raw_from: "2026-10-19T12:00:00Z",
    grid: "open runs at each whole minute",
    devices,
    truncated: false,
    as_of: AS_OF,
  };
}

/**
 * `n` complete days ending yesterday, with `slot(i)` total slot-hours on day
 * `i` (0 = oldest), all post_merge, plus today's partial bucket.
 */
export function growthFx(
  n: number,
  slot: (i: number) => number,
  over: Record<string, unknown> = {}
) {
  const firstMs = TODAY_MS - n * DAY_MS;
  const series = [];
  for (let i = 0; i < n; i += 1) {
    const v = slot(i);
    series.push({
      bucket_start: new Date(firstMs + i * DAY_MS).toISOString(),
      partial: false,
      source: ["raw"],
      runs: { post_merge: 3 },
      slot_hours: { post_merge: v },
      runs_total: 3,
      slot_hours_total: v,
      backfilled_runs: 0,
    });
  }
  series.push({
    bucket_start: new Date(TODAY_MS).toISOString(),
    partial: true,
    source: ["raw"],
    runs: { post_merge: 1 },
    slot_hours: { post_merge: 1 },
    runs_total: 1,
    slot_hours_total: 1,
    backfilled_runs: 0,
  });
  const recordingSince = new Date(firstMs - 3_600_000).toISOString();
  return {
    window_seconds: 90 * 86_400,
    bucket_seconds: 86_400,
    since: new Date(TODAY_MS - 90 * DAY_MS).toISOString(),
    raw_from: new Date(TODAY_MS - 31 * DAY_MS).toISOString(),
    recording_since: recordingSince,
    devices_recording: [
      { device_id: DEVICE_A, recording_since: recordingSince },
    ],
    series,
    fleet: {
      available_slot_hours_per_day: 336,
      available_slot_hours_per_bucket: 336,
      available_state: "published",
      definition: "sum of published non-zero configured session budgets x 24",
      devices_with_budget: 1,
      devices_zero_budget: 0,
      devices_without_budget: 0,
    },
    truncated: false,
    as_of: AS_OF,
    ...over,
  };
}

export function runFx(over: Record<string, unknown> = {}) {
  return {
    id: "0b6f7f0e-2a59-4d3c-9b8e-5d1f2c3a4b5c",
    device_id: DEVICE_A,
    claude_code_session_id: "1d2c3b4a-0000-4000-8000-000000000001",
    run_seq: 1,
    initiator: "coord",
    work_type: "post_merge",
    classifier_version: 1,
    skill: null,
    first_command: null,
    spawn_origin: "gate_continuation",
    spawn_kind: null,
    dispatch_source: null,
    diagnosis_kind: null,
    gate_registered_by: "AUTO_PR_MERGED_GATE",
    gate_id: "2d2c3b4a-0000-4000-8000-000000000002",
    agent_id: null,
    spawn_request_id: "3d2c3b4a-0000-4000-8000-000000000003",
    coord_session_id: null,
    bind_origin: "authoritative",
    repo: "qontinui/qontinui-web",
    work_unit_slug: null,
    provider: "anthropic",
    model: "claude-opus",
    account_label: "carolin",
    started_at: "2026-10-26T10:00:00Z",
    first_turn_at: "2026-10-26T10:00:05Z",
    finished_at: "2026-10-26T10:40:00Z",
    ended_at: "2026-10-26T11:00:00Z",
    last_seen_at: "2026-10-26T11:00:00Z",
    active_seconds: 1800,
    wall_seconds: 3600,
    held_after_finish_seconds: 1200,
    end_reason: "exited",
    end_source: "observed",
    close_reason: "pty-exit",
    clock_skew_seconds: 0,
    history_complete: true,
    ...over,
  };
}

export function runListFx(
  runs: unknown[] = [runFx()],
  over: Record<string, unknown> = {}
) {
  return {
    runs,
    shown: runs.length,
    total: runs.length,
    truncated: false,
    next_cursor: null,
    as_of: AS_OF,
    ...over,
  };
}
