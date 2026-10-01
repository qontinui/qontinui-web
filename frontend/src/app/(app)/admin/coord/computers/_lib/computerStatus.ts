/**
 * `/admin/coord/computers` — the wire shapes coord's computer reads serve, and
 * every PURE derivation the list and detail pages render from.
 *
 * Plan `2026-09-30-the-fleet-machine-is-not-a-first-class-coord-entity-and-coord-
 * has-no-resource-model` Phase 5, built against the plan's shared contract §4
 * (`GET /coord/computers`, `GET /coord/computers/:computer_id`), which Phase 3
 * implements in qontinui-coord. The reads arrive through the web backend's
 * `/api/v1/operations/computers[/{id}]` passthrough proxies — never from the
 * browser to coord directly (the `DeviceStatusTile` incident: an anonymous
 * coord read went operator-auth fail-closed and SILENTLY EMPTIED).
 *
 * ## The rule this module exists to hold (plan §3.5, "data availability")
 *
 * 1. **Absence is UNKNOWN, never healthy.** A computer whose last report is
 *    older than 3 × its 300 s cadence is `stale`, with its age; one with no
 *    freshness at all is `unknown`. Neither is ever painted calm.
 * 2. **A stale number is never rendered as current.** Every reading carries
 *    whether it is current; the pages label a stale one "last known …" and
 *    never put it in a "now" slot.
 * 3. **A field never measured renders `unknown`; an axis the publisher says it
 *    cannot measure renders `not supported`** (and `unavailable` as such).
 *    `null` is never `0`.
 *
 * ## The wire is coord's, exactly
 *
 * The types below mirror `qontinui-coord/crates/coord/src/computers.rs`
 * (`ComputerSummary`, `LaneRollup`, `ComputerDetail`, `list_body`) field for
 * field, with no alternate spellings. Coord computes every freshness verdict
 * (`freshness.state`, each lane's `freshness.state`, `samples_state`); this
 * module never upgrades one, and only ever makes it WORSE by adding the time
 * since this page's read landed to coord's frozen `age_secs`.
 *
 * Everything below is pure and unit-tested (`computerStatus.test.ts`).
 */

import {
  AUTHOR_RED,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  type AttentionMap,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";
import { classifyCoordError } from "@/components/operations/coordPollError";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  formatAge,
  formatBytes,
  formatPercent,
} from "@/components/operations/fleetResources";

// ---------------------------------------------------------------------------
// Cadence — the contract's §4 staleness rule, as numbers
// ---------------------------------------------------------------------------

/** The runner posts a full computer snapshot every 300 s (contract §3). */
export const COMPUTER_REPORT_CADENCE_SECS = 300;
/** Stale after 3 × the report cadence (contract §4). */
export const COMPUTER_STALE_AFTER_SECS = 3 * COMPUTER_REPORT_CADENCE_SECS;
/** Resource samples stay on their 30 s cadence (contract §3). */
export const SAMPLE_CADENCE_SECS = 30;
/** A lane's sample is stale after 3 × the sample cadence (contract §4). */
export const SAMPLE_STALE_AFTER_SECS = 3 * SAMPLE_CADENCE_SECS;

// ---------------------------------------------------------------------------
// Wire types — EXACTLY what coord's `computers.rs` serializes
// (`ComputerSummary`, `LaneRollup`, `ComputerDetail`, `list_body`,
// `detail_body`). Nullable where coord's field is an `Option`; a string where
// coord's is an enum, so a newer coord's word reads UNKNOWN, not a parse error.
// ---------------------------------------------------------------------------

/** Per-axis measurement status the publisher reports (contract §2). */
export type AxisMeasurement = "measured" | "not_supported" | "unavailable";

/** Coord's `Freshness` (a computer's report). `state`: fresh | stale | unknown. */
export interface ComputerFreshnessWire {
  last_report_at: string;
  age_secs: number;
  state: string;
  stale_after_secs: number;
}

/** Coord's `LaneFreshness` (one lane's newest sample). */
export interface LaneFreshnessWire {
  age_secs: number;
  state: string;
  stale_after_secs: number;
}

/** Coord's capacity object — every member nullable (never reported = UNKNOWN). */
export interface ComputerCapacityWire {
  cpu_cores: number | null;
  memory_total_bytes: number | null;
  swap_total_bytes: number | null;
  disk_total_bytes: number | null;
  gpus: unknown;
}

/** `device_resource_samples::lane_pressure` — the lane rollup's OBJECT form. */
export interface LanePressureWire {
  ratio: number;
  basis: string;
}

/** Coord's `LaneRollup`: the newest sample of one `(device, lane, lane_instance)`, flat. */
export interface ComputerLaneWire {
  lane: string;
  lane_instance: string | null;
  device_id: string;
  sampled_at: string;
  age_secs: number;
  freshness: LaneFreshnessWire;
  cpu_cores: number | null;
  load_1m: number | null;
  load_5m: number | null;
  load_15m: number | null;
  mem_total_bytes: number | null;
  mem_available_bytes: number | null;
  swap_total_bytes: number | null;
  swap_used_bytes: number | null;
  swap_ratio: number | null;
  disk_total_bytes: number | null;
  disk_free_bytes: number | null;
  pressure: LanePressureWire | null;
  /** ok | warn | breach | unknown — the ENFORCED admission verdict. */
  headroom: string;
  psi_memory_some_avg10: number | null;
  psi_memory_some_avg60: number | null;
  psi_memory_full_avg10: number | null;
  psi_memory_full_avg60: number | null;
  psi_cpu_some_avg10: number | null;
  psi_cpu_some_avg60: number | null;
  psi_cpu_full_avg10: number | null;
  psi_cpu_full_avg60: number | null;
  psi_io_some_avg10: number | null;
  psi_io_some_avg60: number | null;
  psi_io_full_avg10: number | null;
  psi_io_full_avg60: number | null;
  oom_kill_total: number | null;
  boot_id: string | null;
  measured: Record<string, string> | null;
}

/** Coord's `DeviceRef`. */
export interface ComputerDeviceWire {
  device_id: string;
  hostname: string | null;
  role: string | null;
  capabilities: unknown;
  state: string | null;
  last_seen_at: string | null;
}

/** Coord's `CiRunnerRef` — a registrar row, joined to a reported unit when one matched. */
export interface CiRunnerWire {
  device_id: string;
  hostname: string;
  runner_name: string | null;
  host_key: string;
  repo: string | null;
  ci_runner_status: string | null;
  last_seen_at: string | null;
  /** Inside the registrar freshness window — only then is `ci_runner_status` an opinion. */
  registrar_fresh: boolean;
  service_unit: string | null;
  service_active_state: string | null;
}

/** Coord's `EventRow`. */
export interface ComputerEventWire {
  event_id: string;
  kind: string;
  observed_at: string;
  recorded_at: string;
  detail: unknown;
}

/** Coord's `ServiceRow`: the reported unit, flattened, plus `observed_at` and `down`. */
export interface ComputerServiceWire {
  unit: string;
  kind: string;
  active_state: string | null;
  sub_state: string | null;
  result: string | null;
  restart_policy: string | null;
  oom_policy: string | null;
  memory_max: number | null;
  memory_peak: number | null;
  n_restarts: number | null;
  state_changed_at: string | null;
  runner_name: string | null;
  repo: string | null;
  observed_at: string;
  /** `failed` or `inactive` — coord's one "down" predicate (`service_is_down`). */
  down: boolean;
}

