/**
 * Fleet resource telemetry — wire types and the PURE helpers the strip
 * renders from.
 *
 * Plan: `2026-08-02-fleet-resource-telemetry-and-ci-allocation` §C1/§C2/§C3.
 *
 * ## The one thing this module deliberately does NOT do
 *
 * It does **not** compute lane pressure. `pressure` arrives already computed
 * from coord (`device_resource_samples::lane_pressure`) — the same function
 * §B1's CI ranker reads. The plan's thesis is *"if the dashboard says a
 * machine is red, the dispatcher must already have stopped sending it work"*,
 * which is only true while both consumers read ONE definition. Deriving the
 * ratio again in TypeScript reintroduces exactly the drift §C0 exists to
 * prevent, so everything here treats `pressure` as opaque input: it labels
 * it, tones it, and marks it stale — it never recalculates it.
 *
 * Everything below is pure and unit-tested (`fleetResources.test.ts`) so the
 * §C3 honesty rules are assertable without a DOM.
 */

// ---------------------------------------------------------------------------
// Wire types — mirror coord's `device_resource_samples` serde shapes exactly
// ---------------------------------------------------------------------------

/** Which instrument produced a pressure ratio. Server-decided, per lane. */
export type PressureBasis = "swap" | "commit";

/**
 * A lane's normalized saturation in [0, 1], with the instrument that produced
 * it. Carried together because a `wsl` row's 0.31 and a `host` row's 0.31 are
 * different measurements — a lead column that silently means two things
 * across rows is the confidently-wrong dashboard this plan exists to end.
 */
export interface LanePressure {
  ratio: number;
  basis: PressureBasis;
}

export type Lane = "host" | "wsl" | "container";

/** Newest sample for one `(device_id, lane, lane_instance)` anchor. */
export interface ResourceSampleRow {
  device_id: string;
  lane: string;
  /** null = the sole publisher for this lane (runner/supervisor case). */
  lane_instance: string | null;
  sampled_at: string;
  /** Seconds since `sampled_at`, computed by Postgres in the same statement. */
  age_secs: number;
  cpu_cores: number | null;
  load_1m: number | null;
  mem_total_bytes: number | null;
  mem_available_bytes: number | null;
  commit_total_bytes: number | null;
  commit_available_bytes: number | null;
  swap_total_bytes: number | null;
  swap_used_bytes: number | null;
  disk_total_bytes: number | null;
  disk_free_bytes: number | null;
  disk_mount: string | null;
  build_slots_total: number | null;
  build_slots_busy: number | null;
  build_queue_depth: number | null;
  ci_jobs_running: number | null;
  source: string;
  /** SERVER-computed. `null` = the lane has no pressure opinion. */
  pressure: LanePressure | null;
}

export interface HistoryPoint {
  sampled_at: string;
  /** The server's pressure ratio at this instant; null = no opinion. */
  pressure: number | null;
  disk_free_bytes: number | null;
  disk_total_bytes: number | null;
  build_slots_busy: number | null;
  build_slots_total: number | null;
  ci_jobs_running: number | null;
}

export interface HistorySeries {
  device_id: string;
  lane: string;
  lane_instance: string | null;
  /** Carried on the SERIES: a lane property, not a per-point one. */
  pressure_basis: PressureBasis | null;
  points: HistoryPoint[];
}

export interface ResourceSamplesResponse {
  latest?: ResourceSampleRow[];
  count?: number;
  history?: HistorySeries[];
  /** EFFECTIVE window after coord's clamp — not necessarily what we asked. */
  window_secs?: number;
  latest_lookback_secs?: number;
  history_points_per_anchor?: number;
  /** The whole-response row cap was hit, so some series is short. */
  history_truncated?: boolean;
  /** The sibling alembic migration has not reached coord's DB yet. */
  schema_pending?: boolean;
}

// ---------------------------------------------------------------------------
// The anchor
// ---------------------------------------------------------------------------

/**
 * `(device_id, lane, COALESCE(lane_instance, ''))` — the migration's index
 * expression, and coord's `ANCHOR_SQL`, spelled in TypeScript.
 *
 * `lane_instance` is null for the COMMON case (every runner and supervisor
 * sample), so anything that keys on the raw nullable value joins `latest` to
 * `history` for the CI publishers only and silently drops everything else.
 */
export function anchorKey(
  deviceId: string,
  lane: string,
  laneInstance: string | null | undefined
): string {
  return `${deviceId}|${lane}|${laneInstance ?? ""}`;
}

