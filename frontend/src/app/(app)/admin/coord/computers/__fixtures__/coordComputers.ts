/**
 * Test fixtures shaped EXACTLY like coord's computer reads — every field
 * `qontinui-coord/crates/coord/src/computers.rs` serializes (`ComputerSummary`,
 * `LaneRollup`, `ServiceRow`, `ComputerDetail`, `list_body`, `detail_body`),
 * with the values coord would compute for them. Tests override only the fields
 * they are about, so a fixture can never quietly carry a shape coord does not
 * emit. Imported by tests only.
 */

import type {
  ComputerDetailWire,
  ComputerLaneWire,
  ComputerServiceWire,
  ComputerSummaryWire,
  ComputersListWire,
  StalenessRulesWire,
} from "../_lib/computerStatus";

export const COMPUTER_ID = "6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
export const DEVICE_ID = "11111111-2222-4333-8444-555555555555";

export const STALENESS: StalenessRulesWire = {
  report_stale_after_secs: 900,
  sample_stale_after_secs: 90,
};

const iso = (secsAgo: number, nowMs: number) =>
  new Date(nowMs - secsAgo * 1000).toISOString();

/** Coord's `classify_freshness`: `age > stale_after` is stale. */
const state = (age: number, staleAfter: number) =>
  age > staleAfter ? "stale" : "fresh";

export function laneFx(
  over: Partial<ComputerLaneWire> & { age_secs?: number } = {},
  nowMs = Date.now()
): ComputerLaneWire {
  const age = over.age_secs ?? 10;
  return {
    lane: "host",
    lane_instance: null,
    device_id: DEVICE_ID,
    sampled_at: iso(age, nowMs),
    age_secs: age,
    freshness: { age_secs: age, state: state(age, 90), stale_after_secs: 90 },
    cpu_cores: 48,
    load_1m: 1.5,
    load_5m: 1.2,
    load_15m: 1.0,
    mem_total_bytes: 64 * 1024 ** 3,
    mem_available_bytes: 48 * 1024 ** 3,
    swap_total_bytes: 8 * 1024 ** 3,
    swap_used_bytes: 1024 ** 3,
    swap_ratio: 0.125,
    disk_total_bytes: 1024 ** 4,
    disk_free_bytes: 512 * 1024 ** 3,
    pressure: { ratio: 0.125, basis: "swap" },
    headroom: "ok",
    psi_memory_some_avg10: 0.5,
    psi_memory_some_avg60: 0.25,
    psi_memory_full_avg10: 0,
    psi_memory_full_avg60: 0,
    psi_cpu_some_avg10: 2,
    psi_cpu_some_avg60: 1.5,
    psi_cpu_full_avg10: 0,
    psi_cpu_full_avg60: 0,
    psi_io_some_avg10: 0.1,
    psi_io_some_avg60: 0.1,
    psi_io_full_avg10: 0,
    psi_io_full_avg60: 0,
    oom_kill_total: 0,
    boot_id: "boot-1",
    measured: null,
    ...over,
  };
}

/**
 * Coord's `degrade_for_truncation`: a truncated lane list cannot vouch for
 * the lanes it did not list, so `fresh` becomes `unknown`; a `stale` found
 * among the listed lanes stays `stale`.
 */
function degradeForTruncation(state: string, truncated: boolean): string {
  return state === "fresh" && truncated ? "unknown" : state;
}

export const OTHER_COMPUTER_ID = "7a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

