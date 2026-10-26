/**
 * sessionLoadStatus — everything `/admin/coord/session-load` derives from
 * coord's session run record: the wire shapes, the read-failure readings, the
 * per-work-type and per-machine lines, the growth series and its trend, the
 * health strip, and each run's status and its R3 attention table.
 *
 * Plan `2026-10-23-session-duration-by-work-type-and-per-device-session-load`
 * Phase 5; its D4 defines the three durations and D5 the per-machine
 * concurrency and the budget states. A pure module with no JSX, so each
 * reading is unit-tested over its whole union (console style guide R8).
 *
 * ## Every number names its unit
 *
 * - **slot-hours** (`slot-h`) — hours a session slot was held: the sum of
 *   `coalesce(ended_at, now) − started_at`, open and inferred runs included
 *   (coord's `slot_hours_definition`). The capacity quantity.
 * - **wall time** — `ended_at − started_at` of one run, percentiles over
 *   OBSERVED ends only; inferred ends and open runs are counted beside them.
 * - **held after finish** — `ended_at − finished_at`: slot time a session
 *   kept after it declared itself finished, as a share of slot-hours.
 * - **open runs** — runs open at one instant on one machine, against its
 *   **configured session budget** (`coord.devices.max_concurrent_agents`) —
 *   never called "capacity".
 *
 * ## What this module will not say
 *
 * - **0 for a number coord could not state.** A percentile over no observed
 *   end, a held share where no run declared itself finished, a budget no
 *   machine published, a count missing from a body: the word `unknown`.
 * - **"No runs" when the run record is not deployed.** coord answers
 *   `503 {"error": "schema_missing"}` while `coord.session_runs` is absent;
 *   that is its own reading (`not_deployed`), never an empty fleet.
 * - **An open-run count for a machine that has gone silent.** A device whose
 *   heartbeat is older than {@link SILENT_HEARTBEAT_SECS} may have runs that
 *   ended without coord hearing (D6 leaves them open on purpose), so its
 *   "open now" is UNKNOWN, with the recorded number beside it.
 * - **A budget read from `coord.devices.role`.** Phase 0 measured `role =
 *   'build'` on every device; the budget is read from coord's `budget.state`
 *   alone (`published` / `zero` / `none`).
 * - **A crossing date from too little history.** The growth trend is a linear
 *   fit over the last {@link TREND_DAYS} complete days, and it is withheld —
 *   with the reason — when recording began too recently on the fleet or on
 *   any one machine, because a machine that just started recording would read
 *   as growth.
 */

import type { HealthBadge, HealthStripLevel } from "@/components/console";
import { readIsUnknown } from "@/components/console/readFailure";
import type { Attention } from "@/components/console/attention";
import {
  CI_YELLOW,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  type RowStatus,
  type StatusPalette,
} from "@/components/console/statusRow";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import {
  ROUTE_DISABLED_TEXT,
  classifyCoordError,
} from "@/components/operations/coordPollError";
import { operationsErrorMessage } from "@/lib/api/operations/base";
import type {
  ConcurrencyBucket,
  SessionRunsWindow,
} from "@/lib/api/operations/coordSessionRuns";
import { formatDuration } from "../../spawns/_lib/spawnStatus";

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export type SessionLoadWindow = "24h" | "7d" | "30d" | "90d";

export interface SessionLoadWindowSpec {
  id: SessionLoadWindow;
  /** "the last 7 days" — reads after "in". */
  label: string;
  seconds: number;
  /**
   * The concurrency series bucket for this window: coord caps a series at
   * 2000 buckets, and a window past its 31-day raw horizon reads the hourly
   * rollup, which cannot be bucketed finer than an hour.
   */
  bucket: ConcurrencyBucket;
  bucketLabel: string;
}

export const SESSION_LOAD_WINDOWS: ReadonlyArray<SessionLoadWindowSpec> = [
  {
    id: "24h",
    label: "the last 24 hours",
    seconds: 86_400,
    bucket: "15m",
    bucketLabel: "15-minute",
  },
  {
    id: "7d",
    label: "the last 7 days",
    seconds: 7 * 86_400,
    bucket: "1h",
    bucketLabel: "hourly",
  },
  {
    id: "30d",
    label: "the last 30 days",
    seconds: 30 * 86_400,
    bucket: "6h",
    bucketLabel: "6-hour",
  },
  {
    id: "90d",
    label: "the last 90 days",
    seconds: 90 * 86_400,
    bucket: "1d",
    bucketLabel: "daily",
  },
];

export function sessionLoadWindowSpec(
  id: SessionLoadWindow
): SessionLoadWindowSpec {
  return (
    SESSION_LOAD_WINDOWS.find((w) => w.id === id) ?? SESSION_LOAD_WINDOWS[1]!
  );
}

/** The growth read is always 90 days of daily buckets (the sparkline's span). */
export const GROWTH_WINDOW: SessionRunsWindow = "90d";

// ---------------------------------------------------------------------------
// Wire shapes — the shared contract for coord's `/coord/session-runs…` reads
// ---------------------------------------------------------------------------

/**
 * One `coord.session_runs` row as coord serves it. Enumerated columns are
 * typed `string`, not unions, on purpose: a coord newer than this build must
 * render its new value as itself, not fail to parse.
 */
export interface SessionRunWire {
  id: string;
  device_id: string;
  claude_code_session_id: string;
  run_seq: number;
  initiator: string;
  work_type: string;
  classifier_version?: number | null;
  skill?: string | null;
  first_command?: string | null;
  spawn_origin?: string | null;
  spawn_kind?: string | null;
  dispatch_source?: string | null;
  diagnosis_kind?: string | null;
  gate_registered_by?: string | null;
  gate_id?: string | null;
  agent_id?: string | null;
  spawn_request_id?: string | null;
  coord_session_id?: string | null;
  bind_origin?: string | null;
  repo?: string | null;
  work_unit_slug?: string | null;
  provider?: string | null;
  model?: string | null;
  account_label?: string | null;
  started_at: string;
  first_turn_at?: string | null;
  finished_at?: string | null;
  ended_at?: string | null;
  last_seen_at?: string | null;
  active_seconds?: number | null;
  wall_seconds?: number | null;
  held_after_finish_seconds?: number | null;
  end_reason?: string | null;
  end_source?: string | null;
  close_reason?: string | null;
  clock_skew_seconds?: number | null;
  history_complete?: boolean;
}

export interface SessionRunListWire {
  runs: unknown[];
  shown?: number;
  total?: number | null;
  truncated?: boolean;
  next_cursor?: string | null;
  as_of: string;
}

export interface StatsGroupWire {
  work_type?: string | null;
  work_type_description?: string | null;
  device_id?: string | null;
  runs?: number;
  open_now?: number;
  wall_seconds?: {
    p50?: number | null;
    p90?: number | null;
    p99?: number | null;
    sum?: number | null;
    samples?: number;
  };
  slot_hours?: number | null;
  active_seconds?: { p50?: number | null; samples?: number };
  held_after_finish_seconds?: { sum?: number | null; samples?: number };
  inferred_count?: number;
  reconciled_count?: number;
  unknown_count?: number;
}

export interface StatsWire {
  window_seconds: number;
  since?: string;
  group_by?: string;
  groups: StatsGroupWire[];
  classifier_version?: number;
  as_of: string;
}

export interface BudgetWire {
  state?: string;
  value?: number | null;
  label?: string;
}

export interface ConcurrencyBucketWire {
  bucket_start: string;
  source?: string;
  total?: { peak?: number; p95?: number; total_peak_is_upper_bound?: boolean };
  by_work_type?: Record<string, { peak?: number; p95?: number }>;
}

