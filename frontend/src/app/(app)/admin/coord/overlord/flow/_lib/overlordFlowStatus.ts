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
import type {
  FlowUnchangedSession,
  FlowUnknownShare,
  FlowVerdictPass,
} from "@/lib/api/operations/overlordFlow";

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

/** The query string asked of the proxy for a window. */
export function flowQuery(id: FlowWindowId): string {
  const qs = new URLSearchParams();
  qs.set("window_hours", String(flowWindow(id).hours));
  return qs.toString();
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

export interface FlowView {
  since: string | null;
  until: string | null;
  /** `undefined` = coord did not say whether the read was capped. */
  truncated: boolean | undefined;
  passesConsidered: number | undefined;
  fullPassesConsidered: number | undefined;
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
  /** The most recent pass's UNKNOWN share; `null` = no pass, `undefined` = list absent. */
  latestUnknown: FlowUnknownShare | null | undefined;
  /** Oldest first; `null` = the series did not arrive. */
  series: FlowVerdictPass[] | null;
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
  return {
    byTriage: triage ?? (complete ? 0 : undefined),
    byAbsent: absent ?? (complete ? 0 : undefined),
  };
}

function unchangedOf(raw: unknown): FlowUnchangedSession[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((r): FlowUnchangedSession[] => {
    if (!isObj(r)) return [];
    const key = str(r.key);
    const terminalId = str(r.terminal_id);
    const verdict = str(r.verdict);
    const passes = count(r.consecutive_full_passes);
    if (!key || !terminalId || !verdict || passes === undefined) return [];
    return [
      {
        key,
        claude_session_id: str(r.claude_session_id),
        terminal_id: terminalId,
        session_name: str(r.session_name),
        verdict,
        reason_codes: Array.isArray(r.reason_codes)
          ? r.reason_codes.filter((c): c is string => typeof c === "string")
          : [],
        consecutive_full_passes: passes,
        first_seen_at: str(r.first_seen_at) ?? "",
        last_seen_at: str(r.last_seen_at) ?? "",
      },
    ];
  });
}

function seriesOf(raw: unknown): FlowVerdictPass[] | null {
  if (!Array.isArray(raw)) return null;
  const passes = raw.flatMap((p): FlowVerdictPass[] => {
    if (!isObj(p)) return [];
    const passId = str(p.pass_id);
    const startedAt = str(p.started_at);
    if (!passId || !startedAt || !isObj(p.histogram)) return [];
    const histogram: Record<string, number> = {};
    for (const [verdict, n] of Object.entries(p.histogram)) {
      if (typeof n === "number" && Number.isFinite(n)) histogram[verdict] = n;
    }
    return [
      {
        pass_id: passId,
        started_at: startedAt,
        scope: p.scope === "filtered" ? "filtered" : "full",
        mode: p.mode === "act" ? "act" : "report",
        histogram,
      },
    ];
  });
  return passes.sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at)
  );
}

function latestUnknownOf(raw: unknown): FlowUnknownShare | null | undefined {
  if (!Array.isArray(raw)) return undefined;
  let latest: FlowUnknownShare | null = null;
  for (const s of raw) {
    if (!isObj(s)) continue;
    const passId = str(s.pass_id);
    const startedAt = str(s.started_at);
    const rows = count(s.rows);
    const unknownRows = count(s.unknown_rows);
    if (
      !passId ||
      !startedAt ||
      rows === undefined ||
      unknownRows === undefined
    ) {
      continue;
    }
    const share = metric(s.share);
    const entry: FlowUnknownShare = {
      pass_id: passId,
      started_at: startedAt,
      rows,
      unknown_rows: unknownRows,
      share: share === undefined ? null : share,
    };
    if (!latest || Date.parse(startedAt) > Date.parse(latest.started_at)) {
      latest = entry;
    }
  }
  return latest;
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

/** `5400` → `1h 30m`. Seconds under a minute stay seconds. */
export function durationWords(secs: number): string {
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

export interface HistogramPoint {
  passId: string;
  startedAt: string;
  scope: "full" | "filtered";
  mode: "report" | "act";
  total: number;
  /** One key per charted series, plus `other` and `UNKNOWN`. */
  counts: Record<string, number>;
  /** The full histogram, sorted by count — for the tooltip and the table. */
  breakdown: Array<[string, number]>;
}

/** Fold each pass's histogram into the charted series. Oldest first. */
export function histogramPoints(series: FlowVerdictPass[]): HistogramPoint[] {
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
    return {
      passId: p.pass_id,
      startedAt: p.started_at,
      scope: p.scope,
      mode: p.mode,
      total,
      counts,
      breakdown,
    };
  });
}

/** Where the per-session console view is, when a Claude session id was proven. */
export function sessionHref(row: FlowUnchangedSession): string | null {
  return row.claude_session_id
    ? `/sessions/${encodeURIComponent(row.claude_session_id)}`
    : null;
}
