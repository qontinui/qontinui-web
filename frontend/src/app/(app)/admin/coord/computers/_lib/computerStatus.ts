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
 * ## Why the reader is tolerant of two spellings in a few places
 *
 * Coord's Phase 3 is being built in parallel from the same contract, and the
 * contract names some groups by meaning rather than by key ("identity",
 * "capacity", "latest sample rollup per lane"). Where a group can plausibly be
 * nested or flat, {@link normalizeComputer} reads both — once, here — so a
 * layout choice on the coord side degrades to nothing rather than to a page of
 * `unknown`s. Every OTHER field is read by exactly the contract's name, and a
 * field this build does not know is simply not rendered.
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
// Wire types — every field optional: an absent one is UNKNOWN, not a default
// ---------------------------------------------------------------------------

/** Per-axis measurement status the publisher reports (contract §2). */
export type AxisMeasurement = "measured" | "not_supported" | "unavailable";

export interface ComputerFreshnessWire {
  last_report_at?: string | null;
  age_secs?: number | null;
  /** `fresh | stale | unknown` — typed as a string so a newer coord's word reads UNKNOWN, not a parse failure. */
  state?: string | null;
}

export interface ComputerCapacityWire {
  cpu_cores?: number | null;
  memory_total_bytes?: number | null;
  swap_total_bytes?: number | null;
  disk_total_bytes?: number | null;
  gpus?: unknown;
}

export interface ComputerIdentityWire {
  hostname?: string | null;
  kind?: string | null;
  os?: string | null;
  os_version?: string | null;
  kernel?: string | null;
  arch?: string | null;
  boot_id?: string | null;
  booted_at?: string | null;
  parent_computer_id?: string | null;
  identity_conflict_at?: string | null;
}

export interface LanePressureWire {
  ratio: number;
  basis?: string | null;
}

/** The latest sample rollup for one lane (contract §4: pressure/headroom, load, psi, swap). */
export interface ComputerLaneWire {
  lane?: string | null;
  lane_instance?: string | null;
  sampled_at?: string | null;
  age_secs?: number | null;
  pressure?: LanePressureWire | number | null;
  headroom?: string | null;
  load_1m?: number | null;
  load_5m?: number | null;
  load_15m?: number | null;
  psi_memory_some_avg10?: number | null;
  psi_memory_some_avg60?: number | null;
  psi_memory_full_avg10?: number | null;
  psi_memory_full_avg60?: number | null;
  psi_cpu_some_avg10?: number | null;
  psi_cpu_some_avg60?: number | null;
  psi_cpu_full_avg10?: number | null;
  psi_cpu_full_avg60?: number | null;
  psi_io_some_avg10?: number | null;
  psi_io_some_avg60?: number | null;
  psi_io_full_avg10?: number | null;
  psi_io_full_avg60?: number | null;
  mem_total_bytes?: number | null;
  mem_available_bytes?: number | null;
  swap_total_bytes?: number | null;
  swap_used_bytes?: number | null;
  disk_total_bytes?: number | null;
  disk_free_bytes?: number | null;
  oom_kill_total?: number | null;
  measured?: Record<string, string> | null;
}

export interface ComputerDeviceWire {
  device_id: string;
  hostname?: string | null;
  kind?: string | null;
  capabilities?: string[] | null;
}

export interface CiRunnerWire {
  runner_name?: string | null;
  repo?: string | null;
  status?: string | null;
  busy?: boolean | null;
  labels?: string[] | null;
  host_key?: string | null;
}

export interface ComputerEventWire {
  event_id?: string | null;
  kind: string;
  observed_at: string;
  detail?: Record<string, unknown> | null;
}

export interface ComputerServiceWire {
  unit: string;
  kind?: string | null;
  active_state?: string | null;
  sub_state?: string | null;
  result?: string | null;
  restart_policy?: string | null;
  oom_policy?: string | null;
  memory_max?: number | null;
  memory_peak?: number | null;
  n_restarts?: number | null;
  state_changed_at?: string | null;
  observed_at?: string | null;
  runner_name?: string | null;
  repo?: string | null;
}

export interface HistoryPointWire {
  sampled_at: string;
  pressure?: LanePressureWire | number | null;
  psi_memory_some_avg60?: number | null;
}