export interface ConcurrencyDeviceWire {
  device_id: string;
  name?: string | null;
  budget?: BudgetWire;
  last_heartbeat?: string | null;
  heartbeat_age_seconds?: number | null;
  known_device?: boolean;
  open_now?: number;
  peak?: number;
  p95?: number;
  p95_scope?: string;
  series?: ConcurrencyBucketWire[];
}

export interface ConcurrencyWire {
  window_seconds: number;
  bucket_seconds?: number;
  devices: ConcurrencyDeviceWire[];
  truncated?: boolean;
  as_of: string;
}

export interface GrowthBucketWire {
  bucket_start: string;
  partial?: boolean;
  runs?: Record<string, number>;
  slot_hours?: Record<string, number>;
  runs_total?: number;
  slot_hours_total?: number;
  backfilled_runs?: number;
}

export interface GrowthFleetWire {
  /**
   * The sum of published non-zero configured session budgets × 24. coord
   * sends `null` — never 0 — when no device published a non-zero budget, and
   * says so in {@link GrowthFleetWire.available_state}.
   */
  available_slot_hours_per_day?: number | null;
  /** The same figure per growth bucket; `null` exactly when the per-day one is. */
  available_slot_hours_per_bucket?: number | null;
  /**
   * coord's verdict on the figure — {@link AVAILABLE_STATE_PUBLISHED} (some
   * device published a non-zero budget; the figure is stated),
   * {@link AVAILABLE_STATE_ZERO_BUDGET} (no non-zero budget, and at least one
   * device published 0; figure `null`) or {@link AVAILABLE_STATE_NO_BUDGET}
   * (no device published any budget, zero or otherwise; figure `null`).
   * Absent from a coord that predates the field. Typed `string` so a newer value renders as
   * unknown rather than failing to parse.
   */
  available_state?: string | null;
  devices_with_budget?: number;
  devices_zero_budget?: number;
  devices_without_budget?: number;
}

export interface GrowthWire {
  window_seconds: number;
  bucket_seconds: number;
  recording_since: string | null;
  devices_recording?: { device_id: string; recording_since: string }[];
  series: GrowthBucketWire[];
  fleet?: GrowthFleetWire;
  truncated?: boolean;
  as_of: string;
}

// ---------------------------------------------------------------------------
// Reading a body, and reading a failure
// ---------------------------------------------------------------------------

/**
 * Why a read produced nothing to render. Every arm is UNKNOWN about the run
 * record's contents — none of them is "no runs".
 */
export type SessionLoadIssue =
  /** coord's `503 {"error": "schema_missing"}` — `coord.session_runs` is absent. */
  | { kind: "not_deployed" }
  /** 404/405/501 — this deployment does not serve the route yet. */
  | { kind: "route_unavailable" }
  /** coord answered `404 {"error": "route_disabled"}`. */
  | { kind: "route_disabled" }
  /** The web gate: only a coord tenant admin may read the run record. */
  | { kind: "forbidden" }
  | { kind: "tenant_not_resolved" }
  /** coord's `400 {"error": "invalid_query_parameter", field, reason}`. */
  | { kind: "refused"; field: string | null; reason: string | null }
  | { kind: "deadline"; budgetMs: number | null }
  /** The body answers a different window from the one asked for. */
  | {
      kind: "window_mismatch";
      askedSeconds: number;
      answeredSeconds: number | null;
    }
  /** A 2xx whose body is not the contract's shape. */
  | { kind: "malformed" }
  | { kind: "error"; message: string };

export type SessionLoadReading<T> =
  | { kind: "ok"; body: T }
  | { kind: "issue"; issue: SessionLoadIssue };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function malformed<T>(): SessionLoadReading<T> {
  return { kind: "issue", issue: { kind: "malformed" } };
}

function windowChecked<T>(
  body: Record<string, unknown>,
  askedSeconds: number | undefined
): SessionLoadReading<T> {
  if (askedSeconds !== undefined && body.window_seconds !== askedSeconds) {
    return {
      kind: "issue",
      issue: {
        kind: "window_mismatch",
        askedSeconds,
        answeredSeconds:
          typeof body.window_seconds === "number" ? body.window_seconds : null,
      },
    };
  }
  return { kind: "ok", body: body as unknown as T };
}

/** The minimum a run needs to be listed: its identity, device, type and clock. */
export function isSessionRun(v: unknown): v is SessionRunWire {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.device_id === "string" &&
    typeof v.work_type === "string" &&
    typeof v.started_at === "string"
  );
}

/** Read a `GET /session-runs` body. */
export function readRunList(
  body: unknown
): SessionLoadReading<SessionRunListWire> {
  if (
    !isRecord(body) ||
    !Array.isArray(body.runs) ||
    typeof body.as_of !== "string"
  ) {
    return malformed();
  }
  return { kind: "ok", body: body as unknown as SessionRunListWire };
}

/** Read a `GET /session-runs/stats` body; with `askedSeconds`, refuse another window's. */
export function readStats(
  body: unknown,
  askedSeconds?: number
): SessionLoadReading<StatsWire> {
  if (
    !isRecord(body) ||
    !Array.isArray(body.groups) ||
    typeof body.as_of !== "string"
  ) {
    return malformed();
  }
  return windowChecked<StatsWire>(body, askedSeconds);
}

/** Read a `GET /session-runs/concurrency` body. */
export function readConcurrency(
  body: unknown,
  askedSeconds?: number
): SessionLoadReading<ConcurrencyWire> {
  if (
    !isRecord(body) ||
    !Array.isArray(body.devices) ||
    typeof body.as_of !== "string"
  ) {
    return malformed();
  }
  return windowChecked<ConcurrencyWire>(body, askedSeconds);
}

/** Read a `GET /session-runs/growth` body. */
export function readGrowth(body: unknown): SessionLoadReading<GrowthWire> {
  if (
    !isRecord(body) ||
    !Array.isArray(body.series) ||
    typeof body.bucket_seconds !== "number" ||
    typeof body.as_of !== "string" ||
    !(body.recording_since === null || typeof body.recording_since === "string")
  ) {
    return malformed();
  }
  return { kind: "ok", body: body as unknown as GrowthWire };
}

function parseObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Classify a rejected read. coord's `schema_missing` is a 503 like its read
 * deadline, so it is read from the body BEFORE the generic coord classifier;
 * the web gate's 403 codes are read from whichever key carries them, as the
 * spawns console does.
 */
export function classifySessionLoadError(err: unknown): SessionLoadIssue {
  const status = httpStatusOf(err);
  const bodyText = httpBodyOf(err);
  const body = parseObject(bodyText);
  if (status === 503 && body?.error === "schema_missing") {
    return { kind: "not_deployed" };
  }
  if (status === 403) {
    const code = [body?.message, body?.detail, body?.error].find(
      (v): v is string =>
        v === "not_coord_tenant_admin" || v === "tenant_not_resolved"
    );
    if (code === "not_coord_tenant_admin") return { kind: "forbidden" };
    if (code === "tenant_not_resolved") return { kind: "tenant_not_resolved" };
  }
  if (status === 400 && body?.error === "invalid_query_parameter") {
    return {
      kind: "refused",
      field: typeof body.field === "string" ? body.field : null,
      reason: typeof body.reason === "string" ? body.reason : null,
    };
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
      return { kind: "error", message: operationsErrorMessage(err) };
  }
}

/**
 * Does this issue SUPERSEDE a retained body rather than age it? An answer
 * about the data itself — the record is absent, the caller may not read it,
 * coord refused the question, the body answers another window — clears the
 * last body; every other failure keeps it, labelled stale.
 */
export function issueClearsRetained(issue: SessionLoadIssue): boolean {
  return (
    issue.kind === "not_deployed" ||
    issue.kind === "forbidden" ||
    issue.kind === "tenant_not_resolved" ||
    issue.kind === "refused" ||
    issue.kind === "window_mismatch"
  );
}

