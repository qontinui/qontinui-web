/**
 * Pure derivations for the pass drill-down on `/admin/coord/overlord/flow`,
 * the reader of coord's `GET /coord/overlord/passes[/{pass_id}]`.
 *
 * Same rule as `overlordFlowStatus.ts`: an entry that cannot be read makes the
 * whole list UNKNOWN (`null`). A shorter list would hide the very pass or
 * terminal an operator opened this panel to find.
 */

import type { PassMode, PassScope } from "./overlordFlowStatus";
import {
  count,
  flowWindow,
  isObj,
  modeOf,
  scopeOf,
  str,
  time,
  type FlowWindowId,
} from "./overlordFlowStatus";

/** coord's `MAX_LIST_LIMIT`: asking for more is clamped, not refused. */
export const PASS_LIST_LIMIT = 200;

/** The query for a window's passes. `nowMs` is the caller's, so this stays pure. */
export function passesQuery(id: FlowWindowId, nowMs: number): string {
  const since = new Date(nowMs - flowWindow(id).hours * 3_600_000);
  const qs = new URLSearchParams();
  qs.set("since", since.toISOString());
  qs.set("limit", String(PASS_LIST_LIMIT));
  return qs.toString();
}

/** Coord's explicit `null` stays; anything else unreadable is `undefined`. */
function nullable(v: unknown): string | null | undefined {
  return v === null ? null : (str(v) ?? undefined);
}

function strings(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === "string")
    ? (v as string[])
    : null;
}

export interface PassSummary {
  passId: string;
  deviceId: string | null;
  runnerPort: number | undefined;
  /** `null` = coord recorded none; `undefined` = it did not arrive. */
  runnerBuild: string | null | undefined;
  scope: PassScope;
  mode: PassMode;
  /** `null` = the list did not arrive: unknown, never "none skipped". */
  skippedSteps: string[] | null;
  startedAt: string;
  /** `null` = coord recorded none; `undefined` = it did not arrive. */
  endedAt: string | null | undefined;
  /** `null` = coord recorded none; `undefined` = it did not arrive. */
  exitCode: number | null | undefined;
  /** Verdict → count, largest first; `null` = could not be read. */
  histogram: [string, number][] | null;
  /** `triage-sessions.py` as run; `null` = none recorded; `undefined` = unknown. */
  triageVersion: string | null | undefined;
  rowCount: number;
}

export interface PassList {
  passes: PassSummary[];
  /** How many passes match, when coord said. */
  total: number | undefined;
  /** `undefined` = coord did not say whether it cut the list. */
  truncated: boolean | undefined;
}

export interface PassRow {
  terminalId: string;
  claudeSessionId: string | null;
  sessionName: string | null;
  /** `null` = coord recorded none; `undefined` = it did not arrive. */
  account: string | null | undefined;
  verdict: string;
  /**
   * Reason codes, else the screen's prose. Empty = coord recorded neither;
   * `null` = the prose was there and could not be read.
   */
  reasons: string[] | null;
  action: string;
  actionOutcome: string | null;
}

export interface PassDetail extends PassSummary {
  /** UNKNOWN first, then by verdict and name, so the unread rows lead. */
  rows: PassRow[];
}

