/**
 * Fleet resource telemetry — wire types and the PURE helpers the strip
 * renders from.
 *
 * Plan: `2026-08-02-fleet-resource-telemetry-and-ci-allocation` §C1/§C2/§C3.
 *
 * ## The one thing this module deliberately does NOT do
 *
 * It does **not** compute lane pressure, and it does **not** decide where a
 * lane turns red. Both arrive from coord: `pressure` from
 * `device_resource_samples::lane_pressure` (the same function §B1's CI ranker
 * reads), and `headroom` from the floor coord's admission actually enforces.
 * The plan's thesis is *"if the dashboard says a machine is red, the
 * dispatcher must already have stopped sending it work"*, which is only true
 * while both consumers read ONE definition of **both** the number and the
 * verdict.
 *
 * ## Why there is no threshold constant here any more
 *
 * §C1 first shipped with `SATURATED_AT = 0.85` / `WARN_AT = 0.6` decided in
 * TypeScript while coord's real admission behaviour was **byte floors**. The
 * ratio was shared; the verdict was not — so the strip could render amber
 * while the ranker had already stopped electing the machine. Sharing the
 * number without the threshold is not sharing the decision.
 *
 * The floors cannot be re-expressed as a pressure threshold either: they are
 * on **different columns** (`commit_available` on host, `mem_available` on
 * wsl) from the ratio's divisors, so "a pressure threshold equivalent to a
 * 4 GiB mem-available floor" is a number nobody can compute without
 * fabricating one. So the server does not send a threshold — it sends the
 * **admission state** (`headroom`) derived from the floor applied to the
 * column that floor governs, plus the floor itself so an operator can see
 * why.
 *
 * **Pressure is the magnitude and the sparkline series. `headroom` is what
 * colours the row.** Two different questions — "how loaded is it?" and "will
 * it refuse work?" — that the constants above conflated into one arbitrary
 * band.
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

/**
 * The column a floor is measured on.
 *
 * This is the whole reason a floor cannot be re-expressed as a pressure
 * threshold: the host lane's pressure divides `commit_*`, the wsl lane's
 * divides `swap_*`, and the wsl floor is on `mem_available` — a third column
 * that appears in neither ratio.
 */
export type FloorBasis = "commit_available" | "mem_available" | "disk_free";

/**
 * What the lane does at its floor. **Not interchangeable**, and coord keeps
 * them apart on purpose: a `reject` fails the job now, a `defer` makes it
 * late. An operator reading "this machine is refusing work" needs to know
 * which.
 */
export type FloorVerdict = "reject" | "defer";

/**
 * A floor coord is actually enforcing for this lane, as reported per row.
 *
 * `source` distinguishes a tenant's configured value (§D1 policy) from the
 * built-in fallback. That matters operationally: "the box is below its floor"
 * has a different fix depending on whether somebody set that floor.
 */
export interface EffectiveFloor {
  basis: FloorBasis;
  bytes: number;
  source: "policy" | "default";
  verdict: FloorVerdict;
  /**
   * The threshold of the **rejecting** enforcer on the same column, when one
   * exists.
   *
   * A column can have two enforcers with deliberately different numbers: the
   * host commit column is guarded by the supervisor at 5 GiB (**defer**) and
   * by the runner's `ci_node` at 4 GiB (**reject**). The rejecting one sits
   * LOWER on purpose, so the deferring guard trips first and a recoverable
   * wait never becomes a failed build. Showing only one of them tells an
   * operator the wrong story about why a machine is refusing work.
   *
   * `null` = no rejecting enforcer governs this column. Rendered as "no
   * reject threshold" — never as 0, and never by falling back to `bytes`.
   * Absent = a coord that predates the field, rendered as "not reported".
   */
  reject_bytes?: number | null;
  /** Provenance of `reject_bytes`, on the same terms as `source`. */
  reject_source?: "policy" | "default" | null;
}

/**
 * The lane's admission state, **decided by the server against the floor it
 * enforces** — the field this whole surface colours from.
 *
 * `unknown` is a first-class value, not an error: a lane coord has no floor
 * opinion on (and any row from a coord that predates the sibling PR) is
 * unknown, and §C3's rule is that unknown renders like a stale or absent
 * sample — never green.
 */