export function rowAnchor(row: {
  device_id: string;
  lane: string;
  lane_instance: string | null;
}): string {
  return anchorKey(row.device_id, row.lane, row.lane_instance);
}

// ---------------------------------------------------------------------------
// Freshness — §C3: "a stale sample must render as stale, not as its last value"
// ---------------------------------------------------------------------------

/**
 * A sample older than this is STALE. Four times the runner's 30 s publish
 * cadence, so three consecutive missed ticks are needed to trip it — long
 * enough not to flicker, short enough that the 2026-08-02 misdiagnosis
 * (trusting a number that had stopped being true) would have shown up.
 */
export const STALE_AFTER_SECS = 120;

/**
 * A sample this old is not worth showing a value for at all — beyond coord's
 * own 6 h `LATEST_LOOKBACK_FLOOR_SECS` the row would not be returned anyway,
 * and well before that "last known" stops being a useful anchor.
 */
export const EXPIRED_AFTER_SECS = 21_600;

export type Freshness =
  /** Sample within `STALE_AFTER_SECS` — the value is current. */
  | "fresh"
  /** Sample exists but has stopped being true. Value shown, demoted. */
  | "stale"
  /**
   * No sample at all (or one so old it carries no information). §C3: this
   * renders as UNKNOWN, never as healthy — absence of signal is not health.
   */
  | "unknown";

/**
 * A row's TRUE age now: what the server measured, plus how long ago we heard
 * it.
 *
 * `age_secs` is computed by Postgres at query time and then frozen inside the
 * payload. If the proxy starts failing, the last good payload keeps saying
 * `age_secs: 15` forever — so every row would stay green through an outage of
 * any length. That is *literally* the failure §C3 was written after: trusting
 * a number that had stopped being true.
 *
 * `sinceFetchSecs` is wall-clock elapsed since the payload arrived, so a fleet
 * whose telemetry has gone dark crosses the stale threshold on its own,
 * whether the silence is coord's, the publisher's, or this proxy's. The
 * server timestamp still does the work — the browser clock only measures an
 * *interval*, never an absolute time, so no clock skew is reintroduced.
 */
export function effectiveAgeSecs(
  row: Pick<ResourceSampleRow, "age_secs"> | null | undefined,
  sinceFetchSecs = 0
): number | null {
  if (!row || !Number.isFinite(row.age_secs)) return null;
  const elapsed = Number.isFinite(sinceFetchSecs)
    ? Math.max(0, sinceFetchSecs)
    : 0;
  return row.age_secs + elapsed;
}

export function classifyFreshness(
  row: Pick<ResourceSampleRow, "age_secs"> | null | undefined,
  sinceFetchSecs = 0
): Freshness {
  const age = effectiveAgeSecs(row, sinceFetchSecs);
  if (age == null) return "unknown";
  if (age > EXPIRED_AFTER_SECS) return "unknown";
  if (age > STALE_AFTER_SECS) return "stale";
  return "fresh";
}

// ---------------------------------------------------------------------------
// Pressure presentation — label it, tone it, NEVER recompute it
// ---------------------------------------------------------------------------

/** Short column label for the instrument a row's pressure came from. */
export function pressureLabel(basis: PressureBasis): string {
  return basis === "swap" ? "swap used" : "commit used";
}

/**
 * The formula, spelled out. §C1 requires the row to say WHICH metric it is
 * showing: the lead column means `swap_used/swap_total` on `wsl`/`container`
 * and `1 − commit_available/commit_total` on `host`, and a strip that hides
 * that is a new version of the dashboard this plan exists to end.
 */
export function pressureFormula(basis: PressureBasis): string {
  return basis === "swap"
    ? "swap_used / swap_total"
    : "1 − commit_available / commit_total";
}

/**
 * Whether a lane may show a swap figure AT ALL.
 *
 * Never on `host`. Both publishers withhold `swap_*` on Windows because
 * sysinfo derives it algebraically from the same commit counters
 * (`swap_total − swap_used ≡ commit_available − phys_available`), so a swap
 * column beside a commit column on one row reads as corroboration from two
 * instruments when it is one instrument printed twice.
 */
export function laneShowsSwap(lane: string): boolean {
  return lane !== "host";
}

export type PressureTone = "ok" | "warn" | "critical" | "unknown";