/** Coord's `HistoryPoint`. `pressure` here is the bare NUMBER ratio. */
export interface HistoryPointWire {
  sampled_at: string;
  load_1m: number | null;
  load_5m: number | null;
  load_15m: number | null;
  mem_available_bytes: number | null;
  swap_ratio: number | null;
  pressure: number | null;
  psi_memory_some_avg60: number | null;
  psi_cpu_some_avg60: number | null;
  psi_io_some_avg60: number | null;
}

/** Coord's `HistorySeries` (oldest point first, last 6 h). */
export interface LaneHistoryWire {
  device_id: string;
  lane: string;
  lane_instance: string | null;
  points: HistoryPointWire[];
}

/** Coord's `Divergence`: a reported unit state the registrar's GitHub view disagrees with. */
export interface DivergenceWire {
  /** reported_down_registrar_online | reported_up_registrar_offline */
  kind: string;
  unit: string;
  runner_name: string;
  reported_active_state: string | null;
  registrar_status: string | null;
  registrar_device_id: string;
}

/** Coord's `ComputerSummary`. */
export interface ComputerSummaryWire {
  computer_id: string;
  kind: string;
  parent_computer_id: string | null;
  identity_hash_prefix: string;
  hostname: string | null;
  os: string | null;
  os_version: string | null;
  kernel: string | null;
  arch: string | null;
  capacity: ComputerCapacityWire;
  boot_id: string | null;
  booted_at: string | null;
  access: unknown;
  identity_conflict_at: string | null;
  first_seen_at: string;
  freshness: ComputerFreshnessWire;
  lanes: ComputerLaneWire[];
  /**
   * Worst lane freshness over every known lane of the computer's attached
   * devices: `stale` if any is, or if no lane is listed while an older sample
   * exists (from a device no longer attached); `unknown` when never sampled,
   * or when coord truncated the lane list and could not vouch for the rest.
   */
  samples_state: string;
  /** Age of the newest sample on this computer, any lane — `null` = never sampled (UNKNOWN). */
  newest_sample_age_secs: number | null;
  /**
   * `true` = coord hit its per-lane-class cap (16) and did not enumerate
   * every lane; `samples_state` is then never `fresh`.
   */
  lanes_truncated: boolean;
  sample_stale_after_secs: number;
  /** `false` = no service row was ever stored — `services_failed: 0` is then UNKNOWN. */
  services_reported: boolean;
  services_total: number;
  services_failed: number;
  last_event: ComputerEventWire | null;
  devices: ComputerDeviceWire[];
  /**
   * Registrar rows attributed to THIS computer (exactly one computer claims
   * the runner name). `null` = the registrar read failed — UNKNOWN.
   */
  ci_runners: CiRunnerWire[] | null;
  drill_down: string;
}

/** Coord's `AmbiguousCiRunner`: a registrar row two or more computers claim — attributed to none. */
export interface AmbiguousCiRunnerWire extends CiRunnerWire {
  /** The claiming computers' ids, sorted by coord. */
  claimed_by: string[];
}

/** Coord's `AgentSessionCount`. */
export interface AgentSessionCountWire {
  device_id: string;
  open_sessions: number;
}

export interface ComputerWorkloadsWire {
  devices: ComputerDeviceWire[];
  /** `null` = the registrar read failed (UNKNOWN). */
  ci_runners: CiRunnerWire[] | null;
  /** `null` = coord's session read failed — UNKNOWN, never "no sessions". */
  agent_sessions: AgentSessionCountWire[] | null;
}

export interface StalenessRulesWire {
  report_stale_after_secs: number;
  sample_stale_after_secs: number;
}

/** Coord's `detail_body`. */
export interface ComputerDetailWire extends ComputerSummaryWire {
  services: ComputerServiceWire[];
  events: ComputerEventWire[];
  events_window_days: number;
  history: LaneHistoryWire[];
  history_truncated: boolean;
  workloads: ComputerWorkloadsWire;
  /** `null` = the registrar read failed — UNKNOWN, never "agree". */
  divergence: DivergenceWire[] | null;
  /**
   * `false` = coord's registrar read failed: `ci_runners`,
   * `workloads.ci_runners` and `divergence` are then `null` (UNKNOWN). The
   * page also treats anything but an explicit `true` as unknown.
   */
  registrar_read_ok: boolean;
  schema_pending: boolean;
  staleness: StalenessRulesWire;
}

/** Coord's `list_body` (the HTTP route answers schema-pending with a 503 instead). */
export interface ComputersListWire {
  computers: ComputerSummaryWire[] | null;
  count: number | null;
  /** `null` = the registrar read failed — UNKNOWN, never "none". */
  unattributed_ci_runners: CiRunnerWire[] | null;
  /** Rows two or more computers claim. `null` = the registrar read failed — UNKNOWN. */
  ambiguous_ci_runners: AmbiguousCiRunnerWire[] | null;
  /** `false` = the registrar read failed: every runner list is `null` (UNKNOWN). */
  registrar_read_ok: boolean;
  schema_pending: boolean;
  staleness: StalenessRulesWire;
}

// ---------------------------------------------------------------------------
// Read state — what coord ANSWERED, before any computer is looked at
// ---------------------------------------------------------------------------

/**
 * Every outcome of one read. Only `ok` carries a body; the others are
 * statements about the read, and each renders as an explicit UNKNOWN banner —
 * never as an error page and never as an empty fleet.
 */
export type ComputersReadIssue =
  | { kind: "route_unavailable" }
  | { kind: "schema_pending" }
  | { kind: "route_disabled" }
  | { kind: "deadline"; budgetMs: number | null }
  | { kind: "not_found" }
  | { kind: "forbidden" }
  | { kind: "tenant_not_resolved" }
  | { kind: "error"; message: string };

function parseObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Coord's `schema_pending` answer: the qontinui-web migration that creates
 * `coord.computers` has not reached the database coord reads (served policy
 * `alembic-sole-authorship` orders it first). Coord's HTTP routes answer it as
 * 503 `{"error":"schema_pending","code":"computers_schema_pending"}`; its
 * `list_body` (which the MCP tool also serves) carries `schema_pending: true`
 * on the body itself. Both shapes are coord's own.
 */
export function isSchemaPendingBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return b.error === "schema_pending" || b.schema_pending === true;
}

/**
 * The error code a DETAIL read's 404 carries when coord answered "no such
 * computer in your tenant" — as opposed to a 404 because this coord does not
 * serve the route at all. Both are 404s, and they are different claims: one
 * is a measurement, the other is no measurement. Anything that is not one of
 * these codes (an empty body, the web's own `{"error":"NOT_FOUND"}`) reads as
 * route-unavailable, which is the UNKNOWN side — the safe side to err on.
 */
const COMPUTER_NOT_FOUND_CODES = new Set(["computer_not_found"]);