export function computerFx(
  over: Partial<ComputerSummaryWire> & { report_age_secs?: number } = {},
  nowMs = Date.now()
): ComputerSummaryWire {
  const { report_age_secs, ...rest } = over;
  const age = report_age_secs ?? 30;
  const lanes = rest.lanes ?? [laneFx({}, nowMs)];
  // Coord's newest-sample probe has no window: with lanes it is the youngest
  // lane's age; with none, a test says (via `newest_sample_age_secs`) whether
  // the computer was ever sampled.
  const newest =
    rest.newest_sample_age_secs !== undefined
      ? rest.newest_sample_age_secs
      : lanes.length > 0
        ? Math.min(...lanes.map((l) => l.age_secs))
        : null;
  return {
    computer_id: COMPUTER_ID,
    kind: "host",
    parent_computer_id: null,
    identity_hash_prefix: "0123456789ab",
    hostname: "merytshost",
    os: "linux",
    os_version: "13",
    kernel: "6.12.101",
    arch: "x86_64",
    capacity: {
      cpu_cores: 48,
      memory_total_bytes: 64 * 1024 ** 3,
      swap_total_bytes: 8 * 1024 ** 3,
      disk_total_bytes: 1024 ** 4,
      gpus: null,
    },
    boot_id: "boot-1",
    booted_at: iso(86_400, nowMs),
    access: null,
    identity_conflict_at: null,
    first_seen_at: iso(86_400 * 3, nowMs),
    freshness: {
      last_report_at: iso(age, nowMs),
      age_secs: age,
      state: state(age, 900),
      stale_after_secs: 900,
    },
    lanes,
    // Coord's `fold_sample_state`.
    samples_state: degradeForTruncation(
      lanes.length === 0
        ? newest === null
          ? "unknown"
          : "stale"
        : lanes.every((l) => l.freshness.state === "fresh")
          ? "fresh"
          : "stale",
      rest.lanes_truncated === true
    ),
    newest_sample_age_secs: newest,
    lanes_truncated: false,
    sample_stale_after_secs: 90,
    services_reported: true,
    services_total: 3,
    services_failed: 0,
    last_event: null,
    devices: [
      {
        device_id: DEVICE_ID,
        hostname: "merytshost",
        role: "runner",
        capabilities: ["coord_mcp"],
        state: "healthy",
        last_seen_at: iso(20, nowMs),
      },
    ],
    ci_runners: [],
    drill_down: `coord_query_computers name=${rest.computer_id ?? COMPUTER_ID}`,
    ...rest,
  };
}

export function serviceFx(
  over: Partial<ComputerServiceWire> = {}
): ComputerServiceWire {
  const active = over.active_state ?? "active";
  return {
    unit: "actions.runner.qontinui-web.merytshost-1.service",
    kind: "gh_actions_runner",
    active_state: active,
    sub_state: active === "active" ? "running" : null,
    result: "success",
    restart_policy: "always",
    oom_policy: "continue",
    memory_max: null,
    memory_peak: 512 * 1024 ** 2,
    n_restarts: 0,
    state_changed_at: "2026-09-30T01:48:00Z",
    runner_name: "merytshost-1",
    repo: "qontinui-web",
    observed_at: "2026-09-30T11:59:00Z",
    // Coord's `service_is_down`.
    down: active === "failed" || active === "inactive",
    ...over,
  };
}

export function listFx(
  computers: ComputerSummaryWire[],
  over: Partial<ComputersListWire> = {}
): ComputersListWire {
  // Coord's `registrar_read_ok.then_some(...)`: a failed registrar read nulls
  // every runner list, on the body AND on each computer.
  const ok = over.registrar_read_ok ?? true;
  return {
    computers: ok
      ? computers
      : computers.map((c) => ({ ...c, ci_runners: null })),
    count: computers.length,
    unattributed_ci_runners: ok ? [] : null,
    ambiguous_ci_runners: ok ? [] : null,
    registrar_read_ok: ok,
    schema_pending: false,
    staleness: STALENESS,
    ...over,
  };
}

export function detailFx(
  over: Partial<ComputerDetailWire> & { report_age_secs?: number } = {},
  nowMs = Date.now()
): ComputerDetailWire {
  const { report_age_secs: _age, ...rest } = over;
  void _age;
  // Coord derives the three service counts from the stored rows; a fixture
  // that set them independently could describe a body coord never sends.
  const services = rest.services ?? [serviceFx()];
  const reported = rest.services_reported ?? true;
  const summary = computerFx(
    {
      ...over,
      services_reported: reported,
      services_total: reported ? services.length : 0,
      services_failed: reported ? services.filter((s) => s.down).length : 0,
    },
    nowMs
  );
  return {
    ...summary,
    services: reported ? services : [],
    events: [],
    events_window_days: 7,
    history: [],
    history_truncated: false,
    workloads: {
      devices: summary.devices,
      ci_runners: summary.ci_runners,
      agent_sessions: [{ device_id: DEVICE_ID, open_sessions: 2 }],
    },
    divergence: [],
    registrar_read_ok: true,
    schema_pending: false,
    staleness: STALENESS,
    ...rest,
    // Coord nulls the registrar-derived lists when its registrar read failed.
    ...(rest.registrar_read_ok === false
      ? {
          ci_runners: null,
          divergence: null,
          workloads: {
            devices: summary.devices,
            ci_runners: null,
            agent_sessions: [{ device_id: DEVICE_ID, open_sessions: 2 }],
          },
        }
      : {}),
    // Re-assert the derived fields over `rest`.
    services_reported: summary.services_reported,
    services_total: summary.services_total,
    services_failed: summary.services_failed,
  };
}
