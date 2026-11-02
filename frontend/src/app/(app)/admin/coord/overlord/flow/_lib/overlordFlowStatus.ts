/**
 * Pure derivations for `/admin/coord/overlord/flow` (style guide R8: no
 * derivation inline in JSX).
 *
 * Plan `2026-10-23-the-overlord-keeps-no-record-of-session-flow-so-its-development-runs-on-anecdote`
 * Phase 4. The page renders coord's `GET /coord/overlord/flow` answer; every
 * number on it is coord's, and this module only narrows the wire shape, words
 * it, and decides what is UNKNOWN.
 *
 * ## Three states per number, never two
 *
 * - a **number** — coord measured it;
 * - **`null`** — coord ANSWERED and said "not measurable" (a median over no
 *   closed session, a rate over no nudge, a share over an empty pass). It
 *   renders as an explicit, labelled "no data" — never a `0`, which would
 *   claim a measurement;
 * - **`undefined`** — the field did not arrive (a coord build that predates
 *   it, a drifted shape) or the read failed. It renders as `–` with an
 *   "unknown" title: we do not know, which is a different sentence from
 *   "coord had nothing to measure" (style guide R6, *"a read can SUCCEED and
 *   not carry the number"*).
 */

import type { HealthBadge, HealthStripLevel } from "@/components/console";
import {
  readIsUnknown,
  staleDetail,
  UNKNOWN_COUNTS_DETAIL,
} from "@/components/console";
import { httpBodyOf, httpStatusOf } from "@/components/admin/coord/httpStatus";
import type { FlowUnchangedSession } from "@/lib/api/operations/overlordFlow";

// ---------------------------------------------------------------------------
// Window picker
// ---------------------------------------------------------------------------

export const FLOW_WINDOWS = [
  { id: "24h", hours: 24, words: "the last 24 hours" },
  { id: "7d", hours: 168, words: "the last 7 days" },
  { id: "30d", hours: 720, words: "the last 30 days" },
] as const;

export type FlowWindowId = (typeof FLOW_WINDOWS)[number]["id"];

export function flowWindow(id: FlowWindowId) {
  return FLOW_WINDOWS.find((w) => w.id === id) ?? FLOW_WINDOWS[1];
}

/**
 * How many consecutive FULL passes a session must hold the same verdict and
 * reasons across to count as unchanged. Sent explicitly (it is coord's
 * default too) so the page's "can unchanged be seen at all?" gate is about
 * the threshold coord actually applied, not a default that could move.
 */
export const UNCHANGED_MIN_PASSES = 3;

/** The query string asked of the proxy for a window. */
export function flowQuery(id: FlowWindowId): string {
  const qs = new URLSearchParams();
  qs.set("window_hours", String(flowWindow(id).hours));
  qs.set("unchanged_min_passes", String(UNCHANGED_MIN_PASSES));
  return qs.toString();
}

/** Whether an EMPTY unchanged list can be read as "nothing is stuck". */
export interface UnchangedCoverage {
  /** True only when EVERY runner in the window ran enough full passes. */
  everyRunnerCovered: boolean;
  /** Why, in words — one clause, no trailing punctuation (strip and list). */
  sentence: string;
}

/**
 * Could an unchanged session have been SEEN on every runner?
 *
 * Unchanged is decided per `(device_id, runner_port)` over consecutive FULL
 * passes (filtered passes never count), so the question is per runner: a
 * runner that ran fewer than the applied threshold cannot have produced an
 * unchanged row, however many full passes the tenant ran in total — two
 * runners with 2 full passes each total 4 and still could not see one. So
 * the answer is confirmed ONLY from coord's served `full_passes_by_runner`,
 * non-empty, with every entry at or above `params.unchanged_min_passes` (the
 * {@link UNCHANGED_MIN_PASSES} this page sends when `params` is absent).
 * Absent, unreadable or empty per-runner counts are never confirmation, and
 * the tenant-wide `full_passes_considered` is never consulted for it.
 *
 * The health strip's green and the list's empty sentence both read this one
 * verdict, so they cannot disagree.
 */