/** Classify an `httpClient` rejection from either computer read. Pure. */
export function classifyComputersError(
  err: unknown,
  options: { detail?: boolean } = {}
): ComputersReadIssue {
  const status = httpStatusOf(err);
  const bodyText = httpBodyOf(err);
  const body = parseObject(bodyText);
  if (isSchemaPendingBody(body)) return { kind: "schema_pending" };
  if (
    options.detail &&
    status === 404 &&
    typeof body?.error === "string" &&
    COMPUTER_NOT_FOUND_CODES.has(body.error)
  ) {
    return { kind: "not_found" };
  }
  // The web gate's two 403 codes, read from whichever key carries them: the
  // app's error middleware puts an HTTPException's string detail in
  // `message` (`{"error":"FORBIDDEN","message":"not_coord_tenant_admin"}`),
  // and a bare FastAPI app puts it in `detail`. Any OTHER 403 is not the admin
  // gate and must not be explained as one, so it stays a plain error.
  if (status === 403) {
    const code = [body?.message, body?.detail, body?.error].find(
      (v): v is string =>
        v === "not_coord_tenant_admin" || v === "tenant_not_resolved"
    );
    if (code === "not_coord_tenant_admin") return { kind: "forbidden" };
    if (code === "tenant_not_resolved") return { kind: "tenant_not_resolved" };
  }
  const verdict = classifyCoordError(status, bodyText);
  switch (verdict.kind) {
    case "deadline":
      return { kind: "deadline", budgetMs: verdict.budgetMs };
    case "route_disabled":
      return { kind: "route_disabled" };
    case "route_unavailable":
      return { kind: "route_unavailable" };
    default:
      return {
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      };
  }
}

/**
 * The strip headline for a read with no body to show. A refusal is not
 * silence: "coord did not answer" would be false about a 403, which IS an
 * answer, and would send the reader looking for an outage.
 */
export function readIssueHeadline(
  issue: ComputersReadIssue,
  subject: string
): string {
  switch (issue.kind) {
    case "forbidden":
      return "Coord tenant admins only";
    case "tenant_not_resolved":
      return "No project resolved for this read";
    case "not_found":
      return "No such computer in this tenant";
    default:
      return `${subject} unknown — coord did not answer this read`;
  }
}

/** The banner sentence for a read issue. Every arm says UNKNOWN, none says empty. */
export function readIssueText(issue: ComputersReadIssue): string {
  switch (issue.kind) {
    case "route_unavailable":
      return "Coord does not serve the computers read yet (this deployment predates it), so what the fleet's computers are doing is UNKNOWN — not an empty fleet.";
    case "schema_pending":
      return "Coord's computers schema is not in its database yet (the migration has not reached it), so the fleet's computers are UNKNOWN — not an empty fleet.";
    case "route_disabled":
      return "The computers read is disabled by an operator, so the fleet's computers are UNKNOWN on this page.";
    case "deadline":
      return `Coord gave up on the computers read at ${issue.budgetMs === null ? "its budget" : `${issue.budgetMs} ms`}, so nothing was measured — UNKNOWN.`;
    case "not_found":
      return "Coord holds no computer with this id in your tenant.";
    case "forbidden":
      return "Only an admin of the selected project (coord tenant) may read computers — they carry CI-runner and access facts — so this page cannot show them to you.";
    case "tenant_not_resolved":
      return "Coord could not resolve which project (tenant) you are acting in, so it did not read any computers. Select a project, or check that your account belongs to one.";
    case "error":
      return `Could not read computers from coord (${issue.message}) — UNKNOWN, not empty.`;
  }
}

// ---------------------------------------------------------------------------
// Normalization — coord's summary into what the pages render
// ---------------------------------------------------------------------------

export interface Capacity {
  cpuCores: number | null;
  memoryTotalBytes: number | null;
  swapTotalBytes: number | null;
  diskTotalBytes: number | null;
  gpus: unknown;
}