export type Headroom = "ok" | "warn" | "breach" | "unknown";

/**
 * What each admission state MEANS to an operator, in words.
 *
 * `breach` and `warn` are materially different events, not two shades of one:
 * a breached lane **refuses** the work (the build fails now) while a warned
 * lane **waits** for headroom (the build is late). Colour alone cannot carry
 * that, and §C3 requires the operator to see whether the lane defers or
 * rejects at its floor — so the strip says it.
 */
export const HEADROOM_MEANING: Record<Headroom, string> = {
  ok: "above both floors — work is being accepted",
  warn: "at or below the deferring floor (or within the server's amber margin above it) — work waits for headroom rather than failing",
  breach:
    "at or below the rejecting floor — a guard is refusing work right now, so builds fail here",
  unknown:
    "no admission verdict for this lane. Absence of signal is not health.",
};

const HEADROOM_VALUES = new Set<string>(["ok", "warn", "breach", "unknown"]);

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
  /**
   * The memory floor this lane is admitted against. Optional on the wire:
   * absent from any coord that predates the §C3 floor-bands PR, and the
   * absence is rendered as `unknown`, never as "no floor".
   */
  floor?: EffectiveFloor | null;
  /** The disk floor. Split from `floor` because memory frees and disk does not. */
  disk_floor?: EffectiveFloor | null;
  /**
   * SERVER-decided admission state. The row's colour comes from THIS, not
   * from `pressure` — see the module header.
   */
  headroom?: Headroom | null;
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
  /**
   * The multiplier coord grades the amber band with: a lane is `warn` from
   * `margin x` the deferring floor downwards. **Read, never assumed** — a
   * hardcoded 1.5 here would be the client-side constant this whole change
   * deletes, wearing a different hat. Absent = not reported, and the strip
   * says so rather than naming a number coord did not send.
   */
  headroom_warn_margin?: number;
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

/**
 * Whether the lead column has a magnitude worth printing at all.
 *
 * Deliberately NOT a colour: the magnitude question ("how loaded is it?") and
 * the admission question ("will it refuse work?") were conflated by the
 * constants this replaces. `pressure` answers the first and is rendered in
 * neutral type; `headroom` answers the second and is what carries tone.
 */
export function hasPressureValue(
  freshness: Freshness,
  pressure: LanePressure | null | undefined
): pressure is LanePressure {
  return (
    freshness !== "unknown" && !!pressure && Number.isFinite(pressure.ratio)
  );
}

// ---------------------------------------------------------------------------
// Admission — the VERDICT, which the server owns end to end
// ---------------------------------------------------------------------------

export type RowTone = "ok" | "warn" | "critical" | "unknown";

/**
 * The row's admission state, normalized.
 *
 * Anything the server did not say — field absent (coord predates the floor
 * PR), `null`, or a value this build does not recognize (coord ahead of this
 * build) — is `unknown`. Never `ok`: a client that reads silence as "fine" is
 * the false-safe §C3 exists to forbid, and it is exactly how a not-yet-deployed
 * server would have painted the whole fleet green.
 */
export function rowHeadroom(
  row: Pick<ResourceSampleRow, "headroom"> | null | undefined
): Headroom {
  const h = row?.headroom;
  if (typeof h !== "string" || !HEADROOM_VALUES.has(h)) return "unknown";
  return h as Headroom;
}

/**
 * Why a row reads `unknown`, for the operator-facing explanation.
 *
 * The three cases have different fixes and must not share one sentence:
 * `absent` is a coord that predates the field, `unrecognized` is a coord
 * AHEAD of this build, and `recognized` is coord itself saying it has no
 * opinion. All three still render unknown — this only picks the wording.
 */
export function headroomReport(
  row: Pick<ResourceSampleRow, "headroom"> | null | undefined
): "absent" | "recognized" | "unrecognized" {
  const h = row?.headroom;
  if (h == null) return "absent";
  if (typeof h === "string" && HEADROOM_VALUES.has(h)) return "recognized";
  return "unrecognized";
}

/**
 * Tone for the row — **derived from the server's admission verdict, never
 * from the pressure ratio.**
 *
 * Freshness still dominates: a stale or absent sample is `unknown` whatever
 * its last verdict was, because coord computed that verdict against numbers
 * that have stopped being true.
 */
