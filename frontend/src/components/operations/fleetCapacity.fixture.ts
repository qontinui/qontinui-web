/**
 * Coord's capacity read as `GET /coord/fleet/capacity/operator` serves it
 * (`fleet_placement::capacity_read`, model v3), for the Capacity panel's
 * tests. Shapes follow coord's serde exactly: `Known<T>` is
 * `{"state":"known","value":…}` / `{"state":"unknown","reason":…}`, and
 * per-class values are keyed `S`, `C3`, `C1`, `C2`, `B`.
 */

const CLASSES = ["S", "C3", "C1", "C2", "B"] as const;

function cost(basis: string, unit: "cores" | "bytes", value: number) {
  return {
    value,
    unit,
    n: basis === "seed" ? 0 : 40,
    basis,
    reason: basis === "device_p90" ? null : "too few samples on this device",
  };
}

/** One device row; `over` replaces top-level fields. */
export function capacityDevice(
  over: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    device_id: "d0d0d0d0-0000-4000-8000-000000000001",
    machine_key: "nilan",
    label: "nilan",
    agent_lane: { state: "open" },
    latest_row_source: "runner",
    sample_age_s: 42,
    free_cpu_cores: { state: "known", value: 6.5 },
    free_mem_bytes: { state: "known", value: 12 * 1024 ** 3 },
    binding: { S: "cpu", C3: "memory", C1: "cpu", C2: "cpu", B: null },
    disk: "out_of_scope",
    slots: {
      S: { state: "known", value: 3 },
      C3: { state: "known", value: 2 },
      C1: { state: "known", value: 1 },
      C2: { state: "known", value: 1 },
      B: { state: "known", value: 0 },
    },
    costs: Object.fromEntries(
      CLASSES.map((c) => [
        c,
        {
          cpu_cores: cost(c === "S" ? "device_p90" : "seed", "cores", 1.5),
          mem_bytes: cost(c === "S" ? "device_p90" : "seed", "bytes", 2 ** 31),
        },
      ])
    ),
    basis: { free_cpu: "psi", free_mem: "available_minus_floor" },
    session_gate: null,
    unknown_reason: [],
    parity: [
      {
        row: 1,
        decider: "derive_max_agents",
        answer: { state: "known", value: 4 },
      },
      {
        row: 9,
        decider: "runner resource_guard",
        answer: {
          state: "runner_local",
          detail: "runner commit floors",
          observed: { commit_free_gib: 9.1 },
        },
      },
      {
        row: 12,
        decider: "merge train cap",
        answer: { state: "unknown", reason: "no merge-scheduler snapshot" },
      },
    ],
    ...over,
  };
}

/** A whole `state: "known"` answer. */
export function capacityBody(
  devices: Record<string, unknown>[]
): Record<string, unknown> {
  return {
    state: "known",
    model_version: 3,
    plan: { id: 7, computed_at: "2026-11-22T10:00:00Z", age_secs: 120 },
    cache_age_secs: 3,
    devices,
  };
}