/** The one-line reading of an issue, for a banner or a section's empty slot. */
export function sessionLoadIssueText(
  issue: SessionLoadIssue,
  subject: string
): string {
  switch (issue.kind) {
    case "not_deployed":
      return `Session run record not deployed yet — coord answered that coord.session_runs is not migrated, so ${subject} is unknown, not empty.`;
    case "route_unavailable":
      return `Coord does not serve the session run record yet, so ${subject} is unknown, not empty.`;
    case "route_disabled":
      return `The session run read is ${ROUTE_DISABLED_TEXT} on coord, so ${subject} is unknown, not empty.`;
    case "forbidden":
      return "Only a coord tenant admin of the active project may read session load.";
    case "tenant_not_resolved":
      return "No project was resolved for this read; select a project and try again.";
    case "refused":
      return `Coord refused the question${issue.field ? ` (${issue.field}${issue.reason ? `: ${issue.reason}` : ""})` : ""}, so ${subject} is unknown.`;
    case "deadline":
      return `Coord's read deadline${issue.budgetMs === null ? "" : ` (${issue.budgetMs} ms)`} ran out, so ${subject} is unknown.`;
    case "window_mismatch":
      return `Coord answered for a different window than the one asked for, so ${subject} is unknown.`;
    case "malformed":
      return `Coord answered with a body this page cannot read, so ${subject} is unknown.`;
    case "error":
      return `Could not read ${subject} — ${issue.message}`;
  }
}

// ---------------------------------------------------------------------------
// Words and numbers
// ---------------------------------------------------------------------------

const WORK_TYPE_LABEL: Record<string, string> = {
  post_merge: "post-merge follow-up",
  pr_fix_red_ci: "PR fix — red CI",
  pr_fix_conflict: "PR fix — merge conflict",
  admission_stall_fix: "admission-stall fix",
  red_main_fix: "red-main fix",
  merge_shepherd: "merge shepherd",
  next_step: "next step",
  unit_dispatch: "work-unit dispatch",
  condition_autodispatch: "condition auto-dispatch",
  operator_page_remediation: "operator-page remediation",
  implement_plan: "/implement-plan",
  implement_phase: "/implement-phase",
  vet_imp: "/vet-imp",
  vet_plan: "/vet-plan",
  verify_plan_status: "/verify-plan-status",
  gate_continuation_other: "other gate continuation",
  steward: "steward",
  onboarding_audit: "onboarding audit",
  operator_interactive: "operator, interactive",
  unknown: "unclassified",
};

/** A work type in words. An unrecognised token is shown as itself. */
export function workTypeLabel(workType: string | null | undefined): string {
  if (workType == null || workType === "") return "unclassified";
  return WORK_TYPE_LABEL[workType] ?? workType;
}

const INITIATOR_LABEL: Record<string, string> = {
  operator: "operator",
  coord: "coord",
  runner_local: "the runner itself",
  unknown: "initiator unknown",
};

export function initiatorLabel(initiator: string): string {
  return INITIATOR_LABEL[initiator] ?? initiator;
}

const END_REASON_LABEL: Record<string, string> = {
  exited: "the session exited",
  poll_dead: "the liveness poll found it gone",
  superseded: "superseded by a newer session",
  operator_closed: "the operator closed it",
  finished_close: "closed after it finished",
  runner_stopped: "the runner stopped",
  handoff_detached: "handed off to the next runner",
  inferred_lost: "inferred lost — its device stopped reporting it",
  other: "another close reason",
};

export function endReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "not recorded";
  return END_REASON_LABEL[reason] ?? reason;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A count coord sent, or `unknown` — never defaulted to 0. */
export function countText(v: unknown): string {
  const n = finite(v);
  return n === null ? "unknown" : String(Math.round(n));
}

/** `1 run`, `3 runs`, `unknown runs` — a count with its noun, never a bare 0 for unknown. */
export function runsText(v: unknown): string {
  const n = finite(v);
  return n === null
    ? "unknown runs"
    : `${Math.round(n)} run${Math.round(n) === 1 ? "" : "s"}`;
}

/** Slot-hours with their unit: `0.4 slot-h`, `12 slot-h`. `null` is `unknown`. */
export function formatSlotHours(hours: number | null | undefined): string {
  const h = finite(hours);
  if (h === null || h < 0) return "unknown";
  if (h === 0) return "0 slot-h";
  if (h < 10) return `${Number(h.toFixed(1)) || "<0.1"} slot-h`;
  return `${Math.round(h).toLocaleString("en-US")} slot-h`;
}

/** Slot-hours per day, with the unit. */
export function formatSlotHoursPerDay(
  hours: number | null | undefined
): string {
  const text = formatSlotHours(hours);
  return text === "unknown" ? text : `${text}/day`;
}

/** A duration in seconds with its unit (`12 min`, `1.5 h`). `null` is `unknown`. */
export function formatSeconds(secs: number | null | undefined): string {
  const s = finite(secs);
  return s === null ? "unknown" : formatDuration(s);
}

