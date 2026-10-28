/**
 * spawnStatus — everything `/admin/coord/spawns` derives from coord's spawn
 * ledger: the wire shapes, the read-failure readings, each request's status
 * and its R3 attention table, the filter tabs, the health strip, the
 * per-device breakdown and the requested/started-per-hour series.
 *
 * Plan `2026-10-21-spawns-outrank-ci-and-builds-in-fleet-capacity-arbitration`
 * Phase 5 (its D7 defines every number). A pure module with no JSX, so each
 * reading is unit-tested over its whole union (console style guide R8).
 *
 * ## The outcome vocabulary is the gates page's, not a second classifier
 *
 * A spawn request and a gate's continuation END the same way — a process
 * started or it did not, and then the work was or was not reported done — so
 * every terminal and started reading REUSES `gates/continuationStatus.ts`'s
 * kind words, their attention and their colours:
 *
 * - **`spawned` is not success.** A started session whose work outcome nobody
 *   reported is amber, exactly as on the gates page.
 * - **`work_completed` is the ONLY success reading** (the session's
 *   `session_outcome` is `finished`). An `unknown` outcome is
 *   `work_unreported` — the ignorance floor, never finished.
 * - `closed_unfinished` is `work_abandoned`; a failed start is `spawn_failed`;
 *   an expired request is `expired`; a withdrawn one is `cancelled`.
 *
 * ## Waiting is judged by TIME, not by the gates page's deferral count
 *
 * The gates page's `deferral_stuck` threshold (24 deferrals) is a day of the
 * runner's HOURLY deferral stamps. The ledger's `deferrals` counts every
 * deferred EVENT, and under this plan those arrive up to once per 5 minutes per
 * gate — 24 of them is two hours, not a day. So a request that has not started
 * is judged on how long it has waited since `requested_at`, against the plan's
 * own target (claim `ops-decide-spawns-start-within-10m`):
 *
 * - under {@link SPAWN_TARGET_MS} (10 min) it reads by its state — `queued` and
 *   `dispatched` calm (ordinary queueing), `deferred` amber (a runner pushed it
 *   back; it is re-deliverable);
 * - past the target it is `waiting_late` — amber: it will still start by
 *   itself, but it is late;
 * - past {@link SPAWN_STUCK_MS} (a day) it is `waiting_stuck` — red: nothing
 *   that was going to start it has, and a human decides.
 *
 * One reading keeps its own, sharper premise: a request coord DISPATCHED that
 * no runner has picked up for {@link DISPATCH_STALE_MS} is `dispatch_stalled`
 * (the gates page's word and threshold), however young the request is.
 *
 * The ledger-only words are those four — `queued`, `waiting_late`,
 * `waiting_stuck`, and `superseded` (replaced by a newer request for the same
 * source, terminal and deliberate, painted like `cancelled`).
 *
 * ## What this module will not say
 *
 * - **A number coord sent as `null`** — a share over no ended request, a
 *   percentile over no started one, a device with no wait sample — renders as
 *   the word `unknown`, never `0`.
 * - **"No spawns"** when coord did not answer, or answered that the ledger is
 *   not deployed (`{available: false}`): both are their own readings.
 * - **"Efficiency".** D7 names the measure: requested per hour (the optimal
 *   rate — every request started on its first attempt) against started per
 *   hour, the first-attempt share and the queued backlog.
 */

import type {
  HealthBadge,
  HealthStripLevel,
  ShareListItem,
} from "@/components/console";
import type { Attention } from "@/components/console/attention";
import { shareOfFraction } from "@/components/console/share";
import {
  AUTHOR_RED,
  INERT,
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
import type { SpawnStatsWindow } from "@/lib/api/operations/coordSpawns";
import {
  CONTINUATION_ATTENTION_BY_KIND,
  CONTINUATION_KIND_CLASS,
  DISPATCH_STALE_MS,
  type ContinuationKind,
} from "../../gates/continuationStatus";

// ---------------------------------------------------------------------------
// Wire shapes — the shared contract for coord's `/coord/spawns…` reads
// ---------------------------------------------------------------------------

/**
 * One `coord.spawn_requests` row as coord serves it. Enumerated columns are
 * typed `string`, not unions, on purpose: a coord newer than this build must
 * render its new value as `unknown`, not fail to parse.
 */
export interface SpawnRowWire {
  id: string;
  class: string;
  origin: string;
  source_ref: string | null;
  /** The first moment coord tried to place it — D7's "first attempt". */
  requested_at: string;
  first_dispatched_at: string | null;
  spawned_at: string | null;
  updated_at: string;
  state: string;
  attempts: number;
  deferrals: number;
  pinned_device_id: string | null;
  preferred_device_id: string | null;
  current_device_id: string | null;
  spawned_device_id: string | null;
  placement_basis: string | null;
  lease_id: string | null;
  claude_code_session_id: string | null;
  claude_account: string | null;
  session_outcome: string | null;
  session_outcome_at: string | null;
  terminal_reason: string | null;
  /** `false` on a row backfilled from records that predate the ledger. */
  history_complete: boolean;
  /** `spawned_at − requested_at`; `null` until it started. */
  wait_seconds: number | null;
}

export interface SpawnListWire {
  available: true;
  items: SpawnRowWire[];
  shown: number;
  total: number | null;
  truncated: boolean;
  next_cursor: string | null;
  as_of: string;
}

export interface SpawnStatsOverallWire {
  requested: number;
  terminal: number;
  spawned: number;
  failed: number;
  expired: number;
  cancelled: number;
  superseded: number;
  pending: { queued: number; dispatched: number; deferred: number };
  /** spawned / terminal × 10000; `null` when nothing ended. */
  started_share_bps: number | null;
  wait_p50_secs: number | null;
  wait_p90_secs: number | null;
  /** Started on the first attempt with no deferral, over started. */
  first_attempt_share_bps: number | null;
  requested_per_hour: number | null;
  started_per_hour: number | null;
  /**
   * The CURRENT count of queued + dispatched + deferred requests, whatever
   * their age — not scoped to the window.
   */
  queued_now: number | null;
  finished: {
    finished: number;
    working: number;
    closed_unfinished: number;
    unknown: number;
  };
  history_partial_rows: number;
}

export interface SpawnPerDeviceWire {
  device_id: string;
  placed: number;
  started: number;
  refused: number;
  deferred: number;
  wait_p50_secs: number | null;
}

export interface SpawnStatsWire {
  available: true;
  window: string;
  window_start: string;
  as_of: string;
  overall: SpawnStatsOverallWire;
  per_device: SpawnPerDeviceWire[];
  local_report_counts: unknown;
}

export interface SpawnEventWire {
  at: string;
  kind: string;
  device_id: string | null;
  reason: string | null;
  detail: unknown;
}

export interface SpawnDetailWire {
  available: true;
  request: SpawnRowWire;
  events: SpawnEventWire[];
}

// ---------------------------------------------------------------------------
// Reading a body, and reading a failure
// ---------------------------------------------------------------------------

/**
 * Why a read produced nothing to render. Every arm is UNKNOWN about the
 * ledger's contents — none of them is "no spawns".
 */
export type SpawnReadIssue =
  /** coord answered `{available: false, reason}` — its tables are absent. */
  | { kind: "ledger_not_deployed"; reason: string }
  /** 404/405/501 — this deployment does not serve the route yet. */
  | { kind: "route_unavailable" }
  /** coord answered `404 {"error": "route_disabled"}`: an operator switched it off. */
  | { kind: "route_disabled" }
  /** The web gate: only a coord tenant admin may read the ledger. */
  | { kind: "forbidden" }
  | { kind: "tenant_not_resolved" }
  /** Detail only: coord's `404 {"error": "spawn_not_found"}`. */
  | { kind: "not_found" }
  | { kind: "deadline"; budgetMs: number | null }
  /** The stats body answers a different window from the one asked for. */
  | { kind: "window_mismatch"; asked: string; answered: string }
  /** A 2xx whose body is not the contract's shape. */
  | { kind: "malformed" }
  | { kind: "error"; message: string };

export type SpawnBodyReading<T> =
  | { kind: "ok"; body: T }
  | { kind: "issue"; issue: SpawnReadIssue };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** coord's `{available: false, reason}` — the ledger tables are absent. */
function unavailableIssue(
  body: Record<string, unknown>
): SpawnReadIssue | null {
  if (body.available !== false) return null;
  return {
    kind: "ledger_not_deployed",
    reason:
      typeof body.reason === "string" && body.reason
        ? body.reason
        : "unspecified",
  };
}

/** The minimum a row needs to be listed: its identity, its clock and its state. */
export function isSpawnRow(v: unknown): v is SpawnRowWire {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.requested_at === "string" &&
    typeof v.state === "string"
  );
}