export function unchangedCoverage(
  view: FlowView,
  windowWords: string
): UnchangedCoverage {
  const runners = view.runnerPasses;
  const n = view.unchangedMinPasses;
  // A capped (or possibly capped) read, or one that did not say how many
  // passes it covered, can have missed the stuck session: never confirmation.
  if (view.truncated !== false) {
    return {
      everyRunnerCovered: false,
      sentence:
        view.truncated === true
          ? "coord capped the rows it read — unchanged cannot be confirmed"
          : "coord did not say whether it capped the rows — unchanged cannot be confirmed",
    };
  }
  if (view.passesConsidered === undefined) {
    return {
      everyRunnerCovered: false,
      sentence:
        "how many passes were read is unknown — unchanged cannot be confirmed",
    };
  }
  if (runners === undefined) {
    return {
      everyRunnerCovered: false,
      sentence:
        "per-runner full-pass counts not served — unchanged cannot be confirmed",
    };
  }
  if (runners === null) {
    return {
      everyRunnerCovered: false,
      sentence:
        "per-runner full-pass counts could not be read — unchanged cannot be confirmed",
    };
  }
  if (runners.length === 0) {
    return {
      everyRunnerCovered: false,
      sentence: `no runner reported a pass in ${windowWords} — unchanged cannot be confirmed`,
    };
  }
  const short = runners.filter((r) => r.fullPasses < n).length;
  if (short > 0) {
    const of = `${short} of ${runners.length} ${runners.length === 1 ? "runner" : "runners"}`;
    return {
      everyRunnerCovered: false,
      sentence: `${of} ran fewer than ${n} full passes — their sessions cannot be judged unchanged`,
    };
  }
  return {
    everyRunnerCovered: true,
    sentence: `every runner ran at least ${n} full passes`,
  };
}

// ---------------------------------------------------------------------------
// Narrowing the wire shape
// ---------------------------------------------------------------------------