/**
 * Ratio at or above which a lane reads RED.
 *
 * **A stated bound, because it is the one thing on this surface that coord
 * does not define.** The *ratio* is server-computed and shared with §B1's
 * ranker, which is what the plan's thesis requires — but where that ratio
 * turns red is decided here, while coord's actual admission behaviour is the
 * GiB floors in `LANE_FLOORS`. So "the dashboard says red" and "the
 * dispatcher stopped sending work" are pinned together on the *ordering* and
 * can still disagree at the exact boundary. Closing that needs the threshold
 * to come from the server too (§A3 step 3's per-device floor report is where
 * it would land). Until then the floors panel is on the page precisely so an
 * operator can see the real rule beside this approximation.
 */
export const SATURATED_AT = 0.85;

/** Ratio at or above which a lane reads amber. Same caveat as above. */
export const WARN_AT = 0.6;

/**
 * Tone for the lead column. Freshness dominates: a stale or absent sample is
 * `unknown` **whatever its last ratio was**, because a green cell sourced
 * from a number that stopped being true is the exact failure §C3 forbids.
 * `pressure === null` ("no server opinion") is also `unknown` — never 0, and
 * never green.
 */
export function pressureTone(
  freshness: Freshness,
  pressure: LanePressure | null | undefined
): PressureTone {
  if (freshness !== "fresh") return "unknown";
  if (!pressure || !Number.isFinite(pressure.ratio)) return "unknown";
  if (pressure.ratio >= SATURATED_AT) return "critical";
  if (pressure.ratio >= WARN_AT) return "warn";
  return "ok";
}

// ---------------------------------------------------------------------------
// Ratios — §C1: "as a ratio against its own ceiling, never a bare megabyte"
// ---------------------------------------------------------------------------

/** `part / whole` in [0, 1], or null when either side is missing/zero. */
export function safeRatio(
  part: number | null | undefined,
  whole: number | null | undefined
): number | null {
  if (part == null || whole == null) return null;
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, part / whole));
}