/** Read a `GET /spawns` body. */
export function readSpawnList(body: unknown): SpawnBodyReading<SpawnListWire> {
  if (!isRecord(body)) return { kind: "issue", issue: { kind: "malformed" } };
  const unavailable = unavailableIssue(body);
  if (unavailable) return { kind: "issue", issue: unavailable };
  if (body.available !== true || !Array.isArray(body.items)) {
    return { kind: "issue", issue: { kind: "malformed" } };
  }
  return { kind: "ok", body: body as unknown as SpawnListWire };
}

/**
 * Read a `GET /spawns/stats` body. With `asked`, a body that answers another
 * window is refused: its figures would be shown under a window label they do
 * not describe.
 */
export function readSpawnStats(
  body: unknown,
  asked?: SpawnStatsWindow
): SpawnBodyReading<SpawnStatsWire> {
  if (!isRecord(body)) return { kind: "issue", issue: { kind: "malformed" } };
  const unavailable = unavailableIssue(body);
  if (unavailable) return { kind: "issue", issue: unavailable };
  if (body.available !== true || !isRecord(body.overall)) {
    return { kind: "issue", issue: { kind: "malformed" } };
  }
  if (asked !== undefined && body.window !== asked) {
    return {
      kind: "issue",
      issue: {
        kind: "window_mismatch",
        asked,
        answered: typeof body.window === "string" ? body.window : "none",
      },
    };
  }
  return { kind: "ok", body: body as unknown as SpawnStatsWire };
}