/** A measured number, coord's explicit `null`, or `undefined` (unknown). */
export type Metric = number | null | undefined;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A finite number stays; an explicit `null` stays; anything else is unknown. */
function metric(v: unknown): Metric {
  if (v === null) return null;
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** A count is never "not measurable", so a `null` count is unknown too. */
function count(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * The latest pass's UNKNOWN share as the page holds it. `share` is a
 * {@link Metric}: coord's explicit `null` (an empty pass) is "no data", while a
 * share that did not arrive or is not a number is unknown — never "no data".
 */
export interface LatestUnknownShare {
  passId: string;
  startedAt: string;
  rows: number;
  unknownRows: number;
  share: Metric;
}

/** A pass's scope and mode as SENT; a value this build does not know is `null`. */
export type PassScope = "full" | "filtered" | null;
export type PassMode = "report" | "act" | null;

/** One pass of coord's `verdict_series`, narrowed. */
export interface VerdictPass {
  passId: string;
  startedAt: string;
  scope: PassScope;
  mode: PassMode;
  histogram: Record<string, number>;
}

/** One runner's full-pass count, narrowed. */
export interface RunnerPasses {
  deviceId: string | null;
  runnerPort: number;
  passes: number;
  fullPasses: number;
  latestFullPassAt: string | null;
}

export interface FlowView {
  since: string | null;
  until: string | null;
  /** `undefined` = coord did not say whether the read was capped. */
  truncated: boolean | undefined;
  passesConsidered: number | undefined;
  fullPassesConsidered: number | undefined;
  /**
   * coord's `full_passes_by_runner`. `undefined` = not served (an older
   * coord); `null` = served but unreadable (not a list, or any entry
   * malformed — a partial list could hide the short runner).
   */
  runnerPasses: RunnerPasses[] | null | undefined;
  /** The threshold coord applied (`params`), else the one this page sent. */
  unchangedMinPasses: number;
  timeToClose: {
    count: number | undefined;
    medianSecs: Metric;
    p90Secs: Metric;
    byTriage: number | undefined;
    byAbsent: number | undefined;
  };
  nudge: {
    nudged: number | undefined;
    progressed: number | undefined;
    finished: number | undefined;
    progressRate: Metric;
    finishRate: Metric;
    unmeasured: number | undefined;
  };
  /** `null` = the list did not arrive (unknown), `[]` = coord found none. */
  unchanged: FlowUnchangedSession[] | null;
  /**
   * The most recent pass's UNKNOWN share. `null` = coord sent an empty list
   * (no pass in the window); `undefined` = the list is absent, or any of
   * its entries could not be read — unknown, not "no pass".
   */
  latestUnknown: LatestUnknownShare | null | undefined;
  /** Oldest first; `null` = the series did not arrive or could not be read. */
  series: VerdictPass[] | null;
}

/**
 * `closed_by` is a map over the kinds that occurred. A kind ABSENT from it is
 * a zero only when the present kinds already add up to `count` — otherwise
 * the map is incomplete and the missing kind is unknown, not none.
 */
function closedBy(
  raw: unknown,
  total: number | undefined
): { byTriage: number | undefined; byAbsent: number | undefined } {
  if (!isObj(raw)) return { byTriage: undefined, byAbsent: undefined };
  const triage = count(raw.triage);
  const absent = count(raw.absent);
  const complete =
    total !== undefined && (triage ?? 0) + (absent ?? 0) === total;
  // Zero-fill only a kind that is ABSENT from the map. A kind that is
  // present but unreadable (`null`, a string) is unknown, never a zero.
  const fill = (key: "triage" | "absent", v: number | undefined) =>
    v ?? (complete && !(key in raw) ? 0 : undefined);
  return {
    byTriage: fill("triage", triage),
    byAbsent: fill("absent", absent),
  };
}

/**
 * Coord's unchanged list, or `null` (UNKNOWN) when it is absent OR any entry
 * cannot be read. Dropping an unreadable entry would shrink the list, and an
 * empty list is what the strip's green and the list's all-clear stand on — a
 * partial list could hide the one stuck session (the same rule
 * {@link runnerPassesOf} applies to the per-runner counts).
 */
function unchangedOf(raw: unknown): FlowUnchangedSession[] | null {
  if (!Array.isArray(raw)) return null;
  const rows: FlowUnchangedSession[] = [];
  for (const r of raw) {
    if (!isObj(r)) return null;
    const key = str(r.key);
    const terminalId = str(r.terminal_id);
    const verdict = str(r.verdict);
    const passes = count(r.consecutive_full_passes);
    if (!key || !terminalId || !verdict || passes === undefined) return null;
    // An absent or unreadable reason list is not "no reason codes".
    if (
      !Array.isArray(r.reason_codes) ||
      !r.reason_codes.every((c) => typeof c === "string")
    ) {
      return null;
    }
    const reasonCodes = r.reason_codes as string[];
    rows.push({
      key,
      claude_session_id: str(r.claude_session_id),
      terminal_id: terminalId,
      session_name: str(r.session_name),
      verdict,
      reason_codes: reasonCodes,
      consecutive_full_passes: passes,
      first_seen_at: str(r.first_seen_at) ?? "",
      last_seen_at: str(r.last_seen_at) ?? "",
    });
  }
  return rows;
}

/** `full` / `filtered` as sent; anything else is unknown, never a default. */
function scopeOf(v: unknown): PassScope {
  return v === "full" || v === "filtered" ? v : null;
}

/** `report` / `act` as sent; anything else is unknown, never a default. */
function modeOf(v: unknown): PassMode {
  return v === "report" || v === "act" ? v : null;
}

/**
 * The per-pass verdict series, or `null` (UNKNOWN) when it is absent OR any
 * pass or any count in it cannot be read. Dropping a pass would shorten the
 * chart without a word, and dropping a count would draw a measured-empty bar
 * where the truth is "could not be read".
 */
function seriesOf(raw: unknown): VerdictPass[] | null {
  if (!Array.isArray(raw)) return null;
  const passes: VerdictPass[] = [];
  for (const p of raw) {
    if (!isObj(p)) return null;
    const passId = str(p.pass_id);
    const startedAt = str(p.started_at);
    if (
      !passId ||
      !startedAt ||
      !Number.isFinite(Date.parse(startedAt)) ||
      !isObj(p.histogram)
    ) {
      return null;
    }
    const histogram: Record<string, number> = {};
    for (const [verdict, n] of Object.entries(p.histogram)) {
      if (typeof n !== "number" || !Number.isFinite(n)) return null;
      histogram[verdict] = n;
    }
    passes.push({
      passId,
      startedAt,
      scope: scopeOf(p.scope),
      mode: modeOf(p.mode),
      histogram,
    });
  }
  return passes.sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)
  );
}