export interface LaneHistoryWire {
  lane?: string | null;
  lane_instance?: string | null;
  points?: HistoryPointWire[] | null;
}

/** One reported-vs-registrar disagreement. The contract fixes no inner shape, so it is rendered key by key. */
export type DivergenceWire = Record<string, unknown>;

export interface ComputerSummaryWire extends ComputerIdentityWire {
  computer_id: string;
  identity?: ComputerIdentityWire | null;
  capacity?: ComputerCapacityWire | null;
  cpu_cores?: number | null;
  memory_total_bytes?: number | null;
  swap_total_bytes?: number | null;
  disk_total_bytes?: number | null;
  gpus?: unknown;
  access?: Record<string, unknown> | null;
  freshness?: ComputerFreshnessWire | null;
  lanes?: ComputerLaneWire[] | null;
  latest_samples?: ComputerLaneWire[] | null;
  services_failed?: number | null;
  last_event?: ComputerEventWire | null;
  devices?: ComputerDeviceWire[] | null;
  ci_runners?: CiRunnerWire[] | null;
}

export interface ComputerWorkloadsWire {
  devices?: ComputerDeviceWire[] | null;
  agent_sessions?: Record<string, unknown>[] | null;
  ci_runners?: CiRunnerWire[] | null;
}

export interface ComputerDetailWire extends ComputerSummaryWire {
  services?: ComputerServiceWire[] | null;
  events?: ComputerEventWire[] | null;
  history?: LaneHistoryWire[] | null;
  sample_history?: LaneHistoryWire[] | null;
  workloads?: ComputerWorkloadsWire | null;
  divergence?: DivergenceWire[] | null;
}

export interface ComputersListWire {
  computers?: ComputerSummaryWire[] | null;
  unattributed_ci_runners?: CiRunnerWire[] | null;
  schema_pending?: boolean | null;
  state?: string | null;
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
 * `alembic-sole-authorship` orders it first). Accepted as an error code on any
 * status, or as a 200 body flag — coord's handler may take either shape.
 */
export function isSchemaPendingBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    b.error === "schema_pending" ||
    b.state === "schema_pending" ||
    b.schema_pending === true
  );
}

/**
 * The error code a DETAIL read's 404 carries when coord answered "no such
 * computer in your tenant" — as opposed to a 404 because this coord does not
 * serve the route at all. Both are 404s, and they are different claims: one
 * is a measurement, the other is no measurement. Anything that is not one of
 * these codes (an empty body, the web's own `{"error":"NOT_FOUND"}`) reads as
 * route-unavailable, which is the UNKNOWN side — the safe side to err on.
 */