export function formatPercent(ratio: number | null | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${Math.round(ratio * 100)}%`;
}

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

/** Human byte count. Only ever used ALONGSIDE a ratio, never instead of one. */
export function formatBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const neg = n < 0;
  let v = Math.abs(n);
  let u = 0;
  while (v >= 1024 && u < UNITS.length - 1) {
    v /= 1024;
    u += 1;
  }
  const s = v >= 100 || u === 0 ? v.toFixed(0) : v.toFixed(1);
  return `${neg ? "-" : ""}${s} ${UNITS[u]}`;
}

/** `free / total` rendered as "12.3 GB / 100 GB (12%)". */
export function formatRatioOfCeiling(
  part: number | null | undefined,
  whole: number | null | undefined
): string {
  const r = safeRatio(part, whole);
  if (r == null) return "—";
  return `${formatBytes(part)} / ${formatBytes(whole)} (${formatPercent(r)})`;
}

export function formatAge(secs: number | null | undefined): string {
  if (secs == null || !Number.isFinite(secs)) return "unknown";
  if (secs < 60) return `${Math.max(0, Math.round(secs))}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// The coupled WSL lane — §C3 / honest bound #1
// ---------------------------------------------------------------------------

/**
 * WSL headroom that can ACTUALLY be spent, given the host lane on the same
 * machine.
 *
 * `.wslconfig` sets `pageReporting=true`, so WSL returns idle pages to
 * Windows and `memory=<N>GB` is a *ceiling*, not a reservation. The lanes are
 * coupled: real WSL headroom is `min(ceiling − used, host_free)`. A WSL row
 * reading "9 GB free" beside a host at 900 MB free commit — the literal
 * 2026-08-02 state — is showing memory that cannot be spent.
 *
 * Returns `null` when either side is missing: a coupled figure derived from
 * one half is not a coupled figure, and guessing the other half would be the
 * fabrication this whole surface exists to avoid.
 */
export function coupledWslHeadroomBytes(
  wslRow: Pick<ResourceSampleRow, "mem_available_bytes"> | null | undefined,
  hostRow: Pick<ResourceSampleRow, "commit_available_bytes"> | null | undefined
): number | null {
  const wslFree = wslRow?.mem_available_bytes;
  const hostFree = hostRow?.commit_available_bytes;
  if (wslFree == null || hostFree == null) return null;
  if (!Number.isFinite(wslFree) || !Number.isFinite(hostFree)) return null;
  return Math.min(wslFree, hostFree);
}

/** True when the host lane is the binding constraint on this WSL lane. */
export function hostIsBindingConstraint(
  wslRow: Pick<ResourceSampleRow, "mem_available_bytes"> | null | undefined,
  hostRow: Pick<ResourceSampleRow, "commit_available_bytes"> | null | undefined
): boolean {
  const wslFree = wslRow?.mem_available_bytes;
  const hostFree = hostRow?.commit_available_bytes;
  if (wslFree == null || hostFree == null) return false;
  return hostFree < wslFree;
}

// ---------------------------------------------------------------------------
// Row assembly — devices with no sample must still appear, as UNKNOWN
// ---------------------------------------------------------------------------

export interface FleetDeviceRef {
  device_id: string;
  hostname?: string;
  state?: string;
}

/** One rendered line of the strip. */
export interface StripRow {
  key: string;
  deviceId: string;
  /** hostname when coord knows one, device_id otherwise (§C2's join key). */
  displayName: string;
  lane: string | null;
  laneInstance: string | null;
  freshness: Freshness;
  /** null for a device that reported nothing at all. */
  sample: ResourceSampleRow | null;
  /** The `host` lane row for this same device, when one exists. */
  hostSample: ResourceSampleRow | null;
}

/** One machine's block: its display name plus its per-lane rows. */
export interface MachineGroup {
  deviceId: string;
  displayName: string;
  state?: string;
  rows: StripRow[];
}

/**
 * Join coord's device list to the samples.
 *
 * The device list is the spine on purpose. §C3: *a machine with no recent
 * sample renders `unknown`, never `healthy`* — a machine that simply vanishes
 * from the table is indistinguishable from one that was never registered, and
 * that is the six-day-silent-lane failure mode. So every known device gets a
 * block; one with no sample gets a single `unknown` row.
 *
 * Devices are keyed on hostname with `device_id` as fallback, matching
 * `useDeviceStatusStream`, so this joins cleanly to `MachineCard`'s grouping.
 *
 * A sample whose `device_id` is not in the device list is still rendered
 * (under its raw id) rather than dropped: silently discarding a machine that
 * is publishing capacity would be the same class of lie in the other
 * direction.
 */
export function buildMachineGroups(
  devices: FleetDeviceRef[],
  latest: ResourceSampleRow[],
  /** Wall-clock seconds since `latest` arrived — see `effectiveAgeSecs`. */
  sinceFetchSecs = 0
): MachineGroup[] {
  const byDevice = new Map<string, ResourceSampleRow[]>();
  for (const row of latest) {
    const list = byDevice.get(row.device_id);
    if (list) list.push(row);
    else byDevice.set(row.device_id, [row]);
  }

  const known = new Map<string, FleetDeviceRef>();
  for (const d of devices) known.set(d.device_id, d);
  // Samples from devices coord's health list does not carry.
  for (const deviceId of byDevice.keys()) {
    if (!known.has(deviceId)) known.set(deviceId, { device_id: deviceId });
  }

  const groups: MachineGroup[] = [];
  for (const [deviceId, device] of known) {
    const displayName = device.hostname || deviceId;
    const samples = (byDevice.get(deviceId) ?? [])
      .slice()
      .sort(
        (a, b) =>
          a.lane.localeCompare(b.lane) ||
          (a.lane_instance ?? "").localeCompare(b.lane_instance ?? "")
      );
    const hostSample = samples.find((s) => s.lane === "host") ?? null;

    const rows: StripRow[] =
      samples.length > 0
        ? samples.map((s) => ({
            key: rowAnchor(s),
            deviceId,
            displayName,
            lane: s.lane,
            laneInstance: s.lane_instance,
            freshness: classifyFreshness(s, sinceFetchSecs),
            sample: s,
            hostSample,
          }))
        : [
            {
              key: `${deviceId}|—`,
              deviceId,
              displayName,
              lane: null,
              laneInstance: null,
              freshness: "unknown",
              sample: null,
              hostSample: null,
            },
          ];

    groups.push({ deviceId, displayName, state: device.state, rows });
  }

  groups.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return groups;
}

export interface FleetPressureSummary {
  /** Fresh lanes at or above `SATURATED_AT`. */
  saturated: number;
  /** Lanes whose newest sample has stopped being current. */
  stale: number;
  /**
   * Lanes (or whole machines) with no usable sample, and fresh lanes the
   * server has no pressure opinion on. Counted separately from `saturated`
   * because it is a different claim — not healthy, and not known to be red.
   */
  unknown: number;
}

/**
 * The counts the page hoists onto the collapsed "System details" header.
 *
 * Hoisted for the same reason the unhealthy-machine count already is: a red
 * fleet state must not hide behind a click. A saturated machine is a red
 * fleet state — it is the one this plan was written after.
 *
 * `unknown` is reported alongside rather than folded into either bucket. It
 * is neither "fine" nor "saturated", and collapsing it into the first is
 * precisely the false-safe §C3 forbids.
 */
export function summarizeFleetPressure(
  devices: FleetDeviceRef[],
  latest: ResourceSampleRow[],
  sinceFetchSecs = 0
): FleetPressureSummary {
  const summary: FleetPressureSummary = { saturated: 0, stale: 0, unknown: 0 };
  for (const group of buildMachineGroups(devices, latest, sinceFetchSecs)) {
    for (const row of group.rows) {
      if (row.freshness === "unknown") {
        summary.unknown += 1;
        continue;
      }
      if (row.freshness === "stale") {
        summary.stale += 1;
        continue;
      }
      const p = row.sample?.pressure;
      if (!p || !Number.isFinite(p.ratio)) {
        summary.unknown += 1;
      } else if (p.ratio >= SATURATED_AT) {
        summary.saturated += 1;
      }
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Effective floors — §C3's last requirement
// ---------------------------------------------------------------------------

/**
 * What a lane does when it hits its floor. These are NOT interchangeable and
 * §A3 keeps them deliberately split: memory frees on its own, disk does not.
 */
export type FloorVerdict = "defers" | "rejects" | "warns";

export interface LaneFloor {
  /** Which lane's guard this is. */
  lane: string;
  /** Human name of the guard. */
  guard: string;
  /** The FIELD it measures — the whole point of §A3 is that these differ. */
  quantity: string;
  threshold: string;
  verdict: FloorVerdict;
  /** Where the constant lives, so the number is checkable. */
  source: string;
}

/**
 * The effective floors, as documented constants read out of the publishers'
 * source.
 *
 * **Provenance, stated because it matters:** these are NOT read live off each
 * machine. §A3's step 3 ("`GET /coord/fleet` reports all three effective
 * floors per device") has not landed, so nothing on the wire carries them
 * yet. Presenting them as live per-device state would be exactly the
 * fabricated-state trap this plan flags elsewhere — the panel labels them as
 * documented constants and cites each source, and the moment coord reports
 * them per device this table is replaced by that read.
 *
 * The divergences are shown rather than smoothed over: `ci_node` guards a
 * DIFFERENT quantity (`sysinfo` available memory) at a DIFFERENT number (4
 * GiB) from the supervisor's free-commit 5 GiB, and it **rejects** where the
 * supervisor **defers**. That divergence is the live drift §A3 exists to
 * converge; hiding it behind one tidy number would be the third false parity
 * claim in this fleet.
 */
export const LANE_FLOORS: LaneFloor[] = [
  {
    lane: "host",
    guard: "supervisor build pool",
    quantity: "free commit (Win32_OperatingSystem.FreeVirtualMemory)",
    threshold: "5 GiB",
    verdict: "defers",
    source: "qontinui-supervisor config.rs DEFAULT_MIN_FREE_RAM_GB",
  },
  {
    lane: "host",
    guard: "supervisor disk guard",
    quantity: "free disk on the build volume",
    threshold: "30 GiB",
    verdict: "rejects",
    source: "qontinui-supervisor config.rs DEFAULT_MIN_FREE_DISK_GB",
  },
  {
    lane: "host",
    guard: "cargo-guard.sh (agent lane)",
    quantity: "free commit (same counter as the supervisor)",
    threshold: "5 GiB",
    verdict: "warns",
    source: "qontinui-claude-config cargo-guard.sh MIN_FREE_GB",
  },
  {
    lane: "wsl",
    guard: "runner ci_node admission",
    quantity: "sysinfo available memory — NOT free commit",
    threshold: "4 GiB",
    verdict: "rejects",
    source: "qontinui-runner ci_node/admission.rs MIN_FREE_RAM_GB",
  },
  {
    lane: "wsl",
    guard: "runner ci_node disk admission",
    quantity: "free disk on the QONTINUI_ROOT volume",
    threshold: "ci_node.min_free_disk_gb (configurable; 20 GiB in tests)",
    verdict: "rejects",
    source: "qontinui-runner ci_node/admission.rs",
  },
];

export function floorsForLane(lane: string | null): LaneFloor[] {
  if (!lane) return [];
  // `container` shares the ci_node guards with `wsl` — both are the Linux
  // executor lane; `host` is the Windows build/agent lane.
  const key = lane === "container" ? "wsl" : lane;
  return LANE_FLOORS.filter((f) => f.lane === key);
}

export const FLOOR_VERDICT_HINT: Record<FloorVerdict, string> = {
  defers: "waits for memory to free, then proceeds",
  rejects: "hard-refuses the job outright",
  warns: "logs and proceeds anyway",
};