function latestUnknownOf(raw: unknown): LatestUnknownShare | null | undefined {
  if (!Array.isArray(raw)) return undefined;
  // An EMPTY list is coord saying "no pass in this window".
  if (raw.length === 0) return null;
  // Any unreadable entry makes "the latest pass" unknown: its started_at may
  // be the newest, so skipping it could report an older pass as the latest.
  let latest: LatestUnknownShare | undefined;
  for (const s of raw) {
    if (!isObj(s)) return undefined;
    const passId = str(s.pass_id);
    const startedAt = str(s.started_at);
    const rows = count(s.rows);
    const unknownRows = count(s.unknown_rows);
    if (
      !passId ||
      !startedAt ||
      // An unparseable time cannot be ordered, so "latest" is unknown.
      !Number.isFinite(Date.parse(startedAt)) ||
      rows === undefined ||
      unknownRows === undefined
    ) {
      return undefined;
    }
    const entry: LatestUnknownShare = {
      passId,
      startedAt,
      rows,
      unknownRows,
      // Kept a Metric: an absent or non-number share stays UNKNOWN.
      share: metric(s.share),
    };
    if (!latest || Date.parse(startedAt) > Date.parse(latest.startedAt)) {
      latest = entry;
    }
  }
  return latest;
}

function runnerPassesOf(raw: unknown): RunnerPasses[] | null | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return null;
  const runners: RunnerPasses[] = [];
  for (const r of raw) {
    if (!isObj(r)) return null;
    const port = count(r.runner_port);
    const passes = count(r.passes);
    const full = count(r.full_passes);
    if (port === undefined || passes === undefined || full === undefined) {
      return null;
    }
    runners.push({
      deviceId: str(r.device_id),
      runnerPort: port,
      passes,
      fullPasses: full,
      latestFullPassAt: str(r.latest_full_pass_at),
    });
  }
  return runners;
}

/** `params.unchanged_min_passes` when coord served a usable one. */
function appliedMinPasses(raw: unknown): number {
  const n = isObj(raw) ? count(raw.unchanged_min_passes) : undefined;
  return n !== undefined && Number.isInteger(n) && n >= 1
    ? n
    : UNCHANGED_MIN_PASSES;
}

/**
 * Narrow coord's answer. `null` when the body is not a flow answer at all —
 * the page treats that as a failed read (UNKNOWN), never as an empty window.
 */