export function headroomTone(
  freshness: Freshness,
  headroom: Headroom
): RowTone {
  if (freshness !== "fresh") return "unknown";
  switch (headroom) {
    case "breach":
      return "critical";
    case "warn":
      return "warn";
    case "ok":
      return "ok";
    default:
      return "unknown";
  }
}

/**
 * Short operator-facing name for an admission state — in the VERB of what
 * happens to the work, because that is the difference `breach` and `warn` now
 * carry: refused vs delayed.
 */
export const HEADROOM_LABEL: Record<Headroom, string> = {
  ok: "accepting work",
  warn: "work waits",
  breach: "work refused",
  unknown: "unknown",
};

export const FLOOR_VERDICT_LABEL: Record<FloorVerdict, string> = {
  reject: "rejects",
  defer: "defers",
};

export const FLOOR_VERDICT_HINT: Record<FloorVerdict, string> = {
  reject: "hard-refuses the job outright — the work fails now",
  defer:
    "holds the work until the resource frees — the work is late, not failed",
};

export const FLOOR_BASIS_LABEL: Record<FloorBasis, string> = {
  commit_available: "free commit",
  mem_available: "available memory",
  disk_free: "free disk",
};

/**
 * The server's amber margin as `"x1.5"`, or `"not reported"`.
 *
 * A separate function only so the "we did not get one" case cannot be
 * silently rendered as a plausible default.
 */
export function formatWarnMargin(margin: number | null | undefined): string {
  if (margin == null || !Number.isFinite(margin) || margin <= 0) {
    return "not reported";
  }
  return `x${margin}`;
}