/** Read a `GET /spawns/{id}` body. */
export function readSpawnDetail(
  body: unknown
): SpawnBodyReading<SpawnDetailWire> {
  if (!isRecord(body)) return { kind: "issue", issue: { kind: "malformed" } };
  const unavailable = unavailableIssue(body);
  if (unavailable) return { kind: "issue", issue: unavailable };
  if (
    body.available !== true ||
    !isSpawnRow(body.request) ||
    !Array.isArray(body.events)
  ) {
    return { kind: "issue", issue: { kind: "malformed" } };
  }
  return { kind: "ok", body: body as unknown as SpawnDetailWire };
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
 * Classify a rejected read. The web gate's 403 codes are read from whichever
 * key carries them (the app's error middleware puts an HTTPException's detail
 * in `message`; a bare FastAPI app in `detail`), exactly as the computers
 * console does. On the detail read, only coord's own
 * `{"error": "spawn_not_found"}` is "no such request"; any other 404 — the
 * `no_such_route` of a coord that predates the ledger — is "this deployment
 * does not serve the route".
 */
export function classifySpawnError(
  err: unknown,
  options: { detail?: boolean } = {}
): SpawnReadIssue {
  const status = httpStatusOf(err);
  const bodyText = httpBodyOf(err);
  const body = parseObject(bodyText);
  if (status === 403) {
    const code = [body?.message, body?.detail, body?.error].find(
      (v): v is string =>
        v === "not_coord_tenant_admin" || v === "tenant_not_resolved"
    );
    if (code === "not_coord_tenant_admin") return { kind: "forbidden" };
    if (code === "tenant_not_resolved") return { kind: "tenant_not_resolved" };
  }
  if (options.detail && status === 404 && body?.error === "spawn_not_found") {
    return { kind: "not_found" };
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
 * Does this issue SUPERSEDE a retained body rather than age it? coord saying
 * the ledger is absent, a refusal, "not found", and an answer to another
 * window are answers about the data itself — keeping the last body beside any
 * of them would show rows coord just said are not there (or not yours, or not
 * this window's). Every other failure keeps the last good body, labelled
 * stale.
 */
export function issueClearsRetained(issue: SpawnReadIssue): boolean {
  return (
    issue.kind === "ledger_not_deployed" ||
    issue.kind === "forbidden" ||
    issue.kind === "tenant_not_resolved" ||
    issue.kind === "not_found" ||
    issue.kind === "window_mismatch"
  );
}

/** The one-line reading of an issue, for a banner or a detail panel. */
export function spawnIssueText(issue: SpawnReadIssue, subject: string): string {
  switch (issue.kind) {
    case "ledger_not_deployed":
      return `Spawn ledger not deployed yet — coord answered that its ledger tables are absent (${issue.reason}), so ${subject} is unknown, not empty.`;
    case "route_unavailable":
      return `Coord does not serve the spawn ledger yet, so ${subject} is unknown, not empty.`;
    case "route_disabled":
      return `The spawn ledger read is ${ROUTE_DISABLED_TEXT} on coord, so ${subject} is unknown, not empty.`;
    case "forbidden":
      return "Only a coord tenant admin of the active project may read the spawn ledger.";
    case "tenant_not_resolved":
      return "No project was resolved for this read; select a project and try again.";
    case "not_found":
      return "Coord holds no such spawn request in this project.";
    case "deadline":
      return `Coord's read deadline${issue.budgetMs === null ? "" : ` (${issue.budgetMs} ms)`} ran out, so ${subject} is unknown.`;
    case "window_mismatch":
      return `Coord answered for the ${issue.answered} window, not the ${issue.asked} one asked for, so ${subject} is unknown.`;
    case "malformed":
      return `Coord answered with a body this page cannot read, so ${subject} is unknown.`;
    case "error":
      return `Could not read ${subject} — ${issue.message}`;
  }
}

/**
 * {@link spawnIssueText} for the mode on screen. While presenting, the two
 * arms that QUOTE are said in fixed words: `error` carries the client's
 * failure text (`GET <url> failed …`, coord's body), and `ledger_not_deployed`
 * coord's own reason token — neither was written for an outsider (plan
 * `2026-10-23-console-presentation-spaces` D3.3). Every other arm is fixed
 * words already, and reads the same in both modes.
 */
export function spawnIssueTextFor(
  issue: SpawnReadIssue,
  subject: string,
  presenting: boolean
): string {
  if (!presenting) return spawnIssueText(issue, subject);
  switch (issue.kind) {
    case "ledger_not_deployed":
      return `The record of spawn requests is not deployed yet, so ${subject} is unknown, not empty.`;
    case "error":
      return `The record of spawn requests could not be read, so ${subject} is unknown.`;
    default:
      return spawnIssueText(issue, subject);
  }
}

// ---------------------------------------------------------------------------
// Words — every wire token gets a human label, and keeps its token as a title
// ---------------------------------------------------------------------------

const ORIGIN_LABEL: Record<string, string> = {
  gate_continuation: "gate continuation",
  unit_continuation: "work-unit continuation",
  coord_dispatch: "coord dispatch",
  looping_agent: "looping agent",
  steward: "steward",
  respawn: "respawn",
  scheduler: "scheduler",
  orchestration: "orchestration",
  boot_resume: "resume at boot",
  operator_terminal: "operator terminal",
  operator_chat: "operator chat",
  unknown: "origin unknown",
};

/** Where a request came from, in words. An unrecognised token is shown as itself. */
export function originLabel(origin: string): string {
  return ORIGIN_LABEL[origin] ?? origin;
}

const PLACEMENT_BASIS_LABEL: Record<string, string> = {
  admitted: "admitted by the capacity check",
  unknown_capacity_runner_guard:
    "capacity unknown — the runner's own guard decided",
  pinned: "pinned to one device",
  preference_released: "preferred device released to another",
  attended: "attended (an operator launched it)",
};

export function placementBasisLabel(basis: string | null): string {
  if (basis === null) return "not recorded";
  return PLACEMENT_BASIS_LABEL[basis] ?? basis;
}

const EVENT_KIND_LABEL: Record<string, string> = {
  requested: "requested",
  placed: "placed",
  dispatched: "dispatched",
  deferred: "deferred",
  refused: "refused",
  rerouted: "rerouted",
  consumed: "picked up",
  spawned: "started",
  spawn_failed: "failed to start",
  expired: "expired",
  cancelled: "cancelled",
  outcome: "session outcome",
};

export function eventKindLabel(kind: string): string {
  return EVENT_KIND_LABEL[kind] ?? kind;
}

/** A duration in seconds, in the largest unit that keeps it readable. */
export function formatDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "unknown";
  const fmt = (v: number) =>
    v < 10 ? String(Number(v.toFixed(1))) : String(Math.round(v));
  if (secs < 60) return `${Math.round(secs)} s`;
  if (secs < 3600) return `${fmt(secs / 60)} min`;
  if (secs < 48 * 3600) return `${fmt(secs / 3600)} h`;
  return `${fmt(secs / 86400)} d`;
}

/**
 * A per-hour rate to two significant figures (`0.24/h`, `3.8/h`, `0.0012/h`),
 * so two close rates stay distinguishable. A rate of ten or more is rounded to
 * a whole number. `null` (coord could not state it) is `unknown`, never `0/h`.
 */
export function formatRate(perHour: number | null | undefined): string {
  if (perHour == null || !Number.isFinite(perHour) || perHour < 0)
    return "unknown";
  if (perHour === 0) return "0/h";
  if (perHour >= 10) return `${Math.round(perHour)}/h`;
  return `${Number(perHour.toPrecision(2))}/h`;
}

/** A basis-point share (`n / 10000`). `null` is `unknown`, never `0%`. */
export function formatBps(bps: number | null | undefined): string {
  if (bps == null) return "unknown";
  const text = shareOfFraction(bps / 10000);
  return text === "–" ? "unknown" : text;
}

/** A percentile in seconds. `null` is `unknown`. */
export function formatWait(secs: number | null | undefined): string {
  return secs == null ? "unknown" : formatDuration(secs);
}

/** A count coord sent, or `null` when it sent none — never defaulted to 0. */
function count(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function countText(v: unknown): string {
  const n = count(v);
  return n === null ? "unknown" : String(n);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Device names and roles
// ---------------------------------------------------------------------------

/** The roster entry the page resolves names from (`/fleet/health` devices). */
export interface RosterDevice {
  device_id: string;
  hostname?: string;
}

function sameId(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * A device's name from the fleet roster, else the first block of its id. The
 * caller puts the full id in a `title`, so a name that could not be resolved
 * is still identifiable.
 */
export function deviceName(
  deviceId: string,
  roster: ReadonlyArray<RosterDevice>
): string {
  const hit = roster.find((d) => sameId(d.device_id, deviceId));
  if (hit?.hostname) return hit.hostname;
  return `device ${deviceId.slice(0, 8)}`;
}

/**
 * How a surface names devices: the roster's hostname for the operator, the
 * session alias while presenting (`useMachineAliaser`, D3.3) — and whether a
 * device id may appear at all (never while presenting: it is an internal
 * identifier, and the lens's identity check refuses it).
 */
export interface DeviceNaming {
  nameOf: (deviceId: string) => string;
  showIds: boolean;
}

/**
 * Each device's dispatch role, as the page can state it: the words coord's
 * dispatch-role read gives a machine (`describeRole`), keyed by device id —
 * or, when that read is not (yet) usable, one reason it is unknown for every
 * device.
 */
export type DeviceRoles =
  | { kind: "known"; byDevice: ReadonlyMap<string, string> }
  | { kind: "unknown"; reason: string };

/** One device's role words; `unknown` when the read or the device is not covered. */
export function deviceRoleText(deviceId: string, roles: DeviceRoles): string {
  if (roles.kind === "unknown") return "role unknown";
  for (const [id, text] of roles.byDevice) {
    if (sameId(id, deviceId)) return text;
  }
  return "role unknown";
}

/**
 * The devices a row names, in the order a reader wants them: where it
 * started, else where it sits now, then a hard pin and a preference when they
 * differ from that. Deduplicated.
 */
export function rowDevices(row: SpawnRowWire): { id: string; role: string }[] {
  const out: { id: string; role: string }[] = [];
  const add = (id: string | null, role: string) => {
    if (id && !out.some((d) => d.id === id)) out.push({ id, role });
  };
  add(row.spawned_device_id, "started on");
  add(row.current_device_id, "placed on");
  add(row.pinned_device_id, "pinned to");
  add(row.preferred_device_id, "preferred");
  return out;
}

// ---------------------------------------------------------------------------
// The row status — the gates page's outcome words, plus four ledger words
// ---------------------------------------------------------------------------

/** The plan's target: a spawn starts within 10 minutes of its first attempt. */
export const SPAWN_TARGET_MS = 10 * 60 * 1_000;

/** A request still not started a day after its first attempt is stuck. */
export const SPAWN_STUCK_MS = 24 * 60 * 60 * 1_000;

/** The continuation kinds a spawn request can reach. */
type SharedKind = Extract<
  ContinuationKind,
  | "dispatched"
  | "dispatch_stalled"
  | "deferred"
  | "spawned"
  | "work_completed"
  | "work_abandoned"
  | "work_unreported"
  | "spawn_failed"
  | "expired"
  | "cancelled"
  | "unknown"
>;

/** A spawn request's status. Closed, so the palette audit has something total. */
export type SpawnKind =
  | "queued"
  | "waiting_late"
  | "waiting_stuck"
  | SharedKind
  | "superseded";

/**
 * The audited kind → attention table. Every shared kind takes the gates page's
 * own entry (`CONTINUATION_ATTENTION_BY_KIND` documents each), so the two
 * surfaces cannot disagree about what a word obliges a reader to do. The four
 * ledger-only kinds:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `queued` | `none` | coord holds it, under the 10-minute target, and has not sent it anywhere yet. Ordinary queueing — the reading `dispatched` takes. |
 * | `waiting_late` | `waiting` | not started, past the 10-minute target. It will still start by itself when a machine admits it — amber's promise — but it is late. |
 * | `waiting_stuck` | `author` | not started a day after its first attempt. Whatever was going to start it has not; a human decides. |
 * | `superseded` | `none` | a newer request for the same source replaced it. Terminal and deliberate, like `cancelled`; nothing is lost. |
 */
export const SPAWN_ATTENTION_BY_KIND: Record<SpawnKind, Attention> = {
  queued: "none",
  waiting_late: "waiting",
  waiting_stuck: "author",
  dispatched: CONTINUATION_ATTENTION_BY_KIND.dispatched,
  dispatch_stalled: CONTINUATION_ATTENTION_BY_KIND.dispatch_stalled,
  deferred: CONTINUATION_ATTENTION_BY_KIND.deferred,
  spawned: CONTINUATION_ATTENTION_BY_KIND.spawned,
  work_completed: CONTINUATION_ATTENTION_BY_KIND.work_completed,
  work_abandoned: CONTINUATION_ATTENTION_BY_KIND.work_abandoned,
  work_unreported: CONTINUATION_ATTENTION_BY_KIND.work_unreported,
  spawn_failed: CONTINUATION_ATTENTION_BY_KIND.spawn_failed,
  expired: CONTINUATION_ATTENTION_BY_KIND.expired,
  cancelled: CONTINUATION_ATTENTION_BY_KIND.cancelled,
  superseded: "none",
  unknown: CONTINUATION_ATTENTION_BY_KIND.unknown,
};

export const SPAWN_KIND_CLASS: Record<SpawnKind, string> = {
  queued: INERT,
  waiting_late: WAITING_AMBER,
  waiting_stuck: AUTHOR_RED,
  dispatched: CONTINUATION_KIND_CLASS.dispatched,
  dispatch_stalled: CONTINUATION_KIND_CLASS.dispatch_stalled,
  deferred: CONTINUATION_KIND_CLASS.deferred,
  spawned: CONTINUATION_KIND_CLASS.spawned,
  work_completed: CONTINUATION_KIND_CLASS.work_completed,
  work_abandoned: CONTINUATION_KIND_CLASS.work_abandoned,
  work_unreported: CONTINUATION_KIND_CLASS.work_unreported,
  spawn_failed: CONTINUATION_KIND_CLASS.spawn_failed,
  expired: CONTINUATION_KIND_CLASS.expired,
  cancelled: CONTINUATION_KIND_CLASS.cancelled,
  superseded: CONTINUATION_KIND_CLASS.cancelled,
  unknown: CONTINUATION_KIND_CLASS.unknown,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds, derived. */
export const SPAWN_AUTHOR_GLYPH_KINDS: ReadonlySet<SpawnKind> = new Set(
  (Object.keys(SPAWN_ATTENTION_BY_KIND) as SpawnKind[]).filter(
    (k) => SPAWN_ATTENTION_BY_KIND[k] === "author"
  )
);

export const SPAWN_STATUS_PALETTE: StatusPalette<SpawnKind> = {
  badgeClass: SPAWN_KIND_CLASS,
  authorGlyphKinds: SPAWN_AUTHOR_GLYPH_KINDS,
  // `work_completed` alone, as on the gates page: `spawned` gets no ✓.
  doneGlyphKinds: new Set<SpawnKind>(["work_completed"]),
};

function status(
  kind: SpawnKind,
  label: string,
  reason?: string
): RowStatus<SpawnKind> {
  return { kind, label, reason, attention: SPAWN_ATTENTION_BY_KIND[kind] };
}

function ageMs(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, nowMs - t) : null;
}

const PENDING_WORD: Record<string, string> = {
  queued: "Queued",
  dispatched: "Dispatched",
  deferred: "Deferred",
};

/** A request coord has not started yet — see the module header's age bands. */
function pendingStatus(row: SpawnRowWire, nowMs: number): RowStatus<SpawnKind> {
  const word = PENDING_WORD[row.state] ?? row.state;
  const waited = ageMs(row.requested_at, nowMs);
  const deferrals =
    typeof row.deferrals === "number" && row.deferrals > 0
      ? ` (deferred ${plural(row.deferrals, "time")})`
      : "";
  if (waited === null) {
    return status(
      "unknown",
      `${word} — age unreadable`,
      "coord's request time could not be read, so how long it has waited is unknown"
    );
  }
  const waitedText = formatDuration(waited / 1000);
  if (waited >= SPAWN_STUCK_MS) {
    return status(
      "waiting_stuck",
      `${word} ${waitedText} — stuck`,
      `waiting ${waitedText} since its first attempt${deferrals}; nothing has started it`
    );
  }
  if (row.state === "dispatched") {
    const sinceDispatch = ageMs(row.updated_at, nowMs);
    if (sinceDispatch !== null && sinceDispatch >= DISPATCH_STALE_MS) {
      return status(
        "dispatch_stalled",
        "Dispatch stalled",
        `sent ${formatDuration(sinceDispatch / 1000)} ago and no runner has picked it up`
      );
    }
  }
  if (waited >= SPAWN_TARGET_MS) {
    return status(
      "waiting_late",
      `${word} ${waitedText}`,
      `waiting ${waitedText} — past the 10-minute target${deferrals}`
    );
  }
  switch (row.state) {
    case "queued":
      return status(
        "queued",
        "Queued",
        `coord has held it for ${waitedText}; no machine chosen yet`
      );
    case "dispatched":
      return status(
        "dispatched",
        "Dispatched",
        "sent to a runner; waiting for it to pick the request up"
      );
    default:
      return status(
        "deferred",
        "Deferred",
        `a runner pushed it back${deferrals}; coord will place it again`
      );
  }
}

/** How {@link deriveSpawnStatus} may word a status. */
export interface SpawnStatusOptions {
  /**
   * Quote coord's own text — a `terminal_reason`, an unrecognised state or
   * outcome token. Default `true`. Presentation mode passes `false`: coord's
   * reason can name a pull request, a repository or a machine, so the fixed
   * sentence each arm already falls back to is used instead (D3.3).
   */
  quoteCoord?: boolean;
}

/** One request's status — the gates page's words, aged as the module header says. */
export function deriveSpawnStatus(
  row: SpawnRowWire,
  nowMs: number,
  options: SpawnStatusOptions = {}
): RowStatus<SpawnKind> {
  const quote = options.quoteCoord ?? true;
  const reasonOr = (fallback: string): string =>
    quote && row.terminal_reason ? row.terminal_reason : fallback;
  switch (row.state) {
    case "queued":
    case "dispatched":
    case "deferred":
      return pendingStatus(row, nowMs);
    case "spawned":
      switch (row.session_outcome) {
        case "finished":
          return status(
            "work_completed",
            "Finished",
            "the session reported its work finished"
          );
        case "closed_unfinished":
          return status(
            "work_abandoned",
            "Closed unfinished",
            "the session closed before finishing its work"
          );
        case "unknown":
          return status(
            "work_unreported",
            "Started · outcome unknown",
            "the session ended without saying whether the work was done"
          );
        case "working":
          return status(
            "spawned",
            "Started · working",
            "the session is still working; it has not reported an outcome"
          );
        case null:
        case undefined:
          return status(
            "spawned",
            "Started · no outcome yet",
            "a session started; nothing has reported whether its work happened"
          );
        default:
          return status(
            "unknown",
            "Started · outcome unreadable",
            quote
              ? `coord reported an outcome this page has no reading for: ${row.session_outcome}`
              : "coord reported an outcome this page has no reading for"
          );
      }
    case "failed":
      return status(
        "spawn_failed",
        "Failed to start",
        reasonOr("no session opened; coord recorded no reason")
      );
    case "expired":
      return status(
        "expired",
        "Expired",
        reasonOr("coord gave up placing it; nothing will start it now")
      );
    case "cancelled":
      return status(
        "cancelled",
        "Cancelled",
        reasonOr("withdrawn before it started")
      );
    case "superseded":
      return status(
        "superseded",
        "Superseded",
        reasonOr("a newer request for the same work replaced it")
      );
    default:
      return status(
        "unknown",
        "Unknown state",
        quote
          ? `coord reported a state this page has no reading for: ${row.state}`
          : "coord reported a state this page has no reading for"
      );
  }
}

/**
 * The row's time-to-spawn sentence. Started: coord's `wait_seconds`. Still
 * pending: how long it has waited so far, by this page's clock — labelled
 * "so far" so it is never read as a time to spawn. Ended without starting:
 * there is no time to spawn, and the sentence says so rather than printing 0.
 */
export function timeToSpawnText(row: SpawnRowWire, nowMs: number): string {
  if (row.state === "spawned") {
    return typeof row.wait_seconds === "number"
      ? `started after ${formatDuration(row.wait_seconds)}`
      : "started; wait unknown";
  }
  if (PENDING_STATES.has(row.state)) {
    const waited = ageMs(row.requested_at, nowMs);
    return waited === null
      ? "waiting; since unknown"
      : `waiting ${formatDuration(waited / 1000)} so far`;
  }
  return "never started";
}

// ---------------------------------------------------------------------------
// The rows on screen
// ---------------------------------------------------------------------------

/** States of a request coord has not started yet. */
export const PENDING_STATES: ReadonlySet<string> = new Set([
  "queued",
  "dispatched",
  "deferred",
]);

const NEVER_RAN_STATES: ReadonlySet<string> = new Set([
  "expired",
  "cancelled",
  "superseded",
]);

/**
 * The window's rows plus the requests still waiting, whatever their age —
 * deduplicated by id, newest first. A request waiting from before the window
 * is exactly the case the plan was written about (a continuation deferred 43
 * times over 3 days), so a window-scoped list alone would hide it.
 */
export function mergeSpawnRows(
  windowRows: ReadonlyArray<SpawnRowWire> | null,
  pendingRows: ReadonlyArray<SpawnRowWire> | null
): SpawnRowWire[] | null {
  if (windowRows === null && pendingRows === null) return null;
  const byId = new Map<string, SpawnRowWire>();
  for (const r of [...(pendingRows ?? []), ...(windowRows ?? [])]) {
    if (isSpawnRow(r)) byId.set(r.id, r);
  }
  return [...byId.values()].sort(
    (a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at)
  );
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

export type SpawnFilter =
  | "all"
  | "queued"
  | "failed"
  | "never_ran"
  | "finished";

export const SPAWN_FILTERS: ReadonlyArray<{
  id: SpawnFilter;
  label: string;
  title: string;
}> = [
  {
    id: "all",
    label: "All",
    title: "Every request in the window, plus the older ones still waiting",
  },
  {
    id: "queued",
    label: "Queued",
    title:
      "Not started yet, whatever their age: queued, dispatched or deferred",
  },
  {
    id: "failed",
    label: "Failed",
    title: "A start was attempted and no session opened",
  },
  {
    id: "never_ran",
    label: "Never ran",
    title: "Ended without a start attempt: expired, cancelled or superseded",
  },
  {
    id: "finished",
    label: "Finished",
    title: "Started, and the session reported its work finished",
  },
];

export function matchesSpawnFilter(
  row: SpawnRowWire,
  filter: SpawnFilter
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "queued":
      return PENDING_STATES.has(row.state);
    case "failed":
      return row.state === "failed";
    case "never_ran":
      return NEVER_RAN_STATES.has(row.state);
    case "finished":
      return row.state === "spawned" && row.session_outcome === "finished";
  }
}

/** Which of the page's two row reads answered: the window's list, and the every-age waiting list. */
export interface SpawnReadsAnswered {
  list: boolean;
  pending: boolean;
}

/**
 * Does this tab have an answer? Queued rests on the every-age waiting read;
 * Failed, Never ran and Finished on the window's list; All on both. A tab
 * whose read did not answer has no count and no "none" sentence — the rows
 * the other read brought are not its answer.
 */
export function spawnFilterAnswered(
  filter: SpawnFilter,
  reads: SpawnReadsAnswered
): boolean {
  switch (filter) {
    case "queued":
      return reads.pending;
    case "all":
      return reads.list && reads.pending;
    default:
      return reads.list;
  }
}

/**
 * Each tab's count over the loaded rows; `null` (rendered `–`) when the read
 * the tab rests on has not answered.
 */
export function spawnFilterCounts(
  rows: ReadonlyArray<SpawnRowWire> | null,
  reads: SpawnReadsAnswered
): Record<SpawnFilter, number | null> {
  const counts = {} as Record<SpawnFilter, number | null>;
  for (const f of SPAWN_FILTERS) {
    counts[f.id] =
      rows === null || !spawnFilterAnswered(f.id, reads)
        ? null
        : rows.filter((r) => matchesSpawnFilter(r, f.id)).length;
  }
  return counts;
}

/**
 * Each tab's own empty sentence, for a tab whose read answered — what came
 * back empty, in words.
 *
 * - `scope` is `"window"` when the rows cover the whole window and `"loaded"`
 *   when coord truncated the list, so the sentence never claims more than the
 *   rows read.
 * - `stale` dates the claim: the latest read failed, so it is the last good
 *   read's answer, not now's.
 */
export function spawnFilterEmptyText(
  filter: SpawnFilter,
  windowLabel: string,
  options: { scope: "window" | "loaded"; stale: boolean }
): string {
  const where =
    options.scope === "window" ? `in the ${windowLabel}` : "in the rows loaded";
  const when = options.stale ? " at the last good read" : "";
  switch (filter) {
    case "all":
      return `Coord recorded no spawn request ${where}, and none older was waiting${when}.`;
    case "queued":
      return `No request was waiting to start${when} — none queued, dispatched or deferred, of any age.`;
    case "failed":
      return `No request ${where} failed to start${when}.`;
    case "never_ran":
      return `No request ${where} expired, was cancelled or was superseded${when}.`;
    case "finished":
      return `No request ${where} started and reported its work finished${when}.`;
  }
}

/** A tab whose read did not answer: what is unknown, in words — never "none". */
export function spawnFilterUnknownText(
  filter: SpawnFilter,
  windowLabel: string,
  reads: SpawnReadsAnswered
): string {
  const listUnread = `Coord's list of the requests in the ${windowLabel} could not be read`;
  const pendingUnread =
    "Coord's list of the requests still waiting could not be read";
  switch (filter) {
    case "queued":
      return `${pendingUnread} — which requests are waiting is unknown, not none.`;
    case "all":
      return reads.list
        ? `${pendingUnread} — whether an older request is waiting is unknown, not none.`
        : `${listUnread} — which spawns were requested is unknown, not none.`;
    case "failed":
      return `${listUnread} — which of them failed to start is unknown, not none.`;
    case "never_ran":
      return `${listUnread} — which of them expired, were cancelled or were superseded is unknown, not none.`;
    case "finished":
      return `${listUnread} — which of them finished is unknown, not none.`;
  }
}

// ---------------------------------------------------------------------------
// The window
// ---------------------------------------------------------------------------

export interface SpawnWindowSpec {
  id: SpawnStatsWindow;
  label: string;
  ms: number;
}

/** coord's default window, and the page's. */
const SEVEN_DAYS: SpawnWindowSpec = {
  id: "7d",
  label: "last 7 days",
  ms: 7 * 24 * 3600_000,
};

export const SPAWN_WINDOWS: ReadonlyArray<SpawnWindowSpec> = [
  { id: "24h", label: "last 24 hours", ms: 24 * 3600_000 },
  SEVEN_DAYS,
  { id: "30d", label: "last 30 days", ms: 30 * 24 * 3600_000 },
];

export function windowSpec(id: SpawnStatsWindow): SpawnWindowSpec {
  return SPAWN_WINDOWS.find((w) => w.id === id) ?? SEVEN_DAYS;
}

// ---------------------------------------------------------------------------
// The health strip
// ---------------------------------------------------------------------------

export interface SpawnsHealthInput {
  /** The last good stats body for the window on screen, or `null`. */
  stats: SpawnStatsWire | null;
  /** The latest stats read's issue, or `null` after a success. */
  issue: SpawnReadIssue | null;
  window: SpawnStatsWindow;
  /**
   * The rows on screen (the window's plus the requests still waiting), or
   * `null` before either read answered. A row that reads red — stuck, a
   * stalled dispatch, a session closed unfinished — turns the strip red too,
   * so the strip never reads calmer than a row beneath it.
   */
  rows: ReadonlyArray<SpawnRowWire> | null;
  /** The page clock, which ages the waiting rows. */
  nowMs: number;
  /** The browser clock's rendering of an instant (injected for tests). */
  clock: (iso: string) => string;
  /**
   * Presentation mode: a failed read's sentence is said in fixed words
   * (`spawnIssueTextFor`). Default `false`.
   */
  presenting?: boolean;
}

export interface SpawnsHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
  /** Mirrors `level`, plus the arm a UI Bridge reader needs: `unknown`. */
  verdict: "red" | "amber" | "green" | "unknown" | "stale";
}

function headlineForIssue(issue: SpawnReadIssue): string {
  switch (issue.kind) {
    case "ledger_not_deployed":
      return "Spawn ledger not deployed yet";
    case "forbidden":
      return "Coord tenant admins only";
    case "route_unavailable":
      return "Coord does not serve the spawn ledger yet";
    default:
      return "Spawn statistics unknown";
  }
}

/** The rows on screen that read red, by the reason the headline names. */
interface RedRows {
  /** `waiting_stuck`: not started a day after the first attempt. */
  stuck: number;
  /** The longest wait among the stuck rows, in seconds. */
  oldestStuckSecs: number | null;
  /** `dispatch_stalled`: dispatched, and no runner picked it up. */
  stalled: number;
  failed: number;
  abandoned: number;
  total: number;
}

function redRows(
  rows: ReadonlyArray<SpawnRowWire> | null,
  nowMs: number
): RedRows {
  const red: RedRows = {
    stuck: 0,
    oldestStuckSecs: null,
    stalled: 0,
    failed: 0,
    abandoned: 0,
    total: 0,
  };
  for (const row of rows ?? []) {
    const s = deriveSpawnStatus(row, nowMs);
    if (s.attention !== "author") continue;
    red.total += 1;
    if (s.kind === "waiting_stuck") {
      red.stuck += 1;
      const waited = ageMs(row.requested_at, nowMs);
      if (waited !== null) {
        red.oldestStuckSecs = Math.max(red.oldestStuckSecs ?? 0, waited / 1000);
      }
    } else if (s.kind === "dispatch_stalled") {
      red.stalled += 1;
    } else if (s.kind === "spawn_failed" || s.kind === "expired") {
      red.failed += 1;
    } else if (s.kind === "work_abandoned") {
      red.abandoned += 1;
    }
  }
  return red;
}

/**
 * coord's window figures for the two clauses it can count over the whole
 * window — `null` when coord sent none (or no stats answered).
 */
interface WindowRedCounts {
  failedOrExpired: number | null;
  closedUnfinished: number | null;
}

/**
 * The red headline's clauses, most actionable first, each in the word its
 * rows use: "stuck" only for a request waiting past a day, "dispatch
 * stalled" for a dispatch no runner picked up.
 *
 * Failed-or-expired and closed-unfinished are coord's window figures when
 * coord sent them — the same numbers the strip's badges show, which a
 * truncated list cannot reach — and the rows on screen stand in only when
 * coord sent none. A red row no clause names is still counted ("needs a
 * decision"), so the strip never reads calmer than a row beneath it.
 */
function redClauses(
  red: RedRows,
  window: WindowRedCounts,
  windowLabel: string
): string[] {
  const clauses: string[] = [];
  let named = 0;
  if (red.stuck > 0) {
    const age =
      red.oldestStuckSecs === null
        ? "an unknown time"
        : formatDuration(red.oldestStuckSecs);
    clauses.push(
      red.stuck === 1
        ? `1 spawn stuck for ${age}`
        : `${red.stuck} spawns stuck, the oldest for ${age}`
    );
    named += red.stuck;
  }
  if (red.stalled > 0) {
    clauses.push(
      red.stalled === 1
        ? "1 dispatch stalled"
        : `${red.stalled} dispatches stalled`
    );
    named += red.stalled;
  }
  const failed = window.failedOrExpired ?? red.failed;
  if (failed > 0) {
    clauses.push(
      clauses.length === 0
        ? `${plural(failed, "spawn")} failed or expired in the ${windowLabel}`
        : `${failed} failed or expired in the ${windowLabel}`
    );
    named += red.failed;
  }
  const abandoned = window.closedUnfinished ?? red.abandoned;
  if (abandoned > 0) {
    clauses.push(`${plural(abandoned, "session")} closed unfinished`);
    named += red.abandoned;
  }
  if (red.total > named) {
    const n = red.total - named;
    clauses.push(`${plural(n, "spawn")} need${n === 1 ? "s" : ""} a decision`);
  }
  return clauses;
}

/**
 * The strip. Every window-scoped number on it is coord's aggregate over the
 * window, and the detail line names that window and its as-of time; `queued
 * now` is coord's CURRENT count, whatever the request's age, and says so.
 * Level:
 *
 * - **red** — a request failed to start or expired in the window, a session
 *   closed unfinished in it (both coord's window figures), or a row on screen
 *   reads red (stuck past a day, a stalled dispatch): the strip is never
 *   calmer than a row beneath it, and the headline names what is red, most
 *   actionable first, in the rows' own words;
 * - **amber** — requests are waiting to start (they will clear themselves), or
 *   the read is unknown or stale — a stale all-clear is never green;
 * - **green** — nothing failed or expired, nothing is waiting, no row is red.
 */
export function deriveSpawnsHealth(input: SpawnsHealthInput): SpawnsHealth {
  const { stats, issue, window } = input;
  const spec = windowSpec(window);
  const red = redRows(input.rows, input.nowMs);
  if (stats === null) {
    const clauses = redClauses(
      red,
      { failedOrExpired: null, closedUnfinished: null },
      spec.label
    );
    if (clauses.length > 0) {
      return {
        level: "red",
        headline: clauses.join("; "),
        detail:
          issue === null
            ? `Aggregates over the ${spec.label} appear once coord answers.`
            : spawnIssueTextFor(
              issue,
              "every aggregate on this strip",
              input.presenting ?? false
            ),
        badges: [],
        verdict: "red",
      };
    }
    if (issue === null) {
      return {
        level: "amber",
        headline: "Reading the spawn ledger…",
        detail: `Aggregates over the ${spec.label} appear once coord answers.`,
        badges: [],
        verdict: "unknown",
      };
    }
    return {
      level: "amber",
      headline: headlineForIssue(issue),
      detail: spawnIssueTextFor(
              issue,
              "every aggregate on this strip",
              input.presenting ?? false
            ),
      badges: [],
      verdict: "unknown",
    };
  }

  const o = stats.overall;
  const failed = count(o.failed);
  const expired = count(o.expired);
  const failedOrExpired =
    failed === null || expired === null ? null : failed + expired;
  const terminal = count(o.terminal);
  const started = count(o.spawned);
  const requested = count(o.requested);
  const queuedNow = count(o.queued_now);
  const outcomes = isRecord(o.finished) ? o.finished : null;
  const windowText = `${spec.label} (since ${input.clock(stats.window_start)}) · as of ${input.clock(stats.as_of)}`;
  const stale = issue !== null;

  const badges: HealthBadge[] = [
    {
      key: "started-share",
      label:
        o.started_share_bps == null
          ? `started share unknown (${terminal === null ? "ended count unknown" : plural(terminal, "ended request")})`
          : `started ${formatBps(o.started_share_bps)} of ${terminal === null ? "an unknown number of ended requests" : plural(terminal, "ended request")}`,
      tone: o.started_share_bps == null ? "waiting" : "default",
      title: `Of the requests that ended in the ${spec.label}: ${countText(o.spawned)} started, ${countText(o.failed)} failed to start, ${countText(o.expired)} expired, ${countText(o.cancelled)} cancelled, ${countText(o.superseded)} superseded.`,
      "data-testid": "coord-spawns-started-share",
    },
    {
      key: "outcomes",
      label:
        outcomes === null
          ? "session outcomes unknown"
          : `outcomes ${countText(outcomes.finished)} finished · ${countText(outcomes.working)} working · ${countText(outcomes.closed_unfinished)} closed unfinished · ${countText(outcomes.unknown)} unknown`,
      tone: outcomes === null ? "waiting" : "default",
      title:
        "What the sessions that started in the window reported. Only a session that reported its work finished counts as finished; one that ended without saying is unknown, never finished.",
      "data-testid": "coord-spawns-outcomes",
    },
    {
      key: "time-to-spawn",
      label: `time to spawn p50 ${formatWait(o.wait_p50_secs)} · p90 ${formatWait(o.wait_p90_secs)}`,
      tone:
        o.wait_p50_secs == null || o.wait_p90_secs == null
          ? "waiting"
          : "default",
      title:
        "From the first moment coord tried to place a request to the moment its session started, over the requests that started.",
      "data-testid": "coord-spawns-time-to-spawn",
    },
    {
      key: "rates",
      label: `requested ${formatRate(o.requested_per_hour)} · started ${formatRate(o.started_per_hour)} (${countText(o.requested)} requested · ${countText(o.spawned)} started)`,
      tone:
        o.requested_per_hour == null || o.started_per_hour == null
          ? "waiting"
          : "default",
      title: `Requests per hour against starts per hour over the ${spec.label}, with the window's counts beside them. Requested per hour is the optimal rate: every request started on its first attempt.`,
      "data-testid": "coord-spawns-rates",
    },
    {
      key: "first-attempt",
      label:
        o.first_attempt_share_bps != null
          ? `first attempt ${formatBps(o.first_attempt_share_bps)} of started`
          : started === 0
            ? "first attempt unknown (none started)"
            : "first attempt unknown",
      tone: o.first_attempt_share_bps == null ? "waiting" : "default",
      title:
        "Of the requests that started: the share that started on their first attempt with no deferral.",
      "data-testid": "coord-spawns-first-attempt",
    },
    {
      key: "queued-now",
      label:
        queuedNow === null ? "queued now unknown" : `queued now ${queuedNow}`,
      tone: queuedNow === null ? "waiting" : "default",
      title: `Requests not started yet as of ${input.clock(stats.as_of)}, whatever their age — queued, dispatched or deferred. Not limited to the window; the Queued tab lists them.`,
      "data-testid": "coord-spawns-queued-now",
    },
  ];
  const historyPartial = count(o.history_partial_rows);
  if (historyPartial !== null && historyPartial > 0) {
    badges.push({
      key: "history-partial",
      label: `history partial ${historyPartial}`,
      tone: "muted",
      title:
        "Requests backfilled from records that predate the spawn ledger: their device history is incomplete.",
      "data-testid": "coord-spawns-history-partial",
    });
  }

  let level: HealthStripLevel;
  let headline: string;
  const clauses = redClauses(
    red,
    {
      failedOrExpired,
      closedUnfinished:
        outcomes === null ? null : count(outcomes.closed_unfinished),
    },
    spec.label
  );
  if (clauses.length > 0) {
    level = "red";
    headline = clauses.join("; ");
  } else if (failedOrExpired === null) {
    level = "amber";
    headline = "Whether any spawn failed or expired is unknown";
  } else if (queuedNow === null) {
    level = "amber";
    headline = "Nothing failed or expired; the queued backlog is unknown";
  } else if (queuedNow > 0) {
    level = "amber";
    headline = `${plural(queuedNow, "spawn")} waiting to start`;
  } else {
    level = "green";
    headline =
      requested === 0
        ? `No spawn was requested in the ${spec.label}, and none is waiting`
        : `No spawn failed or expired in the ${spec.label}, and none is waiting`;
  }
  if (stale && level === "green") {
    level = "amber";
    headline = `At the last good read: ${headline.charAt(0).toLowerCase()}${headline.slice(1)}`;
  }
  return {
    level,
    headline,
    detail: stale
      ? `Last refresh failed — these figures are stale. ${windowText}`
      : windowText,
    badges,
    verdict: stale ? "stale" : level,
  };
}

// ---------------------------------------------------------------------------
// Per device
// ---------------------------------------------------------------------------

/**
 * One `ShareList` line per device coord placed spawns on, ranked by placed.
 * The share is of every placement in the window; a window with no placement
 * has no share to state, and the bar says so (dashed, `–`). A device whose
 * `placed` coord did not send as a number reads `unknown` and is left out of
 * the total, so it cannot shrink every other device's share.
 *
 * The line's label carries the device's dispatch role (served today); its
 * current reserve and ceilings are NOT on the wire until the spawn reserve
 * ships (the plan's Phase 6), so the page states that once for the whole list
 * and each line's title says it again. The detail leads with the wait p50 —
 * the figure most worth seeing when the line truncates.
 */
export function perDeviceShares(
  stats: SpawnStatsWire,
  roles: DeviceRoles,
  naming: DeviceNaming
): { items: ShareListItem[]; total: number | null } {
  const rows = Array.isArray(stats.per_device) ? stats.per_device : [];
  const total = rows.reduce((sum, d) => sum + (count(d.placed) ?? 0), 0);
  const items = rows.map((d) => {
    const name = naming.nameOf(d.device_id);
    const role = deviceRoleText(d.device_id, roles);
    const wait = formatWait(d.wait_p50_secs);
    const split = `${countText(d.started)}/${countText(d.refused)}/${countText(d.deferred)}`;
    const id = naming.showIds ? ` (${d.device_id})` : "";
    const roleWhy =
      roles.kind === "unknown" && naming.showIds
        ? ` Role unknown: ${roles.reason}`
        : "";
    const full = `${name}${id} — role: ${role}. Placed ${countText(d.placed)}, started ${countText(d.started)}, refused ${countText(d.refused)}, deferred ${countText(d.deferred)}; time to spawn p50 ${wait}. Reserve and ceilings: not served yet.${roleWhy}`;
    return {
      key: d.device_id,
      label: `${name} · ${role}`,
      count: count(d.placed),
      title: full,
      detail: `p50 ${wait} · ${split} started/refused/deferred`,
      detailTitle: full,
      "data-testid": "coord-spawns-device",
    } satisfies ShareListItem;
  });
  return { items, total: total > 0 ? total : null };
}

// ---------------------------------------------------------------------------
// Requests made per hour, and when those requests started
// ---------------------------------------------------------------------------

export interface RatePoint {
  /** Start of the UTC hour, epoch ms. */
  hourMs: number;
  requested: number;
  started: number;
}

export interface RateSeries {
  points: RatePoint[];
  /** The span drawn — the window, or less when the list was truncated. */
  fromMs: number;
  toMs: number;
  /** True when the loaded rows do not cover the whole window. */
  partial: boolean;
}

const HOUR_MS = 3600_000;

/**
 * Per UTC hour of the span: how many requests were MADE, and how many of
 * those same requests started in it.
 *
 * Both series count only requests made inside the drawn span — the list is a
 * read of requests by `requested_at`, so it does not carry a request made
 * before the span that started inside it, and the started series therefore
 * is NOT every start in the span. The chart's caption says so. A requested
 * count of zero in an hour of the span is a measured zero; a started count is
 * a count of these requests only.
 *
 * The span starts at the first FULL UTC hour the read covers — after the
 * window's start, or, when coord truncated the list, after the oldest row
 * loaded (and `partial` says so) — because the hour either falls in was only
 * partly read. Hours before it are not drawn rather than drawn as zeros.
 * Returns `null` when no instant can anchor it.
 */
export function hourlyRates(
  list: SpawnListWire,
  windowMs: number
): RateSeries | null {
  const toMs = Date.parse(list.as_of);
  if (!Number.isFinite(toMs)) return null;
  const rows = list.items.filter(isSpawnRow);
  let fromMs = toMs - windowMs;
  if (list.truncated) {
    const oldest = rows.reduce((min, r) => {
      const t = Date.parse(r.requested_at);
      return Number.isFinite(t) && t < min ? t : min;
    }, Number.POSITIVE_INFINITY);
    if (!Number.isFinite(oldest)) return null;
    fromMs = Math.max(fromMs, oldest);
  }
  // The first FULL hour the read covers: the hour `fromMs` falls in was only
  // partly read, so drawing it would present a part-hour as a measured one.
  const firstHour = Math.ceil(fromMs / HOUR_MS) * HOUR_MS;
  if (firstHour > toMs) return null;
  const lastHour = Math.floor(toMs / HOUR_MS) * HOUR_MS;
  const points: RatePoint[] = [];
  for (let h = firstHour; h <= lastHour; h += HOUR_MS) {
    points.push({ hourMs: h, requested: 0, started: 0 });
  }
  const bucket = (t: number): RatePoint | undefined =>
    Number.isFinite(t) && t >= firstHour && t <= toMs
      ? points[Math.floor((t - firstHour) / HOUR_MS)]
      : undefined;
  for (const r of rows) {
    const requestedAt = Date.parse(r.requested_at);
    const req = bucket(requestedAt);
    if (!req) continue; // made outside the span: neither series counts it
    req.requested += 1;
    if (r.spawned_at) {
      const st = bucket(Date.parse(r.spawned_at));
      if (st) st.started += 1;
    }
  }
  return { points, fromMs: firstHour, toMs, partial: list.truncated };
}