/** A fraction as a percentage (`37%`, `<1%`). `null` is `unknown`. */
export function formatPercent(fraction: number | null | undefined): string {
  const f = finite(fraction);
  if (f === null || f < 0) return "unknown";
  if (f === 0) return "0%";
  const pct = f * 100;
  if (pct < 1) return "<1%";
  return `${Math.round(pct)}%`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

const DAY_MS = 86_400_000;

/** A UTC calendar date, `2026-10-26`. */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// By work type
// ---------------------------------------------------------------------------

export type HeldShare =
  | { kind: "known"; fraction: number; heldHours: number; samples: number }
  | { kind: "unknown"; reason: string };

export interface WorkTypeLine {
  workType: string;
  label: string;
  description: string | null;
  runs: number | null;
  openNow: number | null;
  wallP50: number | null;
  wallP90: number | null;
  wallSamples: number | null;
  slotHours: number | null;
  held: HeldShare;
  inferred: number | null;
  reconciled: number | null;
}

function heldShare(g: StatsGroupWire, slotHours: number | null): HeldShare {
  const samples = finite(g.held_after_finish_seconds?.samples);
  const sum = finite(g.held_after_finish_seconds?.sum);
  if (samples === null) {
    return { kind: "unknown", reason: "coord sent no held-after-finish count" };
  }
  if (samples === 0 || sum === null) {
    return {
      kind: "unknown",
      reason:
        "no run of this type both declared itself finished and ended, so how long finished sessions held their slot is unknown",
    };
  }
  if (slotHours === null || slotHours <= 0) {
    return { kind: "unknown", reason: "no slot-hours to take a share of" };
  }
  const heldHours = sum / 3600;
  return {
    kind: "known",
    fraction: Math.min(1, heldHours / slotHours),
    heldHours,
    samples,
  };
}

/** One line per work type, most slot-hours first (unknown slot-hours last). */
export function workTypeLines(stats: StatsWire): WorkTypeLine[] {
  const lines = stats.groups.map((g): WorkTypeLine => {
    const slotHours = finite(g.slot_hours);
    const workType = typeof g.work_type === "string" ? g.work_type : "unknown";
    return {
      workType,
      label: workTypeLabel(workType),
      description:
        typeof g.work_type_description === "string"
          ? g.work_type_description
          : null,
      runs: finite(g.runs),
      openNow: finite(g.open_now),
      wallP50: finite(g.wall_seconds?.p50),
      wallP90: finite(g.wall_seconds?.p90),
      wallSamples: finite(g.wall_seconds?.samples),
      slotHours,
      held: heldShare(g, slotHours),
      inferred: finite(g.inferred_count),
      reconciled: finite(g.reconciled_count),
    };
  });
  return lines.sort(
    (a, b) =>
      (b.slotHours ?? -1) - (a.slotHours ?? -1) ||
      a.label.localeCompare(b.label)
  );
}

/** `median 12 min · p90 1.5 h (40 observed ends)`, or the reason it is unknown. */
export function wallTimeText(line: WorkTypeLine): string {
  if (line.wallSamples === 0) {
    return "wall time unknown — no run of this type has an observed end yet";
  }
  return `median ${formatSeconds(line.wallP50)} · p90 ${formatSeconds(line.wallP90)} wall time${
    line.wallSamples === null
      ? ""
      : ` (${plural(line.wallSamples, "observed end")})`
  }`;
}

export function heldShareText(held: HeldShare): string {
  if (held.kind === "unknown") return "unknown";
  return `${formatPercent(held.fraction)} of slot-hours (${formatSlotHours(held.heldHours)} over ${plural(held.samples, "finished run")})`;
}

/** The fleet totals the stats read implies — each `null` when any group lacks it. */
export interface StatsTotals {
  runs: number | null;
  openNow: number | null;
  slotHours: number | null;
  inferred: number | null;
  reconciled: number | null;
  unknownRuns: number | null;
}

function sumOrNull(values: (number | null)[]): number | null {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return total;
}

export function statsTotals(stats: StatsWire): StatsTotals {
  const g = stats.groups;
  return {
    runs: sumOrNull(g.map((x) => finite(x.runs))),
    openNow: sumOrNull(g.map((x) => finite(x.open_now))),
    slotHours: sumOrNull(g.map((x) => finite(x.slot_hours))),
    inferred: sumOrNull(g.map((x) => finite(x.inferred_count))),
    reconciled: sumOrNull(g.map((x) => finite(x.reconciled_count))),
    unknownRuns: sumOrNull(g.map((x) => finite(x.unknown_count))),
  };
}

// ---------------------------------------------------------------------------
// Growth: daily series, the sparkline, and the trend
// ---------------------------------------------------------------------------

export interface GrowthDay {
  dayMs: number;
  totalSlotHours: number;
  byType: Record<string, number>;
}

/**
 * The first bucket start at or after `recording_since` — the first bucket the
 * runner recorded IN FULL. `null` when nothing is recorded yet.
 */
export function firstCompleteBucketMs(growth: GrowthWire): number | null {
  if (growth.recording_since === null) return null;
  const since = Date.parse(growth.recording_since);
  if (!Number.isFinite(since)) return null;
  const step = growth.bucket_seconds * 1000;
  return Math.ceil(since / step) * step;
}

/**
 * The buckets this page draws: recorded in full (from
 * {@link firstCompleteBucketMs}) and closed (not the bucket holding now).
 * Earlier buckets hold only backfilled runs and are left out — never drawn as
 * zeros.
 */
export function completeGrowthDays(growth: GrowthWire): GrowthDay[] {
  const first = firstCompleteBucketMs(growth);
  if (first === null) return [];
  const out: GrowthDay[] = [];
  for (const b of growth.series) {
    const ms = Date.parse(b.bucket_start);
    if (!Number.isFinite(ms) || ms < first || b.partial === true) continue;
    const byType: Record<string, number> = {};
    for (const [wt, v] of Object.entries(b.slot_hours ?? {})) {
      const n = finite(v);
      if (n !== null) byType[wt] = n;
    }
    out.push({
      dayMs: ms,
      totalSlotHours:
        finite(b.slot_hours_total) ??
        Object.values(byType).reduce((s, v) => s + v, 0),
      byType,
    });
  }
  return out.sort((a, b) => a.dayMs - b.dayMs);
}

/** How many buckets before the first complete one carry only backfilled runs. */
export function backfilledOnlyBuckets(growth: GrowthWire): number {
  const first = firstCompleteBucketMs(growth);
  return growth.series.filter((b) => {
    const ms = Date.parse(b.bucket_start);
    return Number.isFinite(ms) && (first === null || ms < first);
  }).length;
}

export interface SparkPoint {
  dayMs: number;
  value: number;
}

/** One work type's slot-hours per complete day (0 on a recorded day it did not run). */
export function workTypeSpark(
  days: GrowthDay[],
  workType: string
): SparkPoint[] {
  return days.map((d) => ({ dayMs: d.dayMs, value: d.byType[workType] ?? 0 }));
}

export type FleetAvailable =
  | {
      kind: "known";
      perDay: number;
      devicesWithBudget: number;
      devicesZero: number | null;
      devicesNone: number | null;
    }
  | {
      kind: "none_published";
      devicesZero: number | null;
      devicesNone: number | null;
    }
  | {
      /**
       * No non-zero budget, and at least one machine published 0 (coord's
       * `zero_budget_published`). Other machines may have published nothing,
       * so the wording is driven by the zero/none counts.
       */
      kind: "zero_published";
      devicesZero: number | null;
      devicesNone: number | null;
    }
  | { kind: "unknown" };

/**
 * coord's `fleet.available_state` values, by its own rule (qontinui-coord
 * `session_runs::routes::growth`): any device with a non-zero budget →
 * `published`; else any device with a budget of 0 → `zero_budget_published`;
 * else (no device published a budget at all) → `no_budget_published`.
 */
export const AVAILABLE_STATE_PUBLISHED = "published";
/** No device published any configured session budget — neither 0 nor more. */
export const AVAILABLE_STATE_NO_BUDGET = "no_budget_published";
/** No non-zero budget, and at least one device published 0 (the rest, if any, none). */
export const AVAILABLE_STATE_ZERO_BUDGET = "zero_budget_published";

/**
 * What the fleet's budgets make available, read from coord's
 * `fleet.available_state` first:
 *
 * - `no_budget_published` → "none published": no machine published any
 *   budget (the figure is `null` by design, so this is decided BEFORE any
 *   null check — it must never read "coord sent no figures");
 * - `zero_budget_published` → "zero published": no non-zero budget, at least
 *   one machine at 0 (also `null`, also decided before the null check);
 * - `published` → the figure, or unknown if coord nonetheless sent none;
 * - any other value → unknown (a state this build cannot read);
 * - absent (a coord predating the field) → coord's own rule applied to the
 *   counts: `devices_with_budget === 0` is "zero published" when any machine
 *   is at 0, else "none published"; otherwise the figure, else unknown.
 */
export function fleetAvailable(growth: GrowthWire): FleetAvailable {
  const f = growth.fleet;
  if (!f) return { kind: "unknown" };
  const perDay = finite(f.available_slot_hours_per_day);
  const withBudget = finite(f.devices_with_budget);
  const zero = finite(f.devices_zero_budget);
  const none = finite(f.devices_without_budget);
  const state =
    typeof f.available_state === "string" ? f.available_state : null;
  if (state === AVAILABLE_STATE_NO_BUDGET) {
    return { kind: "none_published", devicesZero: zero, devicesNone: none };
  }
  if (state === null && withBudget === 0) {
    return zero !== null && zero > 0
      ? { kind: "zero_published", devicesZero: zero, devicesNone: none }
      : { kind: "none_published", devicesZero: zero, devicesNone: none };
  }
  if (state === AVAILABLE_STATE_ZERO_BUDGET) {
    return { kind: "zero_published", devicesZero: zero, devicesNone: none };
  }
  if (state !== null && state !== AVAILABLE_STATE_PUBLISHED) {
    return { kind: "unknown" };
  }
  if (perDay === null || withBudget === null) return { kind: "unknown" };
  if (perDay <= 0) {
    return { kind: "none_published", devicesZero: zero, devicesNone: none };
  }
  return {
    kind: "known",
    perDay,
    devicesWithBudget: withBudget,
    devicesZero: zero,
    devicesNone: none,
  };
}

/**
 * The no-available-figure sentence, worded from the zero/none COUNTS so it is
 * always true of them:
 *
 * - every machine at 0 (none unpublished) → "none — every machine published
 *   a zero …": the fleet deliberately has no slots;
 * - some at 0, others unpublished (or that count unknown) → "unknown — no
 *   machine published a non-zero …; N published zero, M published none":
 *   what the unpublished ones could carry is not known;
 * - no budget at all (coord's `no_budget_published`) → "unknown — no machine
 *   published a configured session budget".
 */
export function noBudgetSentence(
  a: Extract<FleetAvailable, { kind: "zero_published" | "none_published" }>
): string {
  const zero = a.devicesZero;
  const none = a.devicesNone;
  if (a.kind === "none_published") {
    return `unknown — no machine published a configured session budget (${none === null ? "an unknown number of machines" : plural(none, "machine")} published none${zero !== null && zero > 0 ? `, ${zero} published zero` : ""})`;
  }
  if (none === 0) {
    return `none — every machine published a zero configured session budget (${zero === null ? "an unknown number of" : zero} published zero)`;
  }
  return `unknown — no machine published a non-zero configured session budget; ${zero === null ? "an unknown number" : zero} published zero, ${none === null ? "an unknown number" : none} published none`;
}

export function fleetAvailableText(a: FleetAvailable): string {
  switch (a.kind) {
    case "unknown":
      return "Fleet slot-hours available: unknown — coord sent no fleet budget figures.";
    case "zero_published":
    case "none_published":
      return `Fleet slot-hours available: ${noBudgetSentence(a)}.`;
    case "known":
      return `Fleet slot-hours available: ${formatSlotHoursPerDay(a.perDay)} — the configured session budgets of ${plural(a.devicesWithBudget, "machine")} × 24 h${
        // An unknown count is shown as "unknown", never folded into zero.
        a.devicesZero === null ||
        a.devicesNone === null ||
        a.devicesZero + a.devicesNone > 0
          ? `; not counted: ${countText(a.devicesZero)} with a zero budget, ${countText(a.devicesNone)} with none published`
          : ""
      }.`;
  }
}

/** Days of complete history the trend is fitted over. */
export const TREND_DAYS = 7;
/** The share of available slot-hours whose crossing the trend projects. */
export const TREND_THRESHOLD = 0.8;
/** A projection further out than this is reported as "beyond", not as a date. */
export const TREND_HORIZON_DAYS = 3650;

export type TrendReading =
  | {
      kind: "projection";
      fromMs: number;
      toMs: number;
      slopePerDay: number;
      fittedLast: number;
      targetPerDay: number;
      crossingMs: number;
    }
  | {
      kind: "beyond_horizon";
      fromMs: number;
      toMs: number;
      slopePerDay: number;
      targetPerDay: number;
    }
  | {
      kind: "already_above";
      fromMs: number;
      toMs: number;
      fittedLast: number;
      targetPerDay: number;
    }
  | { kind: "not_rising"; fromMs: number; toMs: number; slopePerDay: number }
  | { kind: "history_too_short"; reason: string }
  | { kind: "no_available"; reason: string };

/** Least-squares slope and intercept of `y` over `x`. */
export function linearFit(points: { x: number; y: number }[]): {
  slope: number;
  intercept: number;
} {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

/**
 * The date the fleet's demanded slot-hours/day crosses
 * {@link TREND_THRESHOLD} of what its budgets make available, by a linear
 * fit over the last {@link TREND_DAYS} complete days — or why there is none.
 *
 * Withheld (`history_too_short`) when the series is not daily, when fewer
 * than {@link TREND_DAYS} complete days are recorded, or when any machine
 * began recording inside the fitted window: its arrival would read as growth.
 */
export function growthTrend(
  growth: GrowthWire,
  available: FleetAvailable
): TrendReading {
  if (available.kind !== "known") {
    return {
      kind: "no_available",
      reason:
        available.kind === "none_published" ||
        available.kind === "zero_published"
          ? `available slot-hours are ${noBudgetSentence(available)}, so there is no available figure to cross`
          : "coord sent no fleet budget figures",
    };
  }
  if (growth.bucket_seconds !== 86_400) {
    return {
      kind: "history_too_short",
      reason: "the growth series is not daily",
    };
  }
  if (growth.recording_since === null) {
    return {
      kind: "history_too_short",
      reason: "no runner has recorded a session run yet",
    };
  }
  const days = completeGrowthDays(growth);
  if (days.length < TREND_DAYS) {
    return {
      kind: "history_too_short",
      reason: `recording began ${utcDate(Date.parse(growth.recording_since))}: ${plural(days.length, "complete day")} recorded, ${TREND_DAYS} needed`,
    };
  }
  const window = days.slice(-TREND_DAYS);
  const fromMs = window[0]!.dayMs;
  const toMs = window[window.length - 1]!.dayMs;
  const late = (growth.devices_recording ?? [])
    .map((d) => ({ id: d.device_id, ms: Date.parse(d.recording_since) }))
    .filter((d) => Number.isFinite(d.ms) && d.ms > fromMs);
  if (late.length > 0) {
    const latest = late.reduce((a, b) => (b.ms > a.ms ? b : a));
    return {
      kind: "history_too_short",
      reason: `${plural(late.length, "machine")} began recording inside the ${TREND_DAYS}-day window (the latest on ${utcDate(latest.ms)}), so the trend would read ${late.length === 1 ? "its" : "their"} arrival as growth`,
    };
  }
  const fit = linearFit(
    window.map((d) => ({ x: (d.dayMs - fromMs) / DAY_MS, y: d.totalSlotHours }))
  );
  const lastX = (toMs - fromMs) / DAY_MS;
  const fittedLast = fit.intercept + fit.slope * lastX;
  const targetPerDay = available.perDay * TREND_THRESHOLD;
  if (fittedLast >= targetPerDay) {
    return { kind: "already_above", fromMs, toMs, fittedLast, targetPerDay };
  }
  if (fit.slope <= 0) {
    return { kind: "not_rising", fromMs, toMs, slopePerDay: fit.slope };
  }
  const daysAhead = (targetPerDay - fittedLast) / fit.slope;
  if (daysAhead > TREND_HORIZON_DAYS) {
    return {
      kind: "beyond_horizon",
      fromMs,
      toMs,
      slopePerDay: fit.slope,
      targetPerDay,
    };
  }
  return {
    kind: "projection",
    fromMs,
    toMs,
    slopePerDay: fit.slope,
    fittedLast,
    targetPerDay,
    crossingMs: toMs + daysAhead * DAY_MS,
  };
}

function trendWindowText(fromMs: number, toMs: number): string {
  return `linear extrapolation of the ${TREND_DAYS} complete days ${utcDate(fromMs)} – ${utcDate(toMs)} (UTC)`;
}

/** The trend in one sentence, its method and window named. */
export function trendText(t: TrendReading): string {
  const pct = `${Math.round(TREND_THRESHOLD * 100)} %`;
  switch (t.kind) {
    case "no_available":
      return `No crossing date: ${t.reason}.`;
    case "history_too_short":
      return `No crossing date — history too short to extrapolate: ${t.reason}.`;
    case "not_rising":
      return `Demand is not rising (${formatSignedSlope(t.slopePerDay)}), so no crossing of ${pct} of available is projected — ${trendWindowText(t.fromMs, t.toMs)}.`;
    case "already_above":
      return `Demand is already at or above ${pct} of available (${formatSlotHoursPerDay(t.fittedLast)} against ${formatSlotHoursPerDay(t.targetPerDay)}) — ${trendWindowText(t.fromMs, t.toMs)}.`;
    case "beyond_horizon":
      return `At ${formatSignedSlope(t.slopePerDay)}, demand would reach ${pct} of available (${formatSlotHoursPerDay(t.targetPerDay)}) more than ${TREND_HORIZON_DAYS / 365} years out — ${trendWindowText(t.fromMs, t.toMs)}.`;
    case "projection":
      return `Demand reaches ${pct} of available (${formatSlotHoursPerDay(t.targetPerDay)}) around ${utcDate(t.crossingMs)} at ${formatSignedSlope(t.slopePerDay)} — ${trendWindowText(t.fromMs, t.toMs)}, not a forecast.`;
  }
}

function formatSignedSlope(perDay: number): string {
  const abs = Math.abs(perDay);
  const text =
    abs < 10 ? Number(abs.toFixed(2)).toString() : Math.round(abs).toString();
  return `${perDay < 0 ? "−" : "+"}${text} slot-h/day per day`;
}

// ---------------------------------------------------------------------------
// By machine
// ---------------------------------------------------------------------------

/**
 * A device whose last heartbeat is older than this is SILENT: coord may not
 * have heard its sessions end, so its open-run count is unknown.
 */
export const SILENT_HEARTBEAT_SECS = 15 * 60;

export type BudgetReading =
  | { state: "published"; value: number }
  | { state: "zero" }
  | { state: "none" }
  | { state: "unknown" };

/** coord's budget object, read from its `state` alone (never a device role). */
export function readBudget(b: BudgetWire | undefined): BudgetReading {
  if (!b) return { state: "unknown" };
  if (b.state === "published") {
    const v = finite(b.value);
    return v !== null && v > 0
      ? { state: "published", value: v }
      : { state: "unknown" };
  }
  if (b.state === "zero") return { state: "zero" };
  if (b.state === "none") return { state: "none" };
  return { state: "unknown" };
}

export function budgetText(b: BudgetReading): string {
  switch (b.state) {
    case "published":
      return `configured session budget ${b.value}`;
    case "zero":
      return "zero budget published";
    case "none":
      return "no budget published";
    case "unknown":
      return "configured session budget unknown";
  }
}

export type MachineKind =
  | "within_budget"
  | "over_budget"
  | "zero_budget"
  | "no_budget"
  | "silent"
  | "unregistered"
  | "unknown";

/**
 * Who must act on a machine line (R3). Nothing here is red: this page
 * MEASURES load — admission and placement act on it — so no line is the
 * operator's move now.
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `within_budget` | `none` | open runs at or under a published budget. |
 * | `over_budget` | `waiting` | more open runs than its published budget; it clears as runs end. |
 * | `zero_budget` | `none` | the machine deliberately published 0 (a build runner, or a box too small to host agents). |
 * | `no_budget` | `waiting` | no budget published — what the machine may carry is unknown (the ignorance floor). |
 * | `silent` | `waiting` | its heartbeat is stale, so its open-run count is unknown. |
 * | `unregistered` | `waiting` | runs name a device coord's registry does not hold — budget and heartbeat unknown. |
 * | `unknown` | `waiting` | a budget state this build cannot read. |
 */
export const MACHINE_ATTENTION_BY_KIND: Record<MachineKind, Attention> = {
  within_budget: "none",
  over_budget: "waiting",
  zero_budget: "none",
  no_budget: "waiting",
  silent: "waiting",
  unregistered: "waiting",
  unknown: "waiting",
};

export const MACHINE_KIND_CLASS: Record<MachineKind, string> = {
  within_budget: INERT,
  over_budget: WAITING_AMBER,
  zero_budget: INERT,
  no_budget: UNKNOWN_AMBER,
  silent: UNKNOWN_AMBER,
  unregistered: UNKNOWN_AMBER,
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ `✕`: exactly the `author` kinds, derived (there are none). */
export const MACHINE_AUTHOR_GLYPH_KINDS: ReadonlySet<MachineKind> = new Set(
  (Object.keys(MACHINE_ATTENTION_BY_KIND) as MachineKind[]).filter(
    (k) => MACHINE_ATTENTION_BY_KIND[k] === "author"
  )
);

export const MACHINE_STATUS_PALETTE: StatusPalette<MachineKind> = {
  badgeClass: MACHINE_KIND_CLASS,
  authorGlyphKinds: MACHINE_AUTHOR_GLYPH_KINDS,
};

export interface MachineSlice {
  workType: string;
  label: string;
  slotHours: number;
}

export interface MachineLine {
  deviceId: string;
  name: string;
  status: RowStatus<MachineKind>;
  budget: BudgetReading;
  /** Open runs now; `null` when the machine is silent or unregistered. */
  openNow: number | null;
  /** The open runs coord holds for it, whatever its heartbeat says. */
  openRecorded: number | null;
  peak: number | null;
  p95: number | null;
  p95Scope: string | null;
  heartbeatAgeSecs: number | null;
  /** Total peak open runs per series bucket, oldest first. */
  peaks: SparkPoint[];
  peaksUpperBound: boolean;
  /** Slot-hours by work type over the window, most first; `null` when unread. */
  slices: MachineSlice[] | null;
}

function machineStatus(
  known: boolean,
  silent: boolean,
  heartbeatAgeSecs: number | null,
  budget: BudgetReading,
  openRecorded: number | null
): RowStatus<MachineKind> {
  const s = (
    kind: MachineKind,
    label: string,
    reason: string
  ): RowStatus<MachineKind> => ({
    kind,
    label,
    reason,
    attention: MACHINE_ATTENTION_BY_KIND[kind],
  });
  if (!known) {
    return s(
      "unregistered",
      "Not registered",
      "coord's device registry does not hold this device, so its budget and heartbeat are unknown"
    );
  }
  if (silent) {
    return s(
      "silent",
      "Silent",
      heartbeatAgeSecs === null
        ? "coord has no heartbeat from it, so how many runs are open now is unknown"
        : `no heartbeat for ${formatDuration(heartbeatAgeSecs)}, so how many runs are open now is unknown`
    );
  }
  switch (budget.state) {
    case "zero":
      return s(
        "zero_budget",
        "Zero budget",
        "it published a configured session budget of 0"
      );
    case "none":
      return s(
        "no_budget",
        "No budget",
        "it published no configured session budget"
      );
    case "unknown":
      return s(
        "unknown",
        "Budget unreadable",
        "coord sent a budget this page cannot read"
      );
    case "published":
      if (openRecorded !== null && openRecorded > budget.value) {
        return s(
          "over_budget",
          "Over budget",
          `${openRecorded} open runs against a configured session budget of ${budget.value}`
        );
      }
      return s(
        "within_budget",
        "Within budget",
        `${openRecorded ?? "unknown"} open of a configured session budget of ${budget.value}`
      );
  }
}

/**
 * One line per machine that ran a session in the window. `perDeviceTypes` is
 * the stats read grouped by `device,work_type` (or `null` when it did not
 * answer), giving each machine its slot-hours by work type.
 */
export function machineLines(
  concurrency: ConcurrencyWire,
  perDeviceTypes: StatsWire | null
): MachineLine[] {
  const slicesByDevice = new Map<string, MachineSlice[]>();
  if (perDeviceTypes) {
    for (const g of perDeviceTypes.groups) {
      if (typeof g.device_id !== "string") continue;
      const h = finite(g.slot_hours);
      if (h === null || h <= 0) continue;
      const wt = typeof g.work_type === "string" ? g.work_type : "unknown";
      const list = slicesByDevice.get(g.device_id) ?? [];
      list.push({ workType: wt, label: workTypeLabel(wt), slotHours: h });
      slicesByDevice.set(g.device_id, list);
    }
  }
  return concurrency.devices
    .map((d): MachineLine => {
      const known = d.known_device !== false;
      const age = finite(d.heartbeat_age_seconds);
      const silent = !known || age === null || age > SILENT_HEARTBEAT_SECS;
      const budget = known
        ? readBudget(d.budget)
        : { state: "unknown" as const };
      const openRecorded = finite(d.open_now);
      const series = Array.isArray(d.series) ? d.series : [];
      const peaks = series
        .map((b) => ({
          dayMs: Date.parse(b.bucket_start),
          value: finite(b.total?.peak),
        }))
        .filter(
          (p): p is SparkPoint => Number.isFinite(p.dayMs) && p.value !== null
        )
        .sort((a, b) => a.dayMs - b.dayMs);
      return {
        deviceId: d.device_id,
        name:
          typeof d.name === "string" && d.name
            ? d.name
            : `unnamed device ${d.device_id.slice(0, 8)}`,
        status: machineStatus(known, silent, age, budget, openRecorded),
        budget,
        openNow: silent ? null : openRecorded,
        openRecorded,
        peak: finite(d.peak),
        p95: finite(d.p95),
        p95Scope: typeof d.p95_scope === "string" ? d.p95_scope : null,
        heartbeatAgeSecs: age,
        peaks,
        peaksUpperBound: series.some(
          (b) => b.total?.total_peak_is_upper_bound === true
        ),
        slices: perDeviceTypes
          ? (slicesByDevice.get(d.device_id) ?? []).sort(
              (a, b) => b.slotHours - a.slotHours
            )
          : null,
      };
    })
    .sort(
      (a, b) =>
        (b.openRecorded ?? -1) - (a.openRecorded ?? -1) ||
        a.name.localeCompare(b.name)
    );
}

/** `5 open of budget 14` / `5 open · no budget published` / `UNKNOWN (7 recorded open)`. */
export function openVsBudgetText(m: MachineLine): string {
  if (m.openNow === null) {
    return `open now unknown${m.openRecorded === null ? "" : ` (${m.openRecorded} recorded open)`}`;
  }
  if (m.budget.state === "published") {
    return `${m.openNow} open of a configured session budget of ${m.budget.value}`;
  }
  return `${m.openNow} open · ${budgetText(m.budget)}`;
}

/** `peak 9 · p95 6 open runs over the last 7 days`. */
export function concurrencyText(m: MachineLine, windowLabel: string): string {
  const p95 = m.p95 === null ? "unknown" : String(m.p95);
  const scope =
    m.p95Scope && m.p95Scope !== "whole window"
      ? ` (p95 over ${m.p95Scope})`
      : "";
  return `peak ${m.peak ?? "unknown"} · p95 ${p95} open runs over ${windowLabel}${scope}`;
}

// ---------------------------------------------------------------------------
// The run list
// ---------------------------------------------------------------------------

export type RunKind = "open" | "ended" | "inferred" | "unknown";

/**
 * Who must act on a run line (R3) — no one: a run is history or work in
 * flight. An inferred end is the ignorance floor: coord closed it because its
 * device stopped reporting it, so when it truly ended is unknown.
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `open` | `none` | still holding a slot — work in flight, yellow. |
 * | `ended` | `none` | ended, and its runner observed the end. |
 * | `inferred` | `waiting` | coord's backstop closed it; the true end is unknown. |
 * | `unknown` | `waiting` | an end source this build cannot read. |
 */
export const RUN_ATTENTION_BY_KIND: Record<RunKind, Attention> = {
  open: "none",
  ended: "none",
  inferred: "waiting",
  unknown: "waiting",
};

export const RUN_KIND_CLASS: Record<RunKind, string> = {
  open: CI_YELLOW,
  ended: INERT,
  inferred: UNKNOWN_AMBER,
  unknown: UNKNOWN_AMBER,
};

export const RUN_AUTHOR_GLYPH_KINDS: ReadonlySet<RunKind> = new Set(
  (Object.keys(RUN_ATTENTION_BY_KIND) as RunKind[]).filter(
    (k) => RUN_ATTENTION_BY_KIND[k] === "author"
  )
);

export const RUN_STATUS_PALETTE: StatusPalette<RunKind> = {
  badgeClass: RUN_KIND_CLASS,
  authorGlyphKinds: RUN_AUTHOR_GLYPH_KINDS,
};

export function deriveRunStatus(run: SessionRunWire): RowStatus<RunKind> {
  const s = (
    kind: RunKind,
    label: string,
    reason: string
  ): RowStatus<RunKind> => ({
    kind,
    label,
    reason,
    attention: RUN_ATTENTION_BY_KIND[kind],
  });
  if (!run.ended_at) return s("open", "Open", "still holding a session slot");
  if (run.end_source === "observed") {
    return s("ended", "Ended", endReasonLabel(run.end_reason));
  }
  if (run.end_source === "inferred") {
    return s(
      "inferred",
      "End inferred",
      "coord closed it after its device stopped reporting it — the true end is unknown"
    );
  }
  return s(
    "unknown",
    "End unreadable",
    `end source ${run.end_source ?? "not recorded"}`
  );
}

/**
 * `resumed (run 2)` for a run after a session's first, else `null`. coord
 * numbers a session's runs from 1 (the ingest refuses `run_seq < 1`): a boot
 * resume or a handoff adoption continues the same session as `run_seq + 1`.
 */
export function runResumeText(
  run: Pick<SessionRunWire, "run_seq">
): string | null {
  return typeof run.run_seq === "number" && run.run_seq > 1
    ? `resumed (run ${run.run_seq})`
    : null;
}

/** The run's wall time so far or in full, with its unit. */
export function runWallText(run: SessionRunWire, nowMs: number): string {
  const wall = finite(run.wall_seconds);
  if (wall !== null) return `${formatDuration(wall)} wall time`;
  if (!run.ended_at) {
    const started = Date.parse(run.started_at);
    return Number.isFinite(started)
      ? `${formatDuration(Math.max(0, (nowMs - started) / 1000))} so far`
      : "wall time unknown";
  }
  return "wall time unknown";
}

export interface RunLink {
  key: string;
  label: string;
  href: string;
  id: string;
}

/** The records a run points at that the console can open. */
export function runLinks(run: SessionRunWire): RunLink[] {
  const links: RunLink[] = [];
  if (run.gate_id) {
    links.push({
      key: "gate",
      label: "Open the gate",
      href: `/admin/coord/gates?gate=${encodeURIComponent(run.gate_id)}`,
      id: run.gate_id,
    });
  }
  if (run.spawn_request_id) {
    links.push({
      key: "spawn",
      label: "Spawn request (Spawns page)",
      href: "/admin/coord/spawns",
      id: run.spawn_request_id,
    });
  }
  if (run.coord_session_id) {
    links.push({
      key: "session",
      label: "Open the session",
      href: `/sessions/${encodeURIComponent(run.coord_session_id)}`,
      id: run.coord_session_id,
    });
  }
  if (run.work_unit_slug) {
    links.push({
      key: "work_unit",
      label: "Open the work unit",
      href: `/admin/coord/work-units/${encodeURIComponent(run.work_unit_slug)}`,
      id: run.work_unit_slug,
    });
  }
  return links;
}

export type RunFilter = "all" | "open" | "ended" | "inferred";

export const RUN_FILTERS: ReadonlyArray<{
  id: RunFilter;
  label: string;
  title: string;
}> = [
  { id: "all", label: "All", title: "Every run loaded" },
  { id: "open", label: "Open", title: "Runs still holding a session slot" },
  { id: "ended", label: "Ended", title: "Runs whose runner observed the end" },
  {
    id: "inferred",
    label: "End inferred",
    title:
      "Runs coord closed because their device stopped reporting them, or whose end it cannot read",
  },
];

export function matchesRunFilter(
  run: SessionRunWire,
  filter: RunFilter
): boolean {
  if (filter === "all") return true;
  const kind = deriveRunStatus(run).kind;
  if (filter === "inferred") return kind === "inferred" || kind === "unknown";
  return kind === filter;
}

/** Tab counts over the LOADED rows; `null` (rendered `–`) when nothing is loaded. */
export function runFilterCounts(
  runs: SessionRunWire[] | null
): Record<RunFilter, number | null> {
  if (runs === null)
    return { all: null, open: null, ended: null, inferred: null };
  return {
    all: runs.length,
    open: runs.filter((r) => matchesRunFilter(r, "open")).length,
    ended: runs.filter((r) => matchesRunFilter(r, "ended")).length,
    inferred: runs.filter((r) => matchesRunFilter(r, "inferred")).length,
  };
}

// ---------------------------------------------------------------------------
// The health strip
// ---------------------------------------------------------------------------

export interface SessionLoadHealthInput {
  stats: StatsWire | null;
  statsIssue: SessionLoadIssue | null;
  machines: MachineLine[] | null;
  concurrencyIssue: SessionLoadIssue | null;
  /** Whether a growth body is held (fresh or kept from the last good read). */
  growthLoaded: boolean;
  growthIssue: SessionLoadIssue | null;
  trend: TrendReading | null;
  windowLabel: string;
}

export interface SessionLoadHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string | null;
  badges: HealthBadge[];
}

/** The share of `part` in `whole` at or above which an UNKNOWN share turns the strip amber. */
export const UNKNOWN_SHARE_AMBER = 0.05;

/**
 * The strip. Amber when any figure the page depends on is UNKNOWN — a read
 * that did not answer, a silent or budget-less machine, more than
 * {@link UNKNOWN_SHARE_AMBER} of runs unclassified or ended by inference — or
 * when a machine is over its budget or the fleet already demands more than
 * {@link TREND_THRESHOLD} of what it has. **A failed refresh of ANY of the
 * three aggregate reads disqualifies green**, even when the last good body is
 * still shown: stale figures are not a green verdict (style guide R6, the
 * STALE arm), and a read that has never answered is UNKNOWN
 * (`readIsUnknown`). Never red: this page measures.
 */
export function deriveSessionLoadHealth(
  input: SessionLoadHealthInput
): SessionLoadHealth {
  const {
    stats,
    statsIssue,
    machines,
    concurrencyIssue,
    growthLoaded,
    growthIssue,
    trend,
    windowLabel,
  } = input;
  if (stats === null) {
    const issue = statsIssue;
    return {
      level: "amber",
      headline:
        issue === null
          ? "Reading session load from coord…"
          : issue.kind === "not_deployed"
            ? "Session run record not deployed yet — session load is unknown"
            : "Session load unknown — coord's run record did not answer",
      detail:
        issue === null ? null : sessionLoadIssueText(issue, "session load"),
      badges: [],
    };
  }
  const totals = statsTotals(stats);
  const clauses: string[] = [];
  const badges: HealthBadge[] = [
    {
      key: "runs",
      label: `runs ${totals.runs ?? "–"}`,
      title: `Runs started in ${windowLabel}`,
    },
    {
      key: "slot",
      label: `slot-h ${totals.slotHours === null ? "–" : formatSlotHours(totals.slotHours).replace(" slot-h", "")}`,
      title: `Slot-hours held by those runs (open and inferred runs included)`,
    },
    {
      key: "open",
      label: `open ${totals.openNow ?? "–"}`,
      title: "Of those runs, still open now",
    },
  ];
  const runs = totals.runs;
  if (runs !== null && runs > 0) {
    if (
      totals.unknownRuns !== null &&
      totals.unknownRuns / runs >= UNKNOWN_SHARE_AMBER
    ) {
      clauses.push(
        `${formatPercent(totals.unknownRuns / runs)} of runs unclassified`
      );
    }
    if (
      totals.inferred !== null &&
      totals.inferred / runs >= UNKNOWN_SHARE_AMBER
    ) {
      clauses.push(
        `${formatPercent(totals.inferred / runs)} of runs ended by inference`
      );
    }
  }
  if (totals.unknownRuns !== null && totals.unknownRuns > 0) {
    badges.push({
      key: "unclassified",
      label: `unclassified ${totals.unknownRuns}`,
      tone: "waiting",
      title:
        "Runs no work type matched — counted, never folded into another type",
    });
  }
  if (totals.inferred !== null && totals.inferred > 0) {
    badges.push({
      key: "inferred",
      label: `inferred ends ${totals.inferred}`,
      tone: "waiting",
      title: "Runs coord closed because their device stopped reporting them",
    });
  }
  if (readIsUnknown(machines !== null, concurrencyIssue !== null)) {
    clauses.push("per-machine load unknown — coord did not answer");
  } else if (machines === null) {
    clauses.push("per-machine load not read yet");
  } else {
    const silent = machines.filter(
      (m) => m.status.kind === "silent" || m.status.kind === "unregistered"
    );
    const noBudget = machines.filter((m) => m.status.kind === "no_budget");
    const unreadable = machines.filter((m) => m.status.kind === "unknown");
    const over = machines.filter((m) => m.status.kind === "over_budget");
    if (over.length > 0)
      clauses.push(
        `${plural(over.length, "machine")} over its configured session budget`
      );
    if (silent.length > 0)
      clauses.push(
        `${plural(silent.length, "machine")} silent — open runs unknown`
      );
    if (noBudget.length > 0)
      clauses.push(
        `${plural(noBudget.length, "machine")} with no budget published`
      );
    if (unreadable.length > 0)
      clauses.push(
        `${plural(unreadable.length, "machine")} whose budget this page cannot read`
      );
  }
  if (readIsUnknown(growthLoaded, growthIssue !== null)) {
    clauses.push("growth unknown — coord did not answer");
  }
  // A kept body behind a failed refresh is STALE: still shown, never green.
  const stale: string[] = [];
  if (statsIssue) stale.push("work-type figures");
  if (concurrencyIssue && machines !== null) stale.push("per-machine figures");
  if (growthIssue && growthLoaded) stale.push("growth figures");
  if (trend?.kind === "already_above") {
    clauses.push(
      `demand already at ${Math.round(TREND_THRESHOLD * 100)} % of available slot-hours`
    );
  }
  const level: HealthStripLevel =
    clauses.length > 0 || stale.length > 0 ? "amber" : "green";
  const headline = `${runs === null ? "An unknown number of" : runs} run${runs === 1 ? "" : "s"} in ${windowLabel}, holding ${formatSlotHours(totals.slotHours)}${
    totals.openNow === null ? "" : ` · ${totals.openNow} open now`
  }`;
  const detailParts: string[] = [];
  if (clauses.length > 0) detailParts.push(`${clauses.join("; ")}.`);
  if (stale.length > 0) {
    detailParts.push(
      `Last refresh failed — the ${stale.join(", ")} are from the last good read.`
    );
  }
  if (statsIssue) {
    detailParts.push(
      sessionLoadIssueText(statsIssue, "the latest work-type figures")
    );
  }
  if (concurrencyIssue) {
    detailParts.push(
      sessionLoadIssueText(concurrencyIssue, "the latest per-machine figures")
    );
  }
  if (growthIssue) {
    detailParts.push(
      sessionLoadIssueText(growthIssue, "the latest growth figures")
    );
  }
  // One sentence once: a refusal (forbidden, tenant_not_resolved) reads the
  // same for every read it blocked.
  const uniqueParts = [...new Set(detailParts)];
  return {
    level,
    headline,
    detail: uniqueParts.length > 0 ? uniqueParts.join(" ") : null,
    badges,
  };
}