export interface NormalizedComputer {
  computerId: string;
  identityHashPrefix: string;
  hostname: string | null;
  kind: string;
  os: string | null;
  osVersion: string | null;
  kernel: string | null;
  arch: string | null;
  bootedAt: string | null;
  parentComputerId: string | null;
  identityConflictAt: string | null;
  capacity: Capacity;
  freshness: ComputerFreshnessWire;
  lanes: ComputerLaneWire[];
  /** Coord's `samples_state` — the worst lane freshness. */
  samplesState: string;
  /** Coord's `newest_sample_age_secs` — `null` = never sampled. */
  newestSampleAgeSecs: number | null;
  /** Coord's `lanes_truncated` — some lanes were not listed. */
  lanesTruncated: boolean;
  /**
   * Down units (failed or inactive). `null` when `services_reported` is
   * false: coord then sends `services_failed: 0`, and that zero is UNKNOWN.
   */
  servicesFailed: number | null;
  servicesTotal: number | null;
  /** `null` = coord holds no event in its retention window. */
  lastEvent: ComputerEventWire | null;
  devices: ComputerDeviceWire[];
  /** `null` unless coord's registrar read is known to have succeeded (`registrar_read_ok === true`) — UNKNOWN. */
  ciRunners: CiRunnerWire[] | null;
  drillDown: string;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

export function normalizeComputer(
  c: ComputerSummaryWire,
  options: { registrarReadOk?: boolean } = {}
): NormalizedComputer {
  const reported = c.services_reported === true;
  return {
    computerId: c.computer_id,
    identityHashPrefix: c.identity_hash_prefix,
    hostname: str(c.hostname),
    kind: c.kind,
    os: str(c.os),
    osVersion: str(c.os_version),
    kernel: str(c.kernel),
    arch: str(c.arch),
    bootedAt: str(c.booted_at),
    parentComputerId: str(c.parent_computer_id),
    identityConflictAt: str(c.identity_conflict_at),
    capacity: {
      cpuCores: num(c.capacity.cpu_cores),
      memoryTotalBytes: num(c.capacity.memory_total_bytes),
      swapTotalBytes: num(c.capacity.swap_total_bytes),
      diskTotalBytes: num(c.capacity.disk_total_bytes),
      gpus: c.capacity.gpus ?? null,
    },
    freshness: c.freshness,
    lanes: c.lanes,
    samplesState: c.samples_state,
    newestSampleAgeSecs: num(c.newest_sample_age_secs),
    lanesTruncated: c.lanes_truncated === true,
    servicesFailed: reported ? c.services_failed : null,
    servicesTotal: reported ? c.services_total : null,
    lastEvent: c.last_event,
    devices: c.devices,
    ciRunners: options.registrarReadOk === true ? c.ci_runners : null,
    drillDown: c.drill_down,
  };
}

/** The drill-down route for one computer. */
export function computerHref(computerId: string): string {
  return `/admin/coord/computers/${encodeURIComponent(computerId)}`;
}

/** A computer's display name. Never blank: an unnamed computer says so. */
export function computerName(c: NormalizedComputer): string {
  return c.hostname ?? "unnamed computer";
}

// ---------------------------------------------------------------------------
// Freshness — coord's verdict, aged by the time since THIS page read it
// ---------------------------------------------------------------------------

export type FreshnessKind = "fresh" | "stale" | "unknown";

export interface FreshnessReading {
  kind: FreshnessKind;
  /** Age in seconds as of NOW (coord's `age_secs` + time since the read landed); null = unknown. */
  ageSecs: number | null;
  label: string;
  reason: string;
}

function ageFrom(
  ageSecs: number | null | undefined,
  fetchedAtMs: number | null,
  nowMs: number
): number | null {
  // `age_secs` is frozen inside the payload, so on its own it would say
  // "15 seconds old" forever while this page's reads fail. Adding the time
  // since the read landed is what lets a silent coord go stale on screen by
  // itself (`useFleetResourceSamples`' `effectiveAgeSecs` rule). Only an
  // INTERVAL is measured client-side, never an absolute time, so a skewed
  // browser clock cannot manufacture freshness.
  const elapsed =
    fetchedAtMs === null ? 0 : Math.max(0, (nowMs - fetchedAtMs) / 1000);
  const age = num(ageSecs);
  // No server-computed age is NO age. Dating the report's timestamp against
  // this browser's clock would let a skewed clock manufacture freshness (a
  // clock running behind makes an hour-old report "just now"), so an absent
  // `age_secs` reads UNKNOWN and the timestamp is shown only as a timestamp.
  return age === null ? null : age + elapsed;
}

/**
 * The newest sample's age as of NOW — coord's `newest_sample_age_secs` aged by
 * the time since the read, `null` when the computer was never sampled.
 */
export function newestSampleAge(
  c: NormalizedComputer,
  fetchedAtMs: number | null,
  nowMs: number
): number | null {
  return ageFrom(c.newestSampleAgeSecs, fetchedAtMs, nowMs);
}

/**
 * The sentence for a computer whose `lanes` coord sent EMPTY. Coord lists
 * every known lane of the devices attached to the computer, so an empty array
 * with a newest-sample age means the samples came from devices no longer
 * attached; with no age at all, the computer was never sampled.
 */
export function emptyLanesText(
  c: NormalizedComputer,
  fetchedAtMs: number | null,
  nowMs: number
): string {
  const age = newestSampleAge(c, fetchedAtMs, nowMs);
  if (c.samplesState === "stale" && age !== null) {
    return `Samples stale, newest ${formatAge(age)} — no lane of a currently attached device is listed, so current usage is unknown (not idle).`;
  }
  if (age === null) {
    return "No resource sample from this computer — usage is unknown, not idle.";
  }
  return `No lane is listed for this computer (newest sample ${formatAge(age)}) — current usage is unknown, not idle.`;
}

/**
 * The computer's freshness. Three rules, and the order matters:
 *
 * 1. No freshness block, or a coord word this build does not know with no age
 *    beside it → `unknown`. Never `fresh`.
 * 2. Coord says `stale`/`unknown` → that, whatever the age says. Coord owns
 *    the verdict; this page may only make it WORSE.
 * 3. Otherwise the age decides against 3 × 300 s — so a `fresh` verdict that
 *    has sat on screen while coord went silent still turns `stale`.
 */
export function computerFreshness(
  f: ComputerFreshnessWire | null,
  fetchedAtMs: number | null,
  nowMs: number
): FreshnessReading {
  const ageSecs = f ? ageFrom(f.age_secs, fetchedAtMs, nowMs) : null;
  const word = f?.state ?? null;
  const staleAfter = num(f?.stale_after_secs) ?? COMPUTER_STALE_AFTER_SECS;
  const unknown = (reason: string): FreshnessReading => ({
    kind: "unknown",
    ageSecs,
    label: "UNKNOWN",
    reason,
  });
  if (!f) return unknown("Coord reported no freshness for this computer.");
  if (word === "unknown") {
    return unknown(
      "Coord has no report from this computer it can date — nothing it shows is a current measurement."
    );
  }
  if (word === "stale" || (ageSecs !== null && ageSecs > staleAfter)) {
    return {
      kind: "stale",
      ageSecs,
      label: "STALE",
      reason: `Last report ${formatAge(ageSecs)} — older than ${Math.round(staleAfter / 60)} min (3 × the ${COMPUTER_REPORT_CADENCE_SECS / 60} min report cadence). Figures below are the last known, not current.`,
    };
  }
  if (word !== "fresh") {
    return unknown(
      `Coord reported a freshness this page does not recognise ("${word}").`
    );
  }
  if (ageSecs === null) {
    return unknown(
      "Coord gave no report age for this computer, so its freshness cannot be dated."
    );
  }
  return {
    kind: "fresh",
    ageSecs,
    label: "fresh",
    reason: `Last report ${formatAge(ageSecs)}.`,
  };
}

/**
 * A lane's own sample freshness — coord's `lane.freshness.state`, never
 * upgraded, aged by the time since this page's read. Samples run on a 30 s
 * cadence, not 300 s, so a lane can be stale inside a fresh computer; a stale
 * COMPUTER makes every lane stale too: nothing it last reported is current.
 */
export function laneFreshness(
  lane: ComputerLaneWire,
  computer: FreshnessReading,
  fetchedAtMs: number | null,
  nowMs: number
): FreshnessReading {
  const f = lane.freshness;
  const ageSecs = ageFrom(f?.age_secs ?? lane.age_secs, fetchedAtMs, nowMs);
  const staleAfter = num(f?.stale_after_secs) ?? SAMPLE_STALE_AFTER_SECS;
  const word = f?.state ?? null;
  if (ageSecs === null || word === "unknown") {
    return {
      kind: "unknown",
      ageSecs,
      label: "UNKNOWN",
      reason:
        "Coord cannot date this lane's sample — its figures are not a current measurement.",
    };
  }
  if (computer.kind !== "fresh" || word === "stale" || ageSecs > staleAfter) {
    return {
      kind: "stale",
      ageSecs,
      label: "STALE",
      reason: `Last sample ${formatAge(ageSecs)} — older than ${staleAfter} s (3 × the ${SAMPLE_CADENCE_SECS} s sample cadence), or the computer itself is not fresh. Last known, not current.`,
    };
  }
  if (word !== "fresh") {
    return {
      kind: "unknown",
      ageSecs,
      label: "UNKNOWN",
      reason: `Coord reported a lane freshness this page does not recognise ("${word ?? "none"}").`,
    };
  }
  return {
    kind: "fresh",
    ageSecs,
    label: "fresh",
    reason: `Sampled ${formatAge(ageSecs)}.`,
  };
}

// ---------------------------------------------------------------------------
// Axis readings — unknown / not supported / unavailable / a value
// ---------------------------------------------------------------------------

export type Reading =
  | { kind: "value"; value: number }
  | { kind: "unknown" }
  | { kind: "not_supported" }
  | { kind: "unavailable" };

/** The `measured` axis a lane field belongs to (contract §2 axis names). */
export function axisOf(field: string): string | null {
  if (field.startsWith("psi_memory")) return "psi_memory";
  if (field.startsWith("psi_cpu")) return "psi_cpu";
  if (field.startsWith("psi_io")) return "psi_io";
  if (
    field === "load_1m" ||
    field === "load_5m" ||
    field === "load_15m" ||
    field === "oom_kill_total"
  ) {
    return field;
  }
  return null;
}

/**
 * Read one lane field. The publisher's `measured` map wins over the value:
 * an axis marked `not_supported` (Windows has no load average, and says so
 * rather than sending a proxy) reads as such even if some number rode along,
 * because coord's own contract says that number is not a measurement.
 */
export function readLaneField(
  lane: ComputerLaneWire,
  field: keyof ComputerLaneWire
): Reading {
  const axis = axisOf(field);
  const status = axis ? lane.measured?.[axis] : undefined;
  if (status === "not_supported") return { kind: "not_supported" };
  if (status === "unavailable") return { kind: "unavailable" };
  const v = num(lane[field]);
  return v === null ? { kind: "unknown" } : { kind: "value", value: v };
}

/** Text for a non-value reading. The three words the plan's §3.5 names, verbatim. */
export function readingText(
  r: Reading,
  formatValue: (v: number) => string
): string {
  switch (r.kind) {
    case "value":
      return formatValue(r.value);
    case "unknown":
      return "unknown";
    case "not_supported":
      return "not supported";
    case "unavailable":
      return "unavailable";
  }
}

/** A lane rollup's pressure ratio. Coord's lane `pressure` is `{ratio, basis}`; `null` = no opinion. */
export function lanePressureRatio(lane: ComputerLaneWire): number | null {
  return lane.pressure ? num(lane.pressure.ratio) : null;
}

/** `used / total (pct)`, or a word — never a fabricated ratio from a missing side. */
export function usageText(used: number | null, total: number | null): string {
  if (used === null && total === null) return "unknown";
  if (used === null) return `unknown / ${formatBytes(total)}`;
  if (total === null) return `${formatBytes(used)} / unknown`;
  if (total <= 0) return `${formatBytes(used)} / ${formatBytes(total)}`;
  return `${formatBytes(used)} / ${formatBytes(total)} (${formatPercent(used / total)})`;
}

/** Memory used on a lane, derived from total − available only when BOTH were measured. */
export function laneMemoryUsed(lane: ComputerLaneWire): number | null {
  const total = num(lane.mem_total_bytes);
  const avail = num(lane.mem_available_bytes);
  return total !== null && avail !== null ? Math.max(0, total - avail) : null;
}

/** Disk used on a lane, derived from total − free only when BOTH were measured. */
export function laneDiskUsed(lane: ComputerLaneWire): number | null {
  const total = num(lane.disk_total_bytes);
  const free = num(lane.disk_free_bytes);
  return total !== null && free !== null ? Math.max(0, total - free) : null;
}

/** Sparkline points for a lane's history. A missing ratio stays `null` — a gap, not a zero. */
export function historyPoints(
  series: LaneHistoryWire | undefined
): { sampled_at: string; pressure: number | null }[] {
  // A history point's `pressure` is the bare NUMBER ratio (coord's
  // `HistoryPoint`), unlike the lane rollup's object.
  return (series?.points ?? []).map((p) => ({
    sampled_at: p.sampled_at,
    pressure: num(p.pressure),
  }));
}

/** A lane's operator name: `host`, or `wsl (Ubuntu)` for an instance. */
export function laneName(lane: {
  lane?: string | null;
  lane_instance?: string | null;
}): string {
  const base = lane.lane ?? "unknown lane";
  return lane.lane_instance ? `${base} (${lane.lane_instance})` : base;
}

/**
 * A lane's identity: `(device_id, lane, lane_instance)`. Coord keys both the
 * rollup and the history by the publishing device too — two runners on one
 * computer publish two `host` lanes, and joining history on lane alone would
 * draw one runner's series beside the other's reading.
 */
export function laneKey(lane: {
  device_id: string;
  lane: string;
  lane_instance: string | null;
}): string {
  return `${lane.device_id}:${lane.lane}:${lane.lane_instance ?? ""}`;
}

/** Map each lane to its history series by {@link laneKey}. */
export function historyByLane(
  detail: ComputerDetailWire | null
): Map<string, LaneHistoryWire> {
  const m = new Map<string, LaneHistoryWire>();
  for (const s of detail?.history ?? []) m.set(laneKey(s), s);
  return m;
}

// ---------------------------------------------------------------------------
// Palettes (R3/R4). All three registered in `components/console/consoleSurfaces.ts`.
// ---------------------------------------------------------------------------

/** The freshness badge's palette — `fresh` is calm, the other two are the ignorance floor. */
export const FRESHNESS_ATTENTION_BY_KIND = {
  fresh: "none",
  // Amber on ignorance (style guide R3, "the one exception"): nothing clears a
  // stale computer except its reporter coming back, and we cannot say whose
  // move that is. Calm would assert "nothing is wrong here", which is exactly
  // what we do not know.
  stale: "waiting",
  unknown: "waiting",
} satisfies AttentionMap<FreshnessKind>;

const FRESH_GREEN = "bg-green-500/15 text-green-200 border-green-500/30";

export const FRESHNESS_BADGE_CLASS: Record<FreshnessKind, string> = {
  fresh: FRESH_GREEN,
  stale: UNKNOWN_AMBER,
  unknown: UNKNOWN_AMBER,
};

export const FRESHNESS_AUTHOR_GLYPH_KINDS: ReadonlySet<FreshnessKind> =
  new Set<FreshnessKind>();

export const FRESHNESS_PALETTE: StatusPalette<FreshnessKind> = {
  badgeClass: FRESHNESS_BADGE_CLASS,
  authorGlyphKinds: FRESHNESS_AUTHOR_GLYPH_KINDS,
};

export function freshnessStatus(r: FreshnessReading): RowStatus<FreshnessKind> {
  return {
    kind: r.kind,
    label: r.label,
    reason: r.reason,
    attention: FRESHNESS_ATTENTION_BY_KIND[r.kind],
  };
}

/** A computer row's one-word verdict. */
export type ComputerKind =
  | "healthy"
  | "services_unknown"
  | "under_pressure"
  | "lane_stale"
  | "headroom_unknown"
  | "service_failed"
  | "identity_conflict"
  | "stale"
  | "unknown";

/**
 * The audit, one line per kind:
 *
 * - `service_failed` — AUTHOR. A watched unit is `failed`; systemd will not
 *   restart it past its policy, and this is the 2026-09-30 incident's shape
 *   (three `actions.runner.*` units dead after an OOM kill, nothing paging).
 * - `identity_conflict` — AUTHOR. Two live reporters claim one identity
 *   (cloned VM, copied `/etc/machine-id`); coord refused to merge them, and
 *   only a person can say which box is which.
 * - `under_pressure` — WAITING. A FRESH lane's admission guard is at its
 *   floor; it clears itself when the load does, and the dispatcher already
 *   steps back. A stale lane's last headroom never counts: it is not current.
 * - `headroom_unknown` — WAITING, the ignorance floor: a FRESH lane whose
 *   admission verdict coord could not grade (`headroom: unknown`), so "no
 *   lane refusing work" cannot be claimed for it.
 * - `lane_stale` — WAITING, the ignorance floor for one axis: the computer
 *   reports but a lane's samples are stale or undatable, so its current
 *   pressure is unknown. The reason names the lane (and its last-known
 *   pressure, if that was at a floor).
 * - `stale` / `unknown` — WAITING, the ignorance floor.
 * - `services_unknown` — WAITING. The computer reports, but not its services,
 *   so "no failed service" cannot be claimed. Calm would claim it.
 * - `healthy` — none. Fresh, every service counted and none failed, no lane
 *   refusing work.
 */
export const COMPUTER_ATTENTION_BY_KIND = {
  healthy: "none",
  services_unknown: "waiting",
  under_pressure: "waiting",
  lane_stale: "waiting",
  headroom_unknown: "waiting",
  service_failed: "author",
  identity_conflict: "author",
  stale: "waiting",
  unknown: "waiting",
} satisfies AttentionMap<ComputerKind>;

export const COMPUTER_BADGE_CLASS: Record<ComputerKind, string> = {
  healthy: FRESH_GREEN,
  services_unknown: UNKNOWN_AMBER,
  under_pressure: WAITING_AMBER,
  lane_stale: UNKNOWN_AMBER,
  headroom_unknown: UNKNOWN_AMBER,
  service_failed: AUTHOR_RED,
  identity_conflict: AUTHOR_RED,
  stale: UNKNOWN_AMBER,
  unknown: UNKNOWN_AMBER,
};

export const COMPUTER_AUTHOR_GLYPH_KINDS: ReadonlySet<ComputerKind> =
  new Set<ComputerKind>(["service_failed", "identity_conflict"]);

export const COMPUTER_PALETTE: StatusPalette<ComputerKind> = {
  badgeClass: COMPUTER_BADGE_CLASS,
  authorGlyphKinds: COMPUTER_AUTHOR_GLYPH_KINDS,
};

/**
 * The computer's verdict. Order: an identity conflict first (it is a fact
 * about the RECORD and stays true however old the report is), then freshness
 * (a stale computer's service count is not current, so it may not headline as
 * one), then the measured faults.
 */
export function computerStatus(
  c: NormalizedComputer,
  freshness: FreshnessReading,
  clock: { fetchedAtMs: number | null; nowMs: number }
): RowStatus<ComputerKind> {
  const make = (
    kind: ComputerKind,
    label: string,
    reason: string
  ): RowStatus<ComputerKind> => ({
    kind,
    label,
    reason,
    attention: COMPUTER_ATTENTION_BY_KIND[kind],
  });
  if (c.identityConflictAt) {
    return make(
      "identity_conflict",
      "identity conflict",
      "Two live reporters share this computer's identity with different boot ids (a cloned VM or a copied machine id). Coord did not merge them; a person has to say which box is which."
    );
  }
  if (freshness.kind === "unknown") {
    return make("unknown", "unknown", freshness.reason);
  }
  if (freshness.kind === "stale") {
    const lastKnown =
      c.servicesFailed === null
        ? ""
        : ` Last known: ${c.servicesFailed} service${c.servicesFailed === 1 ? "" : "s"} down.`;
    return make("stale", "stale", `${freshness.reason}${lastKnown}`);
  }
  if (c.servicesFailed !== null && c.servicesFailed > 0) {
    return make(
      "service_failed",
      `${c.servicesFailed} service${c.servicesFailed === 1 ? "" : "s"} down`,
      "A watched service is failed or inactive (coord's one `down` predicate — a stopped Restart=no runner reads inactive, not failed), and nothing will bring it back by itself."
    );
  }
  const atFloor = (l: ComputerLaneWire) =>
    l.headroom === "breach" || l.headroom === "warn";
  const laneState = c.lanes.map((lane) => ({
    lane,
    fresh:
      laneFreshness(lane, freshness, clock.fetchedAtMs, clock.nowMs).kind ===
      "fresh",
  }));
  // Only a FRESH lane's headroom is a current fact. A stale lane that last
  // read `breach` may have recovered an hour ago; counting it would headline
  // pressure that is not there, and it is reported below as stale instead.
  const pressured = laneState.filter((s) => s.fresh && atFloor(s.lane));
  if (pressured.length > 0) {
    // Two different claims, both made by a guard ON THE MACHINE (ci_node
    // dispatch, the supervisor's disk guard), not by coord: `breach` is a
    // guard refusing work now; `warn` is inside the amber band, where a guard
    // may be deferring it.
    const names = (h: string) =>
      pressured
        .filter((s) => s.lane.headroom === h)
        .map((s) => laneName(s.lane))
        .join(", ");
    const breach = names("breach");
    const warn = names("warn");
    return make(
      "under_pressure",
      "under pressure",
      [
        breach
          ? `Lane ${breach} is past an admission floor — a guard is refusing work here.`
          : null,
        warn
          ? `Lane ${warn} is near an admission floor — a guard may be deferring work.`
          : null,
      ]
        .filter((x): x is string => x !== null)
        .join(" ")
    );
  }
  const staleLanes = laneState.filter((s) => !s.fresh).map((s) => s.lane);
  if (staleLanes.length > 0) {
    const lastAtFloor = staleLanes.filter(atFloor);
    return make(
      "lane_stale",
      "lane stale",
      `The samples for lane ${staleLanes.map(laneName).join(", ")} are stale or undatable, so current pressure there is unknown.` +
        (lastAtFloor.length > 0
          ? ` Last known: ${lastAtFloor.map((l) => `${laneName(l)} ${l.headroom}`).join(", ")} — not current.`
          : "")
    );
  }
  // A fresh lane coord could not grade: `headroom` is outside the verdict
  // vocabulary (coord's `unknown`, or a word this build does not know). Its
  // admission state is not measured, so "healthy" would claim it.
  const graded = new Set(["ok", "warn", "breach"]);
  const ungraded = laneState
    .filter((s) => s.fresh && !graded.has(s.lane.headroom))
    .map((s) => s.lane);
  if (ungraded.length > 0) {
    return make(
      "headroom_unknown",
      "admission unknown",
      `Coord could not grade admission headroom for lane ${ungraded.map(laneName).join(", ")}, so whether it is refusing work is unknown.`
    );
  }
  // A truncated lane list cannot vouch for the lanes it did not list — coord
  // degrades `fresh` to `unknown` for exactly this. Checked before the
  // samples-state branch so it gets its own reason, not "never sampled".
  if (c.lanesTruncated) {
    return make(
      "lane_stale",
      "samples not fully known",
      "Coord listed only part of this computer's lanes (cap reached), so its sample state is not fully known."
    );
  }
  // Coord's own fold over every known lane of the attached devices (there is
  // no lookback window): a lane is stale after 90 s, so any stale lane makes
  // this `stale`; empty lanes with a sample from a no-longer-attached device
  // also fold to `stale`; never sampled is `unknown`. The refusal itself is a
  // machine-side guard's (ci_node dispatch, the supervisor's disk guard), so
  // "healthy" here would claim a usage nobody measured.
  if (c.samplesState !== "fresh") {
    return make(
      "lane_stale",
      c.samplesState === "stale" ? "samples stale" : "samples unknown",
      c.samplesState === "stale"
        ? `Coord reports this computer's samples as stale — newest ${formatAge(newestSampleAge(c, clock.fetchedAtMs, clock.nowMs))}; current usage is unknown.`
        : c.newestSampleAgeSecs === null
          ? "Coord has never received a resource sample from this computer — current usage is unknown, not idle."
          : "Coord cannot vouch for this computer's sample state — current usage is unknown, not idle."
    );
  }
  if (c.servicesFailed === null) {
    return make(
      "services_unknown",
      "services unknown",
      "The computer reports, but it has never reported its watched services (services_reported: false) — a down service here would not show."
    );
  }
  return make("healthy", "healthy", freshness.reason);
}

/** A watched service's state, bucketed. `down` is coord's `down` flag (failed or inactive). */
export type ServiceKind = "active" | "transitioning" | "down" | "unknown";

/**
 * - `down` — AUTHOR: coord's `down` flag (`service_is_down`: failed, or
 *   inactive — a stopped `Restart=no` runner reads inactive, not failed). The
 *   same predicate coord's `services_failed` count and its
 *   `machine_service_failed` alert use, so the row, the count and the alert
 *   cannot disagree.
 * - `transitioning` — WAITING: activating / deactivating / reloading clears
 *   itself one way or the other.
 * - `unknown` — WAITING: an unrecognised state, or the computer is not fresh
 *   so the last state is not current.
 * - `active` — none.
 */
export const SERVICE_ATTENTION_BY_KIND = {
  active: "none",
  transitioning: "waiting",
  down: "author",
  unknown: "waiting",
} satisfies AttentionMap<ServiceKind>;

export const SERVICE_BADGE_CLASS: Record<ServiceKind, string> = {
  active: FRESH_GREEN,
  transitioning: WAITING_AMBER,
  down: AUTHOR_RED,
  unknown: UNKNOWN_AMBER,
};

export const SERVICE_AUTHOR_GLYPH_KINDS: ReadonlySet<ServiceKind> =
  new Set<ServiceKind>(["down"]);

export const SERVICE_PALETTE: StatusPalette<ServiceKind> = {
  badgeClass: SERVICE_BADGE_CLASS,
  authorGlyphKinds: SERVICE_AUTHOR_GLYPH_KINDS,
};

/**
 * A service row's badge. When the computer is not fresh, the unit's last
 * state is shown as `last known: …` under the ignorance floor — a
 * five-hour-old `active` must not read as a green service, and a five-hour-old
 * `failed` must not read as a failure happening now.
 */
export function serviceStatus(
  s: ComputerServiceWire,
  computerFresh: boolean
): RowStatus<ServiceKind> {
  const state = str(s.active_state);
  const sub = str(s.sub_state);
  const result = str(s.result);
  const word = state
    ? sub && sub !== state
      ? `${state}/${sub}`
      : state
    : null;
  if (!computerFresh) {
    return {
      kind: "unknown",
      label: word ? `last known: ${word}` : "unknown",
      reason:
        "This computer's report is not fresh, so the unit's current state is unknown; this is what it last reported.",
      attention: SERVICE_ATTENTION_BY_KIND.unknown,
    };
  }
  // Coord's `down` decides, never a second reading of `active_state`.
  const kind: ServiceKind = s.down
    ? "down"
    : state === "active"
      ? "active"
      : state === "activating" ||
          state === "deactivating" ||
          state === "reloading"
        ? "transitioning"
        : "unknown";
  const reason =
    kind === "down"
      ? `${state === "inactive" ? "Stopped" : "Failed"}${result ? ` (result: ${result})` : ""}.`
      : kind === "unknown"
        ? state
          ? `Unrecognised state "${state}".`
          : "The unit's state was not reported."
        : result && result !== "success"
          ? `Last result: ${result}.`
          : (word ?? "");
  return {
    kind,
    label: word ?? "unknown",
    reason,
    attention: SERVICE_ATTENTION_BY_KIND[kind],
  };
}

/** Operator words for a service kind; the wire value rides in the title. */
export const SERVICE_KIND_LABEL: Record<string, string> = {
  gh_actions_runner: "CI runner",
  qontinui_runner: "Qontinui runner",
  other_watched: "watched",
};

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const EVENT_KIND_LABEL: Record<string, string> = {
  oom_kill: "OOM kill",
  service_failed: "service failed",
  service_recovered: "service recovered",
  reboot: "reboot",
  telemetry_gap: "telemetry gap",
  identity_conflict: "identity conflict",
};

export function eventLabel(kind: string): string {
  return EVENT_KIND_LABEL[kind] ?? kind;
}

/**
 * The event's subject — the unit it names (`unit` on a service transition,
 * `victim_unit` on an OOM kill), or the hostname coord stamps on an identity
 * conflict. `detail` is runner-authored JSON, so it is read field by field.
 */
export function eventSubject(e: ComputerEventWire): string | null {
  const d =
    typeof e.detail === "object" && e.detail !== null
      ? (e.detail as Record<string, unknown>)
      : {};
  return str(d.unit) ?? str(d.victim_unit) ?? str(d.hostname) ?? null;
}

/**
 * A registrar row's status, labelled by whether it is an opinion: coord marks
 * a row outside the registrar freshness window `registrar_fresh: false`, and
 * its status is then the last one GitHub reported, not the current one.
 */
export function ciRunnerStatusText(r: CiRunnerWire): string {
  const status = r.ci_runner_status ?? "status unknown";
  return r.registrar_fresh ? status : `last known: ${status} (registrar stale)`;
}

/**
 * The computers claiming an ambiguous runner, by name. A claimant not in this
 * read's list (a computer outside the page's view) is named by its id prefix
 * rather than dropped — every claimant is part of the answer.
 */
export function ambiguousClaimants(
  runner: AmbiguousCiRunnerWire,
  computers: readonly NormalizedComputer[]
): string[] {
  const byId = new Map(computers.map((c) => [c.computerId, c]));
  return runner.claimed_by.map((id) => {
    const c = byId.get(id);
    return c ? computerName(c) : `computer ${id.slice(0, 8)}`;
  });
}

/** Operator words for coord's divergence kinds; the wire kind rides in the title. */
export const DIVERGENCE_KIND_LABEL: Record<string, string> = {
  reported_down_registrar_online:
    "the computer reports the runner down; GitHub lists it online",
  reported_up_registrar_offline:
    "the computer reports the runner up; GitHub lists it offline",
};

/** Newest first, whatever order the wire used; unparseable times sink. */
export function orderEvents(
  events: readonly ComputerEventWire[]
): ComputerEventWire[] {
  return [...events].sort((a, b) => {
    const at = Date.parse(a.observed_at);
    const bt = Date.parse(b.observed_at);
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return bt - at;
  });
}

// ---------------------------------------------------------------------------
// The list page's strip (R1): derived from the one read, never a second fetch
// ---------------------------------------------------------------------------

export interface ComputersHealth {
  level: "green" | "amber" | "red";
  headline: string;
  detail?: string;
  badges: {
    key: string;
    label: string;
    tone: "default" | "muted" | "attention";
    title?: string;
    "data-testid"?: string;
  }[];
}

export interface ComputerRowModel {
  computer: NormalizedComputer;
  freshness: FreshnessReading;
  status: RowStatus<ComputerKind>;
}

export function buildComputerRows(
  list: ComputersListWire | null,
  fetchedAtMs: number | null,
  nowMs: number
): ComputerRowModel[] {
  const registrarReadOk = list?.registrar_read_ok === true;
  return (list?.computers ?? []).map((raw) => {
    const computer = normalizeComputer(raw, { registrarReadOk });
    const freshness = computerFreshness(computer.freshness, fetchedAtMs, nowMs);
    return {
      computer,
      freshness,
      status: computerStatus(computer, freshness, { fetchedAtMs, nowMs }),
    };
  });
}

const DASH = "–";

export function deriveComputersHealth(input: {
  rows: ComputerRowModel[];
  loaded: boolean;
  issue: ComputersReadIssue | null;
  unattributed: number | null;
  /** Runners two or more computers claim; `null` = unknown. Omitted = not shown. */
  ambiguous?: number | null;
}): ComputersHealth {
  const { rows, loaded, issue, unattributed, ambiguous } = input;
  const dashBadges: ComputersHealth["badges"] = [
    {
      key: "computers",
      label: `computers ${DASH}`,
      tone: "muted",
      "data-testid": "coord-computers-count-badge",
    },
  ];
  if (!loaded) {
    return issue
      ? {
          level: "amber",
          headline: readIssueHeadline(issue, "Computers"),
          detail: readIssueText(issue),
          badges: dashBadges,
        }
      : {
          level: "amber",
          headline: "Reading computers…",
          badges: dashBadges,
        };
  }
  const count = (k: ComputerKind) =>
    rows.filter((r) => r.status.kind === k).length;
  const failed = count("service_failed");
  const conflicts = count("identity_conflict");
  const stale = count("stale");
  const unknown =
    count("unknown") +
    count("services_unknown") +
    count("lane_stale") +
    count("headroom_unknown");
  const pressure = count("under_pressure");
  const badges: ComputersHealth["badges"] = [
    {
      key: "computers",
      label: `computers ${rows.length}`,
      tone: "muted",
      "data-testid": "coord-computers-count-badge",
    },
  ];
  if (failed > 0) {
    badges.push({
      key: "failed",
      label: `services down ${failed}`,
      tone: "attention",
      title:
        "Computers with at least one watched service down (failed or inactive — coord's `down`).",
      "data-testid": "coord-computers-failed-badge",
    });
  }
  if (conflicts > 0) {
    badges.push({
      key: "conflict",
      label: `identity conflict ${conflicts}`,
      tone: "attention",
      "data-testid": "coord-computers-conflict-badge",
    });
  }
  if (pressure > 0) {
    badges.push({
      key: "pressure",
      label: `under pressure ${pressure}`,
      tone: "default",
      "data-testid": "coord-computers-pressure-badge",
    });
  }
  if (stale > 0) {
    badges.push({
      key: "stale",
      label: `stale ${stale}`,
      tone: "default",
      title: `Last report older than ${COMPUTER_STALE_AFTER_SECS / 60} min. Their figures are last known, not current.`,
      "data-testid": "coord-computers-stale-badge",
    });
  }
  if (unknown > 0) {
    badges.push({
      key: "unknown",
      label: `unknown ${unknown}`,
      tone: "muted",
      title:
        "Computers coord cannot date, or whose services it has no count for. Unknown, not healthy.",
      "data-testid": "coord-computers-unknown-badge",
    });
  }
  badges.push({
    key: "unattributed",
    label: `unattributed CI runners ${unattributed ?? DASH}`,
    tone: "muted",
    title:
      "CI runners GitHub's registrar knows about that no reporting computer claims. Shown, not dropped: nothing says which box they run on.",
    "data-testid": "coord-computers-unattributed-badge",
  });

  if (ambiguous !== undefined) {
    badges.push({
      key: "ambiguous",
      label: `ambiguous CI runners ${ambiguous ?? DASH}`,
      tone: ambiguous !== null && ambiguous > 0 ? "default" : "muted",
      title:
        "CI runners two or more of your computers claim (a cloned image, a moved runner). Coord attributes them to none of them rather than picking a winner.",
      "data-testid": "coord-computers-ambiguous-badge",
    });
  }

  const staleRead = issue !== null;
  const needsPerson = failed + conflicts > 0;
  const level: ComputersHealth["level"] = needsPerson
    ? "red"
    : staleRead || rows.length === 0 || stale + unknown + pressure > 0
      ? "amber"
      : "green";
  const headline = needsPerson
    ? failed > 0
      ? `${failed} computer${failed === 1 ? " has" : "s have"} a failed service`
      : "A computer identity is claimed by two reporters"
    : rows.length === 0
      ? "No computer has reported — unknown, not an empty fleet"
      : stale + unknown > 0
        ? `${stale + unknown} of ${rows.length} computers are not reporting current state`
        : pressure > 0
          ? `${pressure} computer${pressure === 1 ? " is" : "s are"} at or near an admission floor`
          : staleRead
            ? "Every computer was healthy at the last good read"
            : `All ${rows.length} computers report fresh, with no failed service`;
  const detail = staleRead
    ? `Last refresh failed — these figures are stale. ${readIssueText(issue)}`
    : rows.length === 0
      ? "Coord answered with no computers. A runner that predates computer reporting sends none, so this is the absence of a report, not a measured empty fleet."
      : undefined;
  return { level, headline, detail, badges };
}

// ---------------------------------------------------------------------------
// The detail page's strip
// ---------------------------------------------------------------------------

/**
 * The drill-down's verdict. The level follows the computer's own attention
 * (red only for a measured fault a person must clear), and a read that did
 * not refresh forces amber: a retained verdict may not look re-confirmed.
 */
export function deriveComputerDetailHealth(input: {
  computer: NormalizedComputer | null;
  freshness: FreshnessReading | null;
  status: RowStatus<ComputerKind> | null;
  issue: ComputersReadIssue | null;
  services: ComputerServiceWire[] | null;
  events: ComputerEventWire[] | null;
  divergence: DivergenceWire[] | null;
  /** Only an explicit `true` makes the divergence list a measurement. */
  registrarReadOk: boolean;
}): ComputersHealth {
  const {
    computer,
    freshness,
    status,
    issue,
    services,
    events,
    divergence,
    registrarReadOk,
  } = input;
  // Not-found is a MEASUREMENT that supersedes whatever an earlier read held:
  // coord now says this computer is not in the tenant, so no retained figure
  // may headline beside it.
  if (issue?.kind === "not_found") {
    return {
      level: "amber",
      headline: "No such computer in this tenant",
      detail: readIssueText(issue),
      badges: [],
    };
  }
  if (computer === null || status === null || freshness === null) {
    return {
      level: "amber",
      headline: issue
        ? readIssueHeadline(issue, "This computer")
        : "Reading computer…",
      detail: issue ? readIssueText(issue) : undefined,
      badges: [],
    };
  }
  // `services_reported: false` makes the (empty) list UNKNOWN, not "none down".
  const failedServices =
    services === null || computer.servicesFailed === null
      ? null
      : services.filter((s) => s.down).length;
  const level: ComputersHealth["level"] =
    status.attention === "author"
      ? "red"
      : status.attention === "waiting" || issue !== null
        ? "amber"
        : "green";
  return {
    level,
    headline: `${computerName(computer)} — ${status.label}`,
    detail: issue
      ? `Last refresh failed — these figures are stale. ${readIssueText(issue)}`
      : status.reason,
    badges: [
      {
        key: "freshness",
        label: `report ${freshness.label}${freshness.ageSecs !== null ? ` · ${formatAge(freshness.ageSecs)}` : ""}`,
        tone: freshness.kind === "fresh" ? "muted" : "default",
        title: freshness.reason,
        "data-testid": "coord-computer-health-freshness",
      },
      {
        key: "services",
        label: `services down ${failedServices ?? DASH}`,
        tone:
          failedServices !== null &&
          failedServices > 0 &&
          freshness.kind === "fresh"
            ? "attention"
            : "muted",
        title:
          failedServices === null
            ? "This computer has never reported its watched services — unknown, not none."
            : freshness.kind === "fresh"
              ? "Watched units down now (failed or inactive)."
              : "Watched units that were down at the last report — not current.",
        "data-testid": "coord-computer-health-services",
      },
      {
        key: "events",
        label: `events 7d ${events === null ? DASH : events.length}`,
        tone: "muted",
        "data-testid": "coord-computer-health-events",
      },
      {
        key: "divergence",
        label: `divergence ${divergence === null || !registrarReadOk ? DASH : divergence.length}`,
        tone:
          registrarReadOk && divergence !== null && divergence.length > 0
            ? "default"
            : "muted",
        title: registrarReadOk
          ? "Where the computer's own report and a fresh CI-registrar row attributed to it disagree."
          : "Coord did not confirm a successful CI registrar read — unknown, not none.",
        "data-testid": "coord-computer-health-divergence",
      },
    ],
  };
}

/** A list field the detail read may omit: absent is `null` (UNKNOWN), never `[]`. */
export function listOrNull<T>(v: T[] | null | undefined): T[] | null {
  return Array.isArray(v) ? v : null;
}