/** `"4.0 GB free commit"` — the floor's value and the column it is measured on. */
export function formatFloor(floor: EffectiveFloor | null | undefined): string {
  if (!floor || !Number.isFinite(floor.bytes) || floor.bytes < 0) {
    return "unknown";
  }
  const basis = FLOOR_BASIS_LABEL[floor.basis] ?? floor.basis;
  return `${formatBytes(floor.bytes)} ${basis}`;
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

export interface FleetAdmissionSummary {
  /** Fresh lanes the SERVER says are at or below their floor. */
  breach: number;
  /** Fresh lanes the server says are approaching their floor. */
  warn: number;
  /** Lanes whose newest sample has stopped being current. */
  stale: number;
  /**
   * Lanes (or whole machines) with no usable sample, and fresh lanes coord
   * reports no admission state for. Counted separately from `breach` because
   * it is a different claim — not healthy, and not known to be refusing work.
   */
  unknown: number;
}

/**
 * The counts the page hoists onto the collapsed "System details" header.
 *
 * Hoisted for the same reason the unhealthy-machine count already is: a red
 * fleet state must not hide behind a click. A machine that has stopped
 * accepting work is a red fleet state — it is the one this plan was written
 * after.
 *
 * Counted from `headroom`, the same verdict the row is coloured from and the
 * same one the dispatcher acts on, so the header and the table can never
 * disagree — and neither can disagree with coord.
 *
 * `unknown` is reported alongside rather than folded into either bucket. It
 * is neither "fine" nor "breaching", and collapsing it into the first is
 * precisely the false-safe §C3 forbids.
 */
export function summarizeFleetAdmission(
  devices: FleetDeviceRef[],
  latest: ResourceSampleRow[],
  sinceFetchSecs = 0
): FleetAdmissionSummary {
  const summary: FleetAdmissionSummary = {
    breach: 0,
    warn: 0,
    stale: 0,
    unknown: 0,
  };
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
      switch (rowHeadroom(row.sample)) {
        case "breach":
          summary.breach += 1;
          break;
        case "warn":
          summary.warn += 1;
          break;
        case "ok":
          break;
        default:
          summary.unknown += 1;
      }
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Effective floors — §C3's last requirement, now READ rather than declared
// ---------------------------------------------------------------------------
//
// This module used to carry a `LANE_FLOORS` table of documented constants
// transcribed out of the publishers' source (5 GiB free commit, 4 GiB sysinfo
// available memory, …). It is gone: coord now reports the floor it is
// ACTUALLY enforcing per row (`floor` / `disk_floor`), and a transcribed
// constant beside a reported one is a second source of truth that drifts
// silently the first time somebody edits the real one. Whatever this surface
// says about a floor now comes from the same place the admission decision
// does.
//
// Where coord reports no floor, the row says so — see `describeFloor`.

export interface FloorDetail {
  /** `"4.0 GB free commit"`. */
  value: string;
  /** Normalized verdict, or `"unknown"` when this build does not know it. */
  verdict: FloorVerdict | "unknown";
  /** What to print for the verdict — the label, or the raw string. */
  verdictLabel: string;
  /** Normalized provenance, or `"unknown"`. */
  source: "policy" | "default" | "unknown";
  sourceLabel: string;
  /**
   * The SECOND enforcer on the same column — the one that refuses rather
   * than waits.
   *
   * `"present"` carries its own value and provenance. `"none"` means coord
   * said there is no rejecting enforcer here; `"not-reported"` means coord
   * never mentioned one (an older coord). The three are kept apart because
   * "nothing refuses work on this column" and "nobody told us" are different
   * claims, and only the first is safe to act on.
   */
  reject:
    | {
        kind: "present";
        value: string;
        source: "policy" | "default" | "unknown";
        sourceLabel: string;
      }
    | { kind: "none" }
    | { kind: "not-reported" };
}

function normalizeSource(raw: unknown): {
  source: "policy" | "default" | "unknown";
  label: string;
} {
  if (raw === "policy" || raw === "default") return { source: raw, label: raw };
  return { source: "unknown", label: `source unknown (${String(raw)})` };
}

/**
 * One line of floor detail for a row, or `null` when coord reported none.
 *
 * `null` is the pre-deployment state and is rendered as an explicit
 * "not reported", never as "no floor" — a lane with no stated floor reads as
 * unconstrained, which is the false-safe in the other direction.
 *
 * ## Why the enums are whitelisted at runtime
 *
 * `verdict` and `source` are JSON, not TypeScript. An unrecognized `verdict`
 * must NOT fall into the `defer` arm: this field's previous spelling was
 * `"rejects"`/`"defers"` and carried a third value, so a coord one version off
 * would have told an operator that a hard-refusing lane merely waits — the
 * same false-safe this whole change exists to remove, one field over. Same
 * for `source`: silence about who set a number is not "coord's default".
 *
 * Unrecognized values are surfaced as `unknown` WITH the raw string, so the
 * operator sees that something was reported and that this build could not
 * read it, rather than a confidently wrong word.
 */
export function describeFloor(
  floor: EffectiveFloor | null | undefined
): FloorDetail | null {
  // A negative floor is not a small floor; it is a corrupt one, and
  // `Number.isFinite(-1)` would let it print as "-1.0 B free commit".
  if (!floor || !Number.isFinite(floor.bytes) || floor.bytes < 0) return null;
  const verdict: FloorVerdict | "unknown" =
    floor.verdict === "reject" || floor.verdict === "defer"
      ? floor.verdict
      : "unknown";
  const src = normalizeSource(floor.source);

  // Three-way, not two: `undefined` is "an older coord never mentioned a
  // rejecting enforcer" and `null` is "coord says there is none". Collapsing
  // them would let a silent coord read as a column nothing refuses work on.
  let reject: FloorDetail["reject"];
  if (floor.reject_bytes === undefined) {
    reject = { kind: "not-reported" };
  } else if (
    floor.reject_bytes === null ||
    !Number.isFinite(floor.reject_bytes) ||
    floor.reject_bytes < 0
  ) {
    reject = { kind: "none" };
  } else {
    const rsrc = normalizeSource(floor.reject_source);
    reject = {
      kind: "present",
      value: formatFloor({ ...floor, bytes: floor.reject_bytes }),
      source: rsrc.source,
      sourceLabel: rsrc.label,
    };
  }

  return {
    value: formatFloor(floor),
    verdict,
    verdictLabel:
      verdict === "unknown"
        ? `verdict unknown (${String(floor.verdict)})`
        : FLOOR_VERDICT_LABEL[verdict],
    source: src.source,
    sourceLabel: src.label,
    reject,
  };
}