function histogramOf(raw: unknown): [string, number][] | null {
  if (!isObj(raw)) return null;
  const entries: [string, number][] = [];
  for (const [verdict, n] of Object.entries(raw)) {
    const v = count(n);
    if (v === undefined) return null;
    entries.push([verdict, v]);
  }
  return entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function passOf(p: unknown): PassSummary | null {
  if (!isObj(p)) return null;
  const passId = str(p.pass_id);
  const startedAt = time(p.started_at);
  const rowCount = count(p.row_count);
  if (!passId || !startedAt || rowCount === undefined) return null;
  // `p.ended_at` present but unparseable would word a time it cannot state.
  if (p.ended_at !== null && p.ended_at !== undefined && !time(p.ended_at)) {
    return null;
  }
  return {
    passId,
    deviceId: str(p.device_id),
    runnerPort: count(p.runner_port),
    runnerBuild: nullable(p.runner_build),
    scope: scopeOf(p.scope),
    mode: modeOf(p.mode),
    skippedSteps: strings(p.skipped_steps),
    startedAt,
    endedAt: nullable(p.ended_at),
    exitCode: p.exit_code === null ? null : count(p.exit_code),
    histogram: histogramOf(p.verdict_histogram),
    triageVersion: isObj(p.overlord_versions)
      ? (str(p.overlord_versions["triage-sessions.py"]) ?? null)
      : undefined,
    rowCount,
  };
}

/** Narrow coord's pass list. `null` = not a list answer, or an unreadable pass. */
export function readPassList(body: unknown): PassList | null {
  if (!isObj(body) || body.ok !== true || !Array.isArray(body.passes)) {
    return null;
  }
  const passes: PassSummary[] = [];
  for (const raw of body.passes) {
    const p = passOf(raw);
    if (!p) return null;
    passes.push(p);
  }
  return {
    passes,
    total: count(body.total_matching),
    truncated: typeof body.truncated === "boolean" ? body.truncated : undefined,
  };
}

function rowOf(r: unknown): PassRow | null {
  if (!isObj(r)) return null;
  const terminalId = str(r.terminal_id);
  const verdict = str(r.verdict);
  const action = str(r.action);
  const codes = strings(r.reason_codes);
  if (!terminalId || !verdict || !action || !codes) return null;
  // `detail` is free-form: absent `reasons` is none recorded, a malformed one
  // is unknown, and a code always wins.
  const proseRaw = isObj(r.detail) ? r.detail.reasons : null;
  const prose = proseRaw === undefined ? [] : strings(proseRaw);
  return {
    terminalId,
    claudeSessionId: str(r.claude_session_id),
    sessionName: str(r.session_name),
    account: nullable(r.account),
    verdict,
    reasons: codes.length > 0 ? codes : prose,
    action,
    actionOutcome: str(r.action_outcome),
  };
}

function rowOrder(a: PassRow, b: PassRow): number {
  const unknownFirst =
    Number(b.verdict === "UNKNOWN") - Number(a.verdict === "UNKNOWN");
  return (
    unknownFirst ||
    a.verdict.localeCompare(b.verdict) ||
    (a.sessionName ?? a.terminalId).localeCompare(b.sessionName ?? b.terminalId)
  );
}

/** Narrow coord's one-pass answer. `null` = unreadable pass or any unreadable row. */
export function readPassDetail(body: unknown): PassDetail | null {
  if (!isObj(body) || body.ok !== true || !isObj(body.pass)) return null;
  const pass = passOf(body.pass);
  if (!pass || !Array.isArray(body.pass.rows)) return null;
  const rows: PassRow[] = [];
  for (const raw of body.pass.rows) {
    const r = rowOf(raw);
    if (!r) return null;
    rows.push(r);
  }
  return { ...pass, rows: rows.sort(rowOrder) };
}

/** How many verdicts the row's reason names before it says how many more. */
const REASON_VERDICTS = 3;

/**
 * The row's one-line reason: exit code and the largest verdict counts, always
 * with UNKNOWN (the verdict this panel leads with), and saying what it left out.
 */
export function passReason(p: PassSummary): string {
  const exit =
    p.exitCode === undefined
      ? "exit unknown"
      : p.exitCode === null
        ? "no exit code"
        : `exit ${p.exitCode}`;
  if (p.histogram === null) return `${exit} · verdicts unknown`;
  if (p.histogram.length === 0) {
    // Coord defaults an omitted histogram to `{}`, whatever rows the pass has.
    return p.rowCount === 0
      ? `${exit} · no rows`
      : `${exit} · no verdict counts recorded`;
  }
  const shown = p.histogram.slice(0, REASON_VERDICTS);
  const unknown = p.histogram.find(([v]) => v === "UNKNOWN");
  if (unknown && !shown.includes(unknown)) shown.push(unknown);
  const more = p.histogram.length - shown.length;
  const words = shown.map(([v, n]) => `${v} ${n}`).join(", ");
  return `${exit} · ${words}${more > 0 ? `, +${more} more` : ""}`;
}

/** The action as coord recorded it, in words a table cell can stand on. */
export function actionWords(row: PassRow): string {
  if (row.action === "none") return "no action";
  return row.actionOutcome
    ? `${row.action} (${row.actionOutcome})`
    : row.action;
}

/** Where a row's console session page is, when a Claude session id was proven. */
export function passRowHref(row: PassRow): string | null {
  return row.claudeSessionId
    ? `/sessions/${encodeURIComponent(row.claudeSessionId)}`
    : null;
}

/** A row's reasons, keeping "none recorded" and "could not be read" apart. */
export function reasonsWords(row: PassRow): string {
  if (row.reasons === null) return "unknown — could not be read";
  return row.reasons.length > 0 ? row.reasons.join("; ") : "none recorded";
}

/** Coord's `null` is a recorded absence; only a missing field is unknown. */
export function accountWords(row: PassRow): string {
  if (row.account === undefined) return "–";
  return row.account ?? "not recorded";
}

/** Says so when coord served fewer or more rows than the pass recorded. */
export function rowCountMismatch(p: PassDetail): string | null {
  return p.rows.length === p.rowCount
    ? null
    : `This pass recorded ${p.rowCount} ${p.rowCount === 1 ? "row" : "rows"} but coord served ${p.rows.length}, so this table is not the whole pass.`;
}
