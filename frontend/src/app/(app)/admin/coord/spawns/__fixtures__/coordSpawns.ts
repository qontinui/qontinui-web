/**
 * Wire fixtures for `/admin/coord/spawns`, shaped field for field by the
 * shared contract for coord's `/coord/spawns…` reads (plan
 * `2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration`,
 * "Coord read API").
 */

import type {
  SpawnDetailWire,
  SpawnEventWire,
  SpawnListWire,
  SpawnRowWire,
  SpawnStatsWire,
} from "../_lib/spawnStatus";

export const DEVICE_A = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
export const DEVICE_B = "0d9e8f7a-6b5c-4d3e-8f2a-1b0c9d8e7f6a";

export const AS_OF = "2026-10-21T12:00:00Z";

let seq = 0;

export function rowFx(overrides: Partial<SpawnRowWire> = {}): SpawnRowWire {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    class: "continuation",
    origin: "gate_continuation",
    source_ref: `gate-${seq}`,
    requested_at: "2026-10-21T11:00:00Z",
    first_dispatched_at: "2026-10-21T11:00:02Z",
    spawned_at: "2026-10-21T11:00:12Z",
    updated_at: "2026-10-21T11:00:12Z",
    state: "spawned",
    attempts: 1,
    deferrals: 0,
    pinned_device_id: null,
    preferred_device_id: null,
    current_device_id: DEVICE_A,
    spawned_device_id: DEVICE_A,
    placement_basis: "admitted",
    lease_id: null,
    claude_code_session_id: "11111111-2222-4333-8444-555555555555",
    claude_account: "hotmail",
    session_outcome: "finished",
    session_outcome_at: "2026-10-21T11:30:00Z",
    terminal_reason: null,
    history_complete: true,
    wait_seconds: 12,
    ...overrides,
  };
}

export function listFx(
  items: SpawnRowWire[],
  overrides: Partial<SpawnListWire> = {}
): SpawnListWire {
  return {
    available: true,
    items,
    shown: items.length,
    total: items.length,
    truncated: false,
    next_cursor: null,
    as_of: AS_OF,
    ...overrides,
  };
}

export function statsFx(
  overall: Partial<SpawnStatsWire["overall"]> = {},
  overrides: Partial<SpawnStatsWire> = {}
): SpawnStatsWire {
  return {
    available: true,
    window: "7d",
    window_start: "2026-10-14T12:00:00Z",
    as_of: AS_OF,
    overall: {
      requested: 40,
      terminal: 38,
      spawned: 37,
      failed: 0,
      expired: 0,
      cancelled: 1,
      superseded: 0,
      pending: { queued: 2, dispatched: 0, deferred: 0 },
      started_share_bps: 9737,
      wait_p50_secs: 12,
      wait_p90_secs: 190,
      first_attempt_share_bps: 8108,
      requested_per_hour: 0.24,
      started_per_hour: 0.22,
      queued_now: 2,
      finished: { finished: 30, working: 4, closed_unfinished: 0, unknown: 3 },
      history_partial_rows: 0,
      ...overall,
    },
    per_device: [
      {
        device_id: DEVICE_A,
        placed: 30,
        started: 29,
        refused: 1,
        deferred: 2,
        wait_p50_secs: 11,
      },
      {
        device_id: DEVICE_B,
        placed: 8,
        started: 8,
        refused: 0,
        deferred: 0,
        wait_p50_secs: null,
      },
    ],
    local_report_counts: null,
    ...overrides,
  };
}

export function eventFx(
  overrides: Partial<SpawnEventWire> = {}
): SpawnEventWire {
  return {
    at: "2026-10-21T11:00:00Z",
    kind: "requested",
    device_id: null,
    reason: null,
    detail: {},
    ...overrides,
  };
}

export function detailFx(
  request: SpawnRowWire,
  events: SpawnEventWire[]
): SpawnDetailWire {
  return { available: true, request, events };
}

export const SCHEMA_MISSING = { available: false, reason: "schema_missing" };

/** The fleet roster `/fleet/health` serves — names for the two devices. */
export const ROSTER = {
  devices: [
    { device_id: DEVICE_A, hostname: "msi-wsl" },
    { device_id: DEVICE_B, hostname: "spaceship" },
  ],
};