export function readFlowBody(body: unknown): FlowView | null {
  if (!isObj(body) || body.ok !== true) return null;
  const ttc = isObj(body.time_to_close) ? body.time_to_close : {};
  const nudge = isObj(body.nudge) ? body.nudge : {};
  const window = isObj(body.window) ? body.window : {};
  const ttcCount = count(ttc.count);
  return {
    since: str(window.since),
    until: str(window.until),
    truncated: typeof body.truncated === "boolean" ? body.truncated : undefined,
    passesConsidered: count(body.passes_considered),
    fullPassesConsidered: count(body.full_passes_considered),
    runnerPasses: runnerPassesOf(body.full_passes_by_runner),
    unchangedMinPasses: appliedMinPasses(body.params),
    timeToClose: {
      count: ttcCount,
      medianSecs: metric(ttc.median_secs),
      p90Secs: metric(ttc.p90_secs),
      ...closedBy(ttc.closed_by, ttcCount),
    },
    nudge: {
      nudged: count(nudge.nudged),
      progressed: count(nudge.progressed),
      finished: count(nudge.finished),
      progressRate: metric(nudge.progress_rate),
      finishRate: metric(nudge.finish_rate),
      unmeasured: count(nudge.unmeasured_progress),
    },
    unchanged: unchangedOf(body.unchanged),
    latestUnknown: latestUnknownOf(body.unknown_share),
    series: seriesOf(body.verdict_series),
  };
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** The explicit label for coord's `null` — "not measurable", never a zero. */
export const NO_DATA = "no data";

/** What a formatter renders for a number it cannot format: unknown, `–`. */
export const UNKNOWN_VALUE = "–";

/** `5400` → `1h 30m`. Seconds under a minute stay seconds. */
export function durationWords(secs: number): string {
  if (!Number.isFinite(secs)) return UNKNOWN_VALUE;
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** `0.4` → `40%`, rounded to a whole percent, kept off 0%/100% unless exact. */
export function percentWords(fraction: number): string {
  if (!Number.isFinite(fraction)) return UNKNOWN_VALUE;
  if (fraction <= 0) return "0%";
  if (fraction >= 1) return "100%";
  const pct = Math.round(fraction * 100);
  if (pct === 0) return "<1%";
  if (pct === 100) return ">99%";
  return `${pct}%`;
}

/**
 * A metric as a stat value: the formatted number, `NO_DATA` for coord's
 * `null`, and `null` (which the primitives render as `–`) for unknown.
 */
export function metricValue(
  m: Metric,
  format: (n: number) => string
): string | null {
  if (m === undefined) return null;
  if (m === null) return NO_DATA;
  return format(m);
}

/** The hover for a metric, so `–` and "no data" each say what they mean. */
export function metricTitle(m: Metric, noDataWhy: string): string | undefined {
  if (m === undefined)
    return "unknown — coord's answer did not carry this number";
  if (m === null) return `no data — ${noDataWhy}`;
  return undefined;
}

/** A verdict, as a label. The vocabulary is open, so the word is shown as sent. */
export function verdictWords(verdict: string): string {
  return verdict.toLowerCase().replace(/-/g, " ");
}

// ---------------------------------------------------------------------------
// Read failure — coord's typed refusal, recovered from the thrown message
// ---------------------------------------------------------------------------

export interface FlowReadFailure {
  /** HTTP status, or `null` when the read never got an answer. */
  status: number | null;
  /** coord's `error` code, when its body carried one. */
  code: string | null;
  /** coord's `detail` or `field`, when it sent one. */
  detail: string | null;
  /** The read landed but its body was not a flow answer. */
  malformed?: boolean;
}

export const MALFORMED_FAILURE: FlowReadFailure = {
  status: 200,
  code: null,
  detail: null,
  malformed: true,
};

/** Parse `httpClient`'s rejection through the console's one status reader. */
export function parseFlowReadFailure(err: unknown): FlowReadFailure {
  const status = httpStatusOf(err);
  if (status === null) return { status: null, code: null, detail: null };
  let code: string | null = null;
  let detail: string | null = null;
  try {
    const parsed: unknown = JSON.parse(httpBodyOf(err) ?? "");
    if (isObj(parsed)) {
      code = str(parsed.error);
      detail = str(parsed.detail) ?? str(parsed.field);
    }
  } catch {
    // A non-JSON error body (a proxy page): the status is all we know.
  }
  return { status, code, detail };
}

/** A failure, in the operator's words. Never a code on its own. */
export function failureSentence(f: FlowReadFailure): string {
  if (f.malformed) return "coord answered in a shape this page does not know";
  if (f.code === "schema_migration_pending") {
    return "coord's pass ledger is not provisioned in this database yet (a migration is pending)";
  }
  if (f.code === "db_unavailable")
    return "coord's database did not answer the flow read";
  if (f.status === 422 || f.status === 400) {
    return `coord refused the query${f.detail ? ` (${f.detail})` : ""}`;
  }
  return f.status === null
    ? "coord could not be reached"
    : `coord answered HTTP ${f.status}`;
}

// ---------------------------------------------------------------------------
// The health strip (R1) — derived from the one read on the page
// ---------------------------------------------------------------------------

export interface FlowHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string;
  badges: HealthBadge[];
}

function dash(n: number | undefined): string {
  return n === undefined ? "–" : String(n);
}

function flowBadges(view: FlowView | null): HealthBadge[] {
  return [
    {
      key: "passes",
      label: `passes ${dash(view?.passesConsidered)}`,
      title: "triage passes recorded in this window",
      "data-testid": "overlord-flow-badge-passes",
    },
    {
      key: "full",
      label: `full ${dash(view?.fullPassesConsidered)}`,
      title: "passes that screened every terminal — only these count absence",
      "data-testid": "overlord-flow-badge-full",
    },
    {
      key: "unchanged",
      label: `unchanged ${view?.unchanged ? view.unchanged.length : "–"}`,
      tone:
        view?.unchanged && view.unchanged.length > 0 ? "waiting" : "default",
      title:
        "sessions whose verdict and reasons did not move across consecutive full passes",
      "data-testid": "overlord-flow-badge-unchanged",
    },
  ];
}

/**
 * The strip's verdict.
 *
 * - **UNKNOWN first** (`readIsUnknown`): a failed read before any answer.
 * - **Reading** while nothing has answered.
 * - **STALE**: a refresh failed after a good read — the numbers stay, the dot
 *   is never green, and the detail says so (style guide R6).
 * - **Amber** for an empty window (nothing was measured — not an all-clear),
 *   a truncated read, or any session stuck unchanged; the overlord, not the
 *   operator, is what clears those, so none of them is red (R3).
 * - **Green** only for a measured window with no unchanged session.
 */
export function deriveFlowHealth(input: {
  view: FlowView | null;
  loaded: boolean;
  failed: boolean;
  failure: FlowReadFailure | null;
  windowId: FlowWindowId;
}): FlowHealth {
  const { view, loaded, failed, failure, windowId } = input;
  const words = flowWindow(windowId).words;

  if (readIsUnknown(loaded, failed)) {
    return {
      level: "amber",
      headline: "Session flow is unknown",
      detail: failure
        ? `${failureSentence(failure)} — the numbers are a dash, not a zero`
        : UNKNOWN_COUNTS_DETAIL,
      badges: flowBadges(null),
    };
  }
  if (!loaded || !view) {
    return {
      level: "amber",
      headline: "Reading the pass ledger…",
      detail:
        "nothing has answered yet, so the numbers are a dash rather than a zero",
      badges: flowBadges(null),
    };
  }

  const windowSentence = `over ${words}`;
  const unchanged = view.unchanged?.length;

  if (failed) {
    return {
      level: "amber",
      headline: "Session flow at the last good read",
      detail: staleDetail(windowSentence),
      badges: flowBadges(view),
    };
  }
  if (view.passesConsidered === 0) {
    return {
      level: "amber",
      headline: `No triage pass recorded in ${words}`,
      detail:
        "nothing was measured, so no flow number can be stated — this is not an all-clear",
      badges: flowBadges(view),
    };
  }
  if (view.passesConsidered === undefined || view.unchanged === null) {
    return {
      level: "amber",
      headline: "Session flow is partly unknown",
      detail: "coord's answer did not carry every count this strip needs",
      badges: flowBadges(view),
    };
  }
  if (view.truncated !== false) {
    return {
      level: "amber",
      headline:
        view.truncated === true
          ? "Session flow over a truncated read"
          : "Whether this read was capped is unknown",
      detail:
        view.truncated === true
          ? `coord capped the rows it read ${windowSentence}, so every number below is over that subset`
          : "coord did not say whether it capped the rows, so every number below may be over a subset",
      badges: flowBadges(view),
    };
  }
  if (unchanged && unchanged > 0) {
    return {
      level: "amber",
      headline: `${unchanged} ${unchanged === 1 ? "session has" : "sessions have"} not moved across consecutive full passes`,
      detail: `same verdict and reasons pass after pass, ${windowSentence}`,
      badges: flowBadges(view),
    };
  }
  const coverage = unchangedCoverage(view, words);
  if (!coverage.everyRunnerCovered) {
    // An empty list is an all-clear only when every runner ran enough full
    // passes to have produced an unchanged row — never on a tenant total.
    return {
      level: "amber",
      headline: "Unchanged sessions cannot be confirmed",
      detail: coverage.sentence,
      badges: flowBadges(view),
    };
  }
  return {
    level: "green",
    headline: "No session is stuck unchanged",
    detail: `${view.passesConsidered} ${view.passesConsidered === 1 ? "pass" : "passes"} ${windowSentence}`,
    badges: flowBadges(view),
  };
}

// ---------------------------------------------------------------------------
// The verdict histogram series
// ---------------------------------------------------------------------------

/**
 * The verdicts that get their own categorical slot, in slot order. The
 * verdict vocabulary is open (contract §2), so every other verdict folds into
 * "other" — its own words stay in the tooltip and the table. A slot follows
 * the VERDICT, never its rank, so a window that drops one never repaints the
 * rest.
 */
export const CHARTED_VERDICTS = ["BUSY", "STOPPED", "FINISHED"] as const;
export const OTHER_SERIES = "other";
export const UNKNOWN_SERIES = "UNKNOWN";

/** The stack, bottom segment first. */
export const STACK_ORDER: readonly string[] = [
  ...CHARTED_VERDICTS,
  OTHER_SERIES,
  UNKNOWN_SERIES,
];

export interface HistogramPoint {
  passId: string;
  startedAt: string;
  scope: PassScope;
  mode: PassMode;
  total: number;
  /** One key per charted series, plus `other` and `UNKNOWN`. */
  counts: Record<string, number>;
  /** The topmost NON-ZERO segment of this bar (the one whose top is rounded). */
  topSeries: string | null;
  /** The full histogram, sorted by count — for the tooltip and the table. */
  breakdown: Array<[string, number]>;
}

/** Fold each pass's histogram into the charted series. Oldest first. */
export function histogramPoints(series: VerdictPass[]): HistogramPoint[] {
  const charted = new Set<string>(CHARTED_VERDICTS);
  return series.map((p) => {
    const counts: Record<string, number> = {
      [OTHER_SERIES]: 0,
      [UNKNOWN_SERIES]: 0,
    };
    for (const v of CHARTED_VERDICTS) counts[v] = 0;
    let total = 0;
    for (const [verdict, n] of Object.entries(p.histogram)) {
      total += n;
      const bucket =
        charted.has(verdict) || verdict === UNKNOWN_SERIES
          ? verdict
          : OTHER_SERIES;
      counts[bucket] = (counts[bucket] ?? 0) + n;
    }
    const breakdown = Object.entries(p.histogram).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    const topSeries =
      [...STACK_ORDER].reverse().find((k) => (counts[k] ?? 0) > 0) ?? null;
    return {
      passId: p.passId,
      startedAt: p.startedAt,
      scope: p.scope,
      mode: p.mode,
      total,
      counts,
      topSeries,
      breakdown,
    };
  });
}

/** How many passes in a series were filtered, and how many sent an unknown scope. */
export function scopeCounts(points: HistogramPoint[]): {
  filtered: number;
  unknown: number;
} {
  return {
    filtered: points.filter((p) => p.scope === "filtered").length,
    unknown: points.filter((p) => p.scope === null).length,
  };
}

/** A pass's scope or mode in words; one this build does not know is "unknown". */
export function passWord(value: PassScope | PassMode): string {
  return value ?? "unknown";
}

/** The transparent gap between stacked segments, in px. */
export const SEGMENT_GAP_PX = 2;

/**
 * Where to draw one stacked segment. A segment below the bar's top gives up
 * up to {@link SEGMENT_GAP_PX} of its own top edge as a transparent gap, but
 * never shrinks below 1px — a thin segment (one terminal on a tall scale)
 * stays visible rather than vanishing into the gap. A segment already under
 * 1px is drawn as it is, never inflated. The top segment is never inset, so
 * the bar's total height stays true.
 */
export function insetSegment(
  y: number,
  height: number,
  isTop: boolean
): { y: number; height: number } {
  if (isTop || !(height > 1)) return { y, height: Math.max(0, height) };
  const drawn = Math.max(1, height - SEGMENT_GAP_PX);
  return { y: y + (height - drawn), height: drawn };
}

/** Where the per-session console view is, when a Claude session id was proven. */
export function sessionHref(row: FlowUnchangedSession): string | null {
  return row.claude_session_id
    ? `/sessions/${encodeURIComponent(row.claude_session_id)}`
    : null;
}