const COMPUTER_NOT_FOUND_CODES = new Set([
  "computer_not_found",
  "computer_not_found_in_tenant_scope",
  "not_found_in_tenant_scope",
]);

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
// Normalization — the two-spelling tolerance lives here and nowhere else
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
  hostname: string | null;
  kind: string | null;
  os: string | null;
  osVersion: string | null;
  kernel: string | null;
  arch: string | null;
  bootedAt: string | null;
  parentComputerId: string | null;
  identityConflictAt: string | null;
  capacity: Capacity;
  freshness: ComputerFreshnessWire | null;
  lanes: ComputerLaneWire[];
  /** The contract's `services_failed`. `null` = coord did not say — UNKNOWN, not 0. */
  servicesFailed: number | null;
  /**
   * `undefined` = coord's answer carried no `last_event` key (UNKNOWN);
   * `null` = coord said there is none in the retention window.
   */
  lastEvent: ComputerEventWire | null | undefined;
  /** `null` = coord sent no list — UNKNOWN, never "no devices". */
  devices: ComputerDeviceWire[] | null;
  ciRunners: CiRunnerWire[] | null;
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export function normalizeComputer(c: ComputerSummaryWire): NormalizedComputer {
  const id = c.identity ?? {};
  const cap = c.capacity ?? {};
  const pick = <K extends keyof ComputerIdentityWire>(k: K) =>
    str(id[k]) ?? str(c[k]);
  return {
    computerId: c.computer_id,
    hostname: pick("hostname"),
    kind: pick("kind"),
    os: pick("os"),
    osVersion: pick("os_version"),
    kernel: pick("kernel"),
    arch: pick("arch"),
    bootedAt: pick("booted_at"),
    parentComputerId: pick("parent_computer_id"),
    identityConflictAt: pick("identity_conflict_at"),
    capacity: {
      cpuCores: num(cap.cpu_cores) ?? num(c.cpu_cores),
      memoryTotalBytes:
        num(cap.memory_total_bytes) ?? num(c.memory_total_bytes),
      swapTotalBytes: num(cap.swap_total_bytes) ?? num(c.swap_total_bytes),
      diskTotalBytes: num(cap.disk_total_bytes) ?? num(c.disk_total_bytes),
      gpus: cap.gpus ?? c.gpus ?? null,
    },
    freshness: c.freshness ?? null,
    lanes: arr<ComputerLaneWire>(c.lanes ?? c.latest_samples),
    servicesFailed: num(c.services_failed),
    lastEvent: "last_event" in c ? (c.last_event ?? null) : undefined,
    devices: Array.isArray(c.devices) ? c.devices : null,
    ciRunners: Array.isArray(c.ci_runners) ? c.ci_runners : null,
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
  if (
    word === "stale" ||
    (ageSecs !== null && ageSecs > COMPUTER_STALE_AFTER_SECS)
  ) {
    return {
      kind: "stale",
      ageSecs,
      label: "STALE",
      reason: `Last report ${formatAge(ageSecs)} — older than ${COMPUTER_STALE_AFTER_SECS / 60} min (3 × the ${COMPUTER_REPORT_CADENCE_SECS / 60} min report cadence). Figures below are the last known, not current.`,
    };
  }
  if (word !== "fresh" && word !== null) {
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
 * A lane's own sample freshness — samples run on a 30 s cadence, not 300 s, so
 * a lane can be stale inside a fresh computer. A stale COMPUTER makes every
 * lane stale too: nothing it last reported is current.
 */
export function laneFreshness(
  lane: ComputerLaneWire,
  computer: FreshnessReading,
  fetchedAtMs: number | null,
  nowMs: number
): FreshnessReading {
  const ageSecs = ageFrom(lane.age_secs, fetchedAtMs, nowMs);
  if (ageSecs === null) {
    return {
      kind: "unknown",
      ageSecs,
      label: "UNKNOWN",
      reason: "No sample age for this lane — its figures cannot be dated.",
    };
  }
  if (computer.kind !== "fresh" || ageSecs > SAMPLE_STALE_AFTER_SECS) {
    return {
      kind: "stale",
      ageSecs,
      label: "STALE",
      reason: `Last sample ${formatAge(ageSecs)} — older than ${SAMPLE_STALE_AFTER_SECS} s (3 × the ${SAMPLE_CADENCE_SECS} s sample cadence), or the computer itself is not fresh. Last known, not current.`,
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

/** A lane's pressure ratio, from either the object or the bare-number spelling. */
export function pressureRatio(
  p: LanePressureWire | number | null | undefined
): number | null {
  if (typeof p === "number") return num(p);
  if (p && typeof p === "object") return num(p.ratio);
  return null;
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
  return arr<HistoryPointWire>(series?.points).map((p) => ({
    sampled_at: p.sampled_at,
    pressure: pressureRatio(p.pressure),
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

export function laneKey(lane: {
  lane?: string | null;
  lane_instance?: string | null;
}): string {
  return `${lane.lane ?? "unknown"}:${lane.lane_instance ?? ""}`;
}

/** Map each lane to its history series by `(lane, lane_instance)`. */
export function historyByLane(
  detail: ComputerDetailWire | null
): Map<string, LaneHistoryWire> {
  const m = new Map<string, LaneHistoryWire>();
  for (const s of arr<LaneHistoryWire>(
    detail?.history ?? detail?.sample_history
  )) {
    m.set(laneKey(s), s);
  }
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
        : ` Last known: ${c.servicesFailed} failed service${c.servicesFailed === 1 ? "" : "s"}.`;
    return make("stale", "stale", `${freshness.reason}${lastKnown}`);
  }
  if (c.servicesFailed !== null && c.servicesFailed > 0) {
    return make(
      "service_failed",
      `${c.servicesFailed} service${c.servicesFailed === 1 ? "" : "s"} failed`,
      "A watched service is in the failed state and its restart policy will not bring it back."
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
    return make(
      "under_pressure",
      "under pressure",
      `Lane ${pressured.map((s) => laneName(s.lane)).join(", ")} is at or below an admission floor, so coord is deferring or refusing work here until it recovers.`
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
  if (c.servicesFailed === null) {
    return make(
      "services_unknown",
      "services unknown",
      "The computer reports, but coord has no service count for it — a failed service here would not show."
    );
  }
  return make("healthy", "healthy", freshness.reason);
}

/** A watched service's state, bucketed. */
export type ServiceKind =
  | "active"
  | "transitioning"
  | "inactive"
  | "failed"
  | "unknown";

/**
 * - `failed` — AUTHOR: systemd gave up on it (the `Result=oom-kill` unit).
 * - `transitioning` — WAITING: activating / deactivating / reloading clears
 *   itself one way or the other.
 * - `inactive` — WAITING: a stopped unit may be deliberate or may be the
 *   fault; we do not know which, and coord's `machine_service_failed` alert
 *   is what times it out (> 5 min), not this page.
 * - `unknown` — WAITING: no state, or the computer is stale so the last state
 *   is not current.
 * - `active` — none.
 */
export const SERVICE_ATTENTION_BY_KIND = {
  active: "none",
  transitioning: "waiting",
  inactive: "waiting",
  failed: "author",
  unknown: "waiting",
} satisfies AttentionMap<ServiceKind>;

export const SERVICE_BADGE_CLASS: Record<ServiceKind, string> = {
  active: FRESH_GREEN,
  transitioning: WAITING_AMBER,
  inactive: WAITING_AMBER,
  failed: AUTHOR_RED,
  unknown: UNKNOWN_AMBER,
};

export const SERVICE_AUTHOR_GLYPH_KINDS: ReadonlySet<ServiceKind> =
  new Set<ServiceKind>(["failed"]);

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
  const kind: ServiceKind =
    state === "active"
      ? "active"
      : state === "failed"
        ? "failed"
        : state === "inactive"
          ? "inactive"
          : state === "activating" ||
              state === "deactivating" ||
              state === "reloading"
            ? "transitioning"
            : "unknown";
  const reason =
    kind === "failed"
      ? `Failed${result ? ` (result: ${result})` : ""}.`
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

/** The event's subject — the unit or victim it names, if any. */
export function eventSubject(e: ComputerEventWire): string | null {
  const d = e.detail ?? {};
  return (
    str(d.unit) ??
    str(d.victim_unit) ??
    str(d.victim) ??
    str(d.process) ??
    str(d.reason) ??
    null
  );
}

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
  return arr<ComputerSummaryWire>(list?.computers).map((raw) => {
    const computer = normalizeComputer(raw);
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
}): ComputersHealth {
  const { rows, loaded, issue, unattributed } = input;
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
    count("unknown") + count("services_unknown") + count("lane_stale");
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
      label: `services failed ${failed}`,
      tone: "attention",
      title: "Computers with at least one watched service in the failed state.",
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
          ? `${pressure} computer${pressure === 1 ? " is" : "s are"} at an admission floor`
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
}): ComputersHealth {
  const { computer, freshness, status, issue, services, events, divergence } =
    input;
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
  const failedServices =
    services === null
      ? null
      : services.filter((s) => s.active_state === "failed").length;
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
        label: `failed services ${failedServices ?? DASH}`,
        tone:
          failedServices !== null &&
          failedServices > 0 &&
          freshness.kind === "fresh"
            ? "attention"
            : "muted",
        title:
          services === null
            ? "Coord sent no service list — unknown, not none."
            : freshness.kind === "fresh"
              ? "Watched units in the failed state now."
              : "Watched units that were failed at the last report — not current.",
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
        label: `divergence ${divergence === null ? DASH : divergence.length}`,
        tone:
          divergence !== null && divergence.length > 0 ? "default" : "muted",
        title:
          "Places the computer's own report and the CI registrar disagree about what runs here.",
        "data-testid": "coord-computer-health-divergence",
      },
    ],
  };
}

/** A list field the detail read may omit: absent is `null` (UNKNOWN), never `[]`. */
export function listOrNull<T>(v: T[] | null | undefined): T[] | null {
  return Array.isArray(v) ? v : null;
}
