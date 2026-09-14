/**
 * runnerStatus — pure derivation for `/admin/coord/runners`.
 *
 * Plan `2026-09-13-drained-runner-never-reaches-idle` Phase 8. The page is a
 * DEVICE MAINTENANCE surface (D10): drain one runner, watch whether it has
 * become safe to restart, and wind down the sessions that keep it from being
 * safe. Every word an operator reads on it is derived here, in a module with
 * no DOM and no fetch, so each rule below is testable on its own (R8).
 *
 * ## The two reads it joins
 *
 * 1. **Readiness** rides the device's newest resource sample
 *    (`GET /operations/fleet/resource-samples?device_id=&history=false`,
 *    plan D8). Coord computes `readiness_state` (`fresh | stale | absent`) and
 *    `readiness_age_secs` server-side, so no browser subtracts its own clock
 *    from a server timestamp. **Only `fresh` is a verdict.** A stale sample is
 *    the LAST verdict and a runner that stopped reporting may be doing
 *    anything by now; an absent one is a runner build that predates the
 *    surface. Both render UNKNOWN, and so does every count on them.
 * 2. **The session census** is coord's `GET /coord/sessions/fleet` (camelCase
 *    rows). It names the sessions; the readiness sample's bounded
 *    `wind_down_sessions` array says, per `claude_code_session_id`, whether
 *    each one blocks a restart, is idle, and is eligible to close.
 *
 * ## Why an absent value is never a zero here
 *
 * `readiness_blocking: 0` says "nothing blocks a restart". `null` says "the
 * runner could not count". A page that renders the second as the first tells
 * an operator to rebuild a machine with live work on it — the exact incident
 * this plan exists for (`[policy: silent-empty-is-unknown]`,
 * `[policy: unknown-must-not-render-as-a-default]`).
 */

import type { Attention } from "@/components/console/attention";
import type { HealthStripLevel } from "@/components/console/HealthStrip";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  type RowStatus,
  type StatusPalette,
} from "@/components/console/statusRow";
import type { DeviceDrainState } from "./fleetDrain";

/** Coord's staleness bound (contract C1: stale = age > 180 s). */
export const READINESS_STALE_SECS = 180;

/** The literal every unknown value renders as on this page. */
export const UNKNOWN_LABEL = "UNKNOWN";

function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function optionalCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/** One element of the sample's `wind_down_sessions` array (contract C1). */
export interface WindDownSession {
  claude_code_session_id: string;
  blocks_restart: boolean | null;
  /** `idle | busy | unknown`; kept a string so a newer runner still renders. */
  idle_state: string | null;
  /** `eligible | not_yet | ineligible | unknown`. */
  eligibility: string | null;
  close_eligible_at: string | null;
  exit_stuck: boolean | null;
  spawn_origin: string | null;
}

/** The readiness half of a resource-sample row, as this page reads it. */
export interface ReadinessSample {
  safe: boolean | null;
  reason: string | null;
  blocking: number | null;
  finished: number | null;
  closeEligible: number | null;
  exitStuck: number | null;
  /** `null` when the runner reported no array at all (UNKNOWN, not empty). */
  sessions: WindDownSession[] | null;
  /** Elements coord served that carried no usable session id. Dropped, then said. */
  unreadableSessions: number;
  /** Coord capped the array (128) — the list is not the whole census. */
  truncated: boolean;
  ageSecs: number;
  sampledAt: string | null;
}

export type ReadinessRead =
  /** Not asked yet, or the device just changed. */
  | { kind: "loading" }
  /** The read itself failed. Nothing is known about the runner. */
  | { kind: "read_failed"; reason: string }
  /** Coord answered, but serves no readiness on this deployment. */
  | { kind: "not_served"; reason: string }
  /** Coord holds no resource sample at all for this device. */
  | { kind: "no_sample" }
  /** The newest sample carries no readiness: the runner build predates it. */
  | { kind: "absent"; ageSecs: number | null }
  /** The newest readiness is older than the bound — the LAST verdict, withheld. */
  | { kind: "stale"; ageSecs: number | null }
  | { kind: "fresh"; sample: ReadinessSample };

function parseWindDownSessions(value: unknown): {
  sessions: WindDownSession[] | null;
  unreadable: number;
} {
  if (!Array.isArray(value)) return { sessions: null, unreadable: 0 };
  const sessions: WindDownSession[] = [];
  let unreadable = 0;
  for (const raw of value) {
    const id = isRecord(raw) ? optionalString(raw.claude_code_session_id) : null;
    if (!isRecord(raw) || id === null) {
      unreadable += 1;
      continue;
    }
    sessions.push({
      claude_code_session_id: id,
      blocks_restart:
        typeof raw.blocks_restart === "boolean" ? raw.blocks_restart : null,
      idle_state: optionalString(raw.idle_state),
      eligibility: optionalString(raw.eligibility),
      close_eligible_at: optionalString(raw.close_eligible_at),
      exit_stuck: typeof raw.exit_stuck === "boolean" ? raw.exit_stuck : null,
      spawn_origin: optionalString(raw.spawn_origin),
    });
  }
  return { sessions, unreadable };
}

const READINESS_FIELDS = [
  "readiness_safe",
  "readiness_reason",
  "readiness_blocking",
  "readiness_finished",
  "wind_down_candidates",
  "wind_down_exit_stuck",
  "wind_down_sessions",
] as const;

/** Whether a sample row carries any readiness value at all. */
function carriesReadiness(row: Record<string, unknown>): boolean {
  return READINESS_FIELDS.some(
    (field) => row[field] !== undefined && row[field] !== null
  );
}

function laneRank(row: Record<string, unknown>): number {
  if (row.lane === "host") return 2;
  // A coord that serves no lane field is not a statement about the lane.
  if (row.lane === undefined || row.lane === null) return 1;
  return 0;
}

/**
 * Best readiness row first: carries readiness, then host lane, then the newest
 * `sampled_at`, then the smallest server-computed age.
 */
function compareReadinessRows(
  a: Record<string, unknown>,
  b: Record<string, unknown>
): number {
  const carried = Number(carriesReadiness(b)) - Number(carriesReadiness(a));
  if (carried !== 0) return carried;
  const lane = laneRank(b) - laneRank(a);
  if (lane !== 0) return lane;
  const at = (r: Record<string, unknown>) =>
    typeof r.sampled_at === "string" ? Date.parse(r.sampled_at) || 0 : 0;
  const newer = at(b) - at(a);
  if (newer !== 0) return newer;
  return (
    (optionalCount(a.readiness_age_secs) ?? Infinity) -
    (optionalCount(b.readiness_age_secs) ?? Infinity)
  );
}

/**
 * The device's readiness from a `/fleet/resource-samples` body.
 *
 * Coord returns the newest sample per (device, lane, lane_instance) anchor and
 * marks only the device's NEWEST one with `readiness_state`. A body whose rows
 * carry no such key is a coord that predates the fields — `not_served`, which
 * is a different fact from a runner that predates them (`absent`).
 */
export function resolveReadiness(
  payload: unknown,
  deviceId: string
): ReadinessRead {
  if (!isRecord(payload) || !Array.isArray(payload.latest)) {
    return {
      kind: "not_served",
      reason:
        "The resource-sample read returned no `latest` array, so there is no " +
        "sample to read readiness from.",
    };
  }
  if (payload.schema_pending === true) {
    return {
      kind: "not_served",
      reason:
        "Coord reports its sample table is not migrated yet " +
        "(`schema_pending`), so it served no samples at all.",
    };
  }
  const wanted = normalizeId(deviceId);
  const rows = payload.latest.filter(
    (r): r is Record<string, unknown> =>
      isRecord(r) &&
      typeof r.device_id === "string" &&
      normalizeId(r.device_id) === wanted
  );
  if (rows.length === 0) return { kind: "no_sample" };

  const marked = rows.filter(
    (r) => r.readiness_state !== undefined && r.readiness_state !== null
  );
  if (marked.length === 0) {
    return {
      kind: "not_served",
      reason:
        "Coord's samples for this device carry no `readiness_state`, so this " +
        "coord deployment predates the readiness fields.",
    };
  }
  // Only the HOST lane carries readiness (contract C1), and the `wsl` lane is
  // POSTed in the same batch with the same `sampled_at`. So the choice is never
  // "the newest row": it is the best-ranked marked row, where a row carrying
  // readiness outranks one that carries none, the host lane outranks any
  // other, and only then does recency decide. A `wsl` row with no readiness
  // can therefore never win a tie.
  const hostMarked = marked.filter((r) => r.lane === "host");
  const pool = hostMarked.length > 0 ? hostMarked : marked;
  // `pool` is non-empty (`marked` was checked above), so reduce needs no seed.
  const row = pool.reduce((best, r) =>
    compareReadinessRows(r, best) < 0 ? r : best
  );
  if (
    typeof row.lane === "string" &&
    row.lane !== "host" &&
    !carriesReadiness(row) &&
    rows.some((r) => r.lane === "host")
  ) {
    return {
      kind: "not_served",
      reason:
        `Coord marked this device's \`${row.lane}\` lane rather than its host ` +
        "lane, and only the host lane carries readiness, so no verdict is read " +
        "from it.",
    };
  }
  const ageSecs = optionalCount(row.readiness_age_secs);
  const state = row.readiness_state;

  if (state === "absent") return { kind: "absent", ageSecs };
  if (state === "stale") return { kind: "stale", ageSecs };
  if (state !== "fresh") {
    return {
      kind: "not_served",
      reason: `Coord reported a readiness state this build does not know (${String(
        state
      )}), so it is not read as a verdict.`,
    };
  }
  // A `fresh` mark with no age, or an age past the bound, is not trusted as
  // fresh: the bound is the whole meaning of the word.
  if (ageSecs === null || ageSecs > READINESS_STALE_SECS) {
    return { kind: "stale", ageSecs };
  }
  const { sessions, unreadable } = parseWindDownSessions(row.wind_down_sessions);
  return {
    kind: "fresh",
    sample: {
      safe: typeof row.readiness_safe === "boolean" ? row.readiness_safe : null,
      reason: optionalString(row.readiness_reason),
      blocking: optionalCount(row.readiness_blocking),
      finished: optionalCount(row.readiness_finished),
      closeEligible: optionalCount(row.wind_down_candidates),
      exitStuck: optionalCount(row.wind_down_exit_stuck),
      sessions,
      unreadableSessions: unreadable,
      truncated: row.wind_down_sessions_truncated === true,
      ageSecs,
      sampledAt: optionalString(row.sampled_at),
    },
  };
}

/** A compact age: `42 s`, `3 min`, `2 h`. */
export function formatAgeSecs(secs: number): string {
  if (secs < 90) return `${Math.round(secs)} s`;
  if (secs < 90 * 60) return `${Math.round(secs / 60)} min`;
  return `${Math.round(secs / 3600)} h`;
}

export interface ReadinessHealth {
  level: HealthStripLevel;
  headline: string;
  detail: string;
}

/**
 * The strip's verdict.
 *
 * Green only for an explicit, fresh `readiness_safe: true`. An unsafe verdict
 * is red when a human must act (a session stuck on `/exit`, or an idle one
 * that will not close until someone declares it finished) and amber when the
 * blockers are working sessions that will clear on their own (R3). Every
 * UNKNOWN is amber — never green, which would assert "nothing is wrong here".
 *
 * `authorRowCount` is `null` while the session census is loading or failed:
 * then the rows that would make the strip red are unknown, and the detail
 * says so rather than letting amber stand as a quiet "nothing needs a human".
 */
export function deriveReadinessHealth(
  read: ReadinessRead,
  authorRowCount: number | null
): ReadinessHealth {
  const unknown = (detail: string): ReadinessHealth => ({
    level: "amber",
    headline: `Readiness ${UNKNOWN_LABEL}`,
    detail,
  });
  switch (read.kind) {
    case "loading":
      return unknown("reading this runner's readiness…");
    case "read_failed":
      return unknown(read.reason);
    case "not_served":
      return unknown(read.reason);
    case "no_sample":
      return unknown(
        "coord holds no resource sample for this device, so the runner has " +
          "never reported readiness here"
      );
    case "absent":
      return unknown(
        "readiness never reported — runner build predates this surface"
      );
    case "stale":
      return unknown(
        read.ageSecs === null
          ? "the last readiness report carries no age, so it is not shown as a verdict"
          : `the last readiness report is ${formatAgeSecs(read.ageSecs)} old ` +
              `(older than ${READINESS_STALE_SECS / 60} min), so its verdict is not shown`
      );
    case "fresh": {
      const { sample } = read;
      const age = `reported ${formatAgeSecs(sample.ageSecs)} ago`;
      if (sample.safe === true) {
        const blocking = sample.blocking ?? 0;
        const stuck = sample.exitStuck ?? 0;
        if (blocking > 0 || stuck > 0) {
          // The verdict and its own counts disagree. Green would pick the
          // verdict and hide the counts; neither half is trusted.
          const parts = [
            blocking > 0 ? `${blocking} blocking` : null,
            stuck > 0 ? `${stuck} exit-stuck` : null,
          ].filter((p): p is string => p !== null);
          return {
            level: "amber",
            headline: "Readiness contradicts itself",
            detail: `runner says safe but reports ${parts.join(" and ")} · ${age}`,
          };
        }
        return { level: "green", headline: "Safe to restart", detail: age };
      }
      if (sample.safe === null) {
        return unknown(
          `the runner could not decide${sample.reason ? ` — ${sample.reason}` : ""} · ${age}`
        );
      }
      const needsHuman =
        (sample.exitStuck ?? 0) > 0 || (authorRowCount ?? 0) > 0;
      const blockersKnown = sample.exitStuck !== null && authorRowCount !== null;
      const detail = `${sample.reason ?? "the runner gave no reason"} · ${age}`;
      return {
        level: needsHuman ? "red" : "amber",
        headline: "Not safe to restart",
        detail: needsHuman || blockersKnown ? detail : `${detail} · blockers unknown`,
      };
    }
  }
}

export interface ReadinessCounts {
  blocking: number | null;
  finished: number | null;
  closeEligible: number | null;
  exitStuck: number | null;
}

/** The four counts. Every one is `null` (UNKNOWN) unless readiness is fresh. */
export function readinessCounts(read: ReadinessRead): ReadinessCounts {
  if (read.kind !== "fresh") {
    return { blocking: null, finished: null, closeEligible: null, exitStuck: null };
  }
  const { sample } = read;
  return {
    blocking: sample.blocking,
    finished: sample.finished,
    closeEligible: sample.closeEligible,
    exitStuck: sample.exitStuck,
  };
}

/** A count as the strip renders it: the number, or `UNKNOWN` — never `0`. */
export function countLabel(value: number | null): string {
  return value === null ? UNKNOWN_LABEL : String(value);
}

/** The drain half of the strip, as one badge label. */
export function drainBadgeLabel(drain: DeviceDrainState): string {
  switch (drain.state) {
    case "drained":
      return "drained";
    case "expired":
      return "drain expired";
    case "not_drained":
      return "not drained";
    case "unknown":
      return `drain ${UNKNOWN_LABEL}`;
  }
}

// ---------------------------------------------------------------------------
// Session census
// ---------------------------------------------------------------------------

/** One `GET /coord/sessions/fleet` row. CamelCase, as coord serves it. */
export interface FleetSessionRow {
  sessionId: string;
  deviceId?: string | null;
  claudeCodeSessionId?: string | null;
  sessionKind?: string | null;
  intent?: string | null;
  state?: string | null;
  sessionStatus?: string | null;
  workUnitSlug?: string | null;
  repo?: string | null;
  branch?: string | null;
  startedAt?: string | null;
  lastHeartbeatAt?: string | null;
  closedAt?: string | null;
  /** D7. Absent on a coord that predates it — which is not `"unknown"`. */
  spawnOrigin?: string | null;
  continuationGateId?: string | null;
  dispatchSource?: string | null;
}

export type FleetSessionsRead =
  | { kind: "loading" }
  | { kind: "failed"; reason: string }
  | {
      kind: "ok";
      rows: FleetSessionRow[];
      /** Coord's `nextCursor` was set: more sessions match than it served. */
      hasMore: boolean;
      /** `false` = coord degraded `sessionStatus` to null on every row. */
      workAxisColumnsPresent: boolean | null;
      /** A later refresh failed; `rows` are the last good read, now aging. */
      refreshError: string | null;
    };

/** Parse a fleet-sessions body, or say why it cannot be read. */
export function parseFleetSessions(
  payload: unknown
):
  | { ok: true; rows: FleetSessionRow[]; hasMore: boolean; workAxisColumnsPresent: boolean | null }
  | { ok: false; reason: string } {
  if (!isRecord(payload) || !Array.isArray(payload.sessions)) {
    return {
      ok: false,
      reason:
        "The session census returned no `sessions` array, so this device's " +
        "sessions could not be read.",
    };
  }
  const rows = payload.sessions.filter(
    (r): r is FleetSessionRow =>
      isRecord(r) && typeof r.sessionId === "string" && r.sessionId !== ""
  );
  return {
    ok: true,
    rows,
    hasMore: typeof payload.nextCursor === "string" && payload.nextCursor !== "",
    workAxisColumnsPresent:
      typeof payload.workAxisColumnsPresent === "boolean"
        ? payload.workAxisColumnsPresent
        : null,
  };
}

/** One row on the page: a coord session, a runner-only wind-down entry, or both. */
export interface RunnerSessionRecord {
  key: string;
  /** `null` = the runner reports it and coord's census does not name it. */
  session: FleetSessionRow | null;
  windDown: WindDownSession | null;
  /** Readiness is fresh, so `windDown`'s presence or absence means something. */
  windDownKnown: boolean;
  /** The runner's array was capped, so a missing entry may just be cut off. */
  windDownTruncated: boolean;
  /**
   * How many OPEN coord rows share this row's `claudeCodeSessionId` (1 when it
   * is unique, 0 for a runner-only row). Above 1 the join cannot say which
   * coord row the runner's entry belongs to, so the row is UNKNOWN and offers
   * no action — a control request could land on the wrong coord session.
   */
  sharedClaudeIdCount: number;
}

/**
 * Join the census to the runner's wind-down report by
 * `claude_code_session_id`.
 *
 * A wind-down entry no census row names is KEPT as its own row: it is a
 * session the runner says blocks (or does not block) a restart, and dropping
 * it because coord's row is missing would hide exactly the blocker an
 * operator is looking for. It carries no coord session id, so it has no
 * actions — there is nothing to address a control request to.
 */
export function joinRunnerSessions(
  sessions: ReadonlyArray<FleetSessionRow>,
  read: ReadinessRead
): RunnerSessionRecord[] {
  const known = read.kind === "fresh" && read.sample.sessions !== null;
  const truncated = read.kind === "fresh" && read.sample.truncated;
  const byClaudeId = new Map<string, WindDownSession>();
  if (read.kind === "fresh") {
    for (const w of read.sample.sessions ?? []) {
      byClaudeId.set(normalizeId(w.claude_code_session_id), w);
    }
  }
  const open = sessions.filter((s) => !s.closedAt);
  const openPerClaudeId = new Map<string, number>();
  for (const session of open) {
    if (!session.claudeCodeSessionId) continue;
    const id = normalizeId(session.claudeCodeSessionId);
    openPerClaudeId.set(id, (openPerClaudeId.get(id) ?? 0) + 1);
  }
  const matched = new Set<string>();
  const out: RunnerSessionRecord[] = [];
  for (const session of open) {
    const claudeId = session.claudeCodeSessionId
      ? normalizeId(session.claudeCodeSessionId)
      : null;
    const shared = claudeId ? (openPerClaudeId.get(claudeId) ?? 1) : 1;
    const entry = claudeId ? (byClaudeId.get(claudeId) ?? null) : null;
    // Consumed either way, so an ambiguous id does not ALSO surface as a
    // runner-only row.
    if (entry && claudeId) matched.add(claudeId);
    out.push({
      key: `session:${session.sessionId}`,
      session,
      // Attached to no row when the id is ambiguous: which coord session the
      // runner means is exactly what cannot be told.
      windDown: shared > 1 ? null : entry,
      windDownKnown: known,
      windDownTruncated: truncated,
      sharedClaudeIdCount: shared,
    });
  }
  for (const [claudeId, windDown] of byClaudeId) {
    if (matched.has(claudeId)) continue;
    out.push({
      key: `runner:${claudeId}`,
      session: null,
      windDown,
      windDownKnown: known,
      windDownTruncated: truncated,
      sharedClaudeIdCount: 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Row status — the audited palette
// ---------------------------------------------------------------------------

export type RunnerSessionKind =
  | "exit_stuck"
  | "idle_blocking"
  | "working"
  | "closing"
  | "unknown"
  | "close_eligible"
  | "not_blocking";

/**
 * The audited kind → attention table (R3), TOTAL over
 * {@link RunnerSessionKind}.
 *
 * - `exit_stuck` and `idle_blocking` are `author`: the runner has stopped
 *   BECAUSE it needs a human. A session that did not leave on `/exit`, and an
 *   idle one nobody has declared finished, both stay blocking forever unless
 *   an operator acts — the runner never infers "finished" (D4).
 * - `working` and `closing` are `waiting`: self-clearing. The session will
 *   finish its turn, or the grace period will run out and the runner closes
 *   it.
 * - `unknown` is `waiting` under the palette's documented exception: amber on
 *   an unknown row is a statement about our knowledge.
 * - `close_eligible` and `not_blocking` are calm — the next move is the
 *   runner's, or there is none.
 */
export const RUNNER_SESSION_ATTENTION_BY_KIND: Record<RunnerSessionKind, Attention> = {
  exit_stuck: "author",
  idle_blocking: "author",
  working: "waiting",
  closing: "waiting",
  unknown: "waiting",
  close_eligible: "none",
  not_blocking: "none",
};

export const RUNNER_SESSION_BADGE_CLASS: Record<RunnerSessionKind, string> = {
  exit_stuck: AUTHOR_RED,
  idle_blocking: AUTHOR_RED,
  working: WAITING_AMBER,
  closing: WAITING_AMBER,
  unknown: UNKNOWN_AMBER,
  close_eligible: "bg-green-500/5 text-green-300 border-green-500/25",
  not_blocking: INERT,
};

export const RUNNER_SESSION_AUTHOR_GLYPH_KINDS: ReadonlySet<RunnerSessionKind> =
  new Set<RunnerSessionKind>(["exit_stuck", "idle_blocking"]);

export const RUNNER_SESSION_PALETTE: StatusPalette<RunnerSessionKind> = {
  badgeClass: RUNNER_SESSION_BADGE_CLASS,
  authorGlyphKinds: RUNNER_SESSION_AUTHOR_GLYPH_KINDS,
};

function status(
  kind: RunnerSessionKind,
  label: string,
  reason: string
): RowStatus<RunnerSessionKind> {
  return {
    kind,
    label,
    reason,
    attention: RUNNER_SESSION_ATTENTION_BY_KIND[kind],
  };
}

/** What one row's badge says, and who must act on it. */
export function deriveRunnerSessionStatus(
  rec: RunnerSessionRecord
): RowStatus<RunnerSessionKind> {
  if (rec.sharedClaudeIdCount > 1) {
    return status(
      "unknown",
      UNKNOWN_LABEL,
      `${rec.sharedClaudeIdCount} open coord sessions share this Claude session id, ` +
        "so which one the runner reports on cannot be told"
    );
  }
  if (!rec.windDownKnown) {
    return status(
      "unknown",
      UNKNOWN_LABEL,
      "readiness is not fresh, so whether this session blocks a restart is unknown"
    );
  }
  const w = rec.windDown;
  if (w === null) {
    return status(
      "unknown",
      UNKNOWN_LABEL,
      rec.windDownTruncated
        ? "the runner's wind-down report was capped and does not name this session"
        : "the runner's wind-down report does not name this session"
    );
  }
  if (w.exit_stuck === true) {
    return status(
      "exit_stuck",
      "exit stuck",
      "the runner asked it to exit and it did not close"
    );
  }
  if (w.eligibility === "eligible") {
    return status(
      "close_eligible",
      "closing",
      "finished and idle — the runner closes it"
    );
  }
  if (w.blocks_restart === false) {
    return status("not_blocking", "not blocking", "does not block a restart");
  }
  if (w.blocks_restart !== true) {
    return status(
      "unknown",
      UNKNOWN_LABEL,
      "the runner did not say whether this session blocks a restart"
    );
  }
  if (w.eligibility === "not_yet") {
    return status(
      "closing",
      "grace period",
      w.close_eligible_at
        ? `finished and idle; closes once still idle at ${w.close_eligible_at}`
        : "finished and idle; closes when its grace period runs out"
    );
  }
  if (w.idle_state === "busy") {
    return status("working", "working", "blocks a restart until its turn ends");
  }
  if (w.idle_state === "idle") {
    return status(
      "idle_blocking",
      "idle, blocking",
      "idle but not declared finished, so the runner will not close it"
    );
  }
  return status(
    "unknown",
    UNKNOWN_LABEL,
    "the runner could not tell whether this session is idle"
  );
}

/** Loudest first, then newest — the rows a human must act on lead. */
export function sortRunnerSessions(
  records: ReadonlyArray<RunnerSessionRecord>
): RunnerSessionRecord[] {
  const rank: Record<Attention, number> = { author: 0, waiting: 1, none: 2 };
  return [...records].sort((a, b) => {
    const byAttention =
      rank[deriveRunnerSessionStatus(a).attention] -
      rank[deriveRunnerSessionStatus(b).attention];
    if (byAttention !== 0) return byAttention;
    const at = Date.parse(a.session?.startedAt ?? "") || 0;
    const bt = Date.parse(b.session?.startedAt ?? "") || 0;
    return bt - at;
  });
}

// ---------------------------------------------------------------------------
// Row text
// ---------------------------------------------------------------------------

/** D7 vocabulary → the words on the row. */
export const SPAWN_ORIGIN_LABEL: Readonly<Record<string, string>> = {
  gate_continuation: "gate continuation",
  unit_continuation: "unit continuation",
  coord_dispatch: "coord dispatch",
  looping_agent: "looping agent",
  steward: "steward",
  respawn: "respawn",
  scheduler: "scheduler",
  orchestration: "orchestration",
  boot_resume: "boot resume",
  operator_terminal: "operator terminal",
  operator_chat: "operator chat",
  unknown: "origin unknown",
};

/** Origins that have an iteration boundary to stop at (D6). */
export const BOUNDARY_ORIGINS: ReadonlySet<string> = new Set([
  "steward",
  "looping_agent",
]);

/**
 * The session's spawn origin: coord's stamped `spawnOrigin` first, then the
 * runner's own `spawn_origin`. `null` when neither reports one — a coord or
 * runner that predates D7 — which reads as "origin unknown" and never as a
 * guessed class.
 */
export function spawnOriginOf(rec: RunnerSessionRecord): string | null {
  return (
    optionalString(rec.session?.spawnOrigin) ??
    optionalString(rec.windDown?.spawn_origin)
  );
}

/** What a row says when neither coord nor the runner names an origin. */
export const UNKNOWN_ORIGIN_LABEL = "origin unknown";

export function originLabel(rec: RunnerSessionRecord): string {
  const origin = spawnOriginOf(rec);
  if (origin === null) return UNKNOWN_ORIGIN_LABEL;
  return SPAWN_ORIGIN_LABEL[origin] ?? origin;
}

/** Coord's work axis, or UNKNOWN — a null here is unset OR degraded. */
export function workStatusLabel(rec: RunnerSessionRecord): string {
  return optionalString(rec.session?.sessionStatus) ?? UNKNOWN_LABEL;
}

/** `idle · eligible`, with each half UNKNOWN on its own. */
export function idleEligibilityLabel(rec: RunnerSessionRecord): string {
  if (!rec.windDownKnown || rec.windDown === null) {
    return `${UNKNOWN_LABEL} · ${UNKNOWN_LABEL}`;
  }
  const idle = rec.windDown.idle_state ?? UNKNOWN_LABEL;
  const eligibility = rec.windDown.eligibility ?? UNKNOWN_LABEL;
  return `${idle} · ${eligibility.replace("_", " ")}`;
}

export function blocksRestartLabel(rec: RunnerSessionRecord): string {
  if (!rec.windDownKnown || rec.windDown === null) return UNKNOWN_LABEL;
  if (rec.windDown.blocks_restart === true) return "yes";
  if (rec.windDown.blocks_restart === false) return "no";
  return UNKNOWN_LABEL;
}

/** The short id a row leads with — the harness id when known, it is the one a runner holds. */
export function shortSessionId(rec: RunnerSessionRecord): string {
  const id =
    rec.session?.claudeCodeSessionId ??
    rec.windDown?.claude_code_session_id ??
    rec.session?.sessionId ??
    "";
  return id.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

export type SessionControlAction = "finish_and_close" | "stop_at_boundary";

export interface ActionGate {
  allowed: boolean;
  /** Why it is not offered — shown in place of the button. */
  reason: string;
}

/**
 * Which operator actions a row offers.
 *
 * - **Finish & close** — idle sessions only. The click declares the session
 *   finished (D4: the runner never infers it) and the runner closes it with
 *   `/exit` once it is idle; offering it on a working session would declare
 *   finished a turn that is still running.
 * - **Stop at boundary** — steward and looping-agent sessions only: they are
 *   the ones with an iteration boundary to stop at (D6).
 *
 * Both need a coord session id, because that is what the request is addressed
 * to.
 */
export function sessionActionGates(
  rec: RunnerSessionRecord
): Record<SessionControlAction, ActionGate> {
  const noSession: ActionGate = {
    allowed: false,
    reason:
      "coord's census has no session row for this runner session, so there " +
      "is nothing to address a request to",
  };
  if (rec.session === null) {
    return { finish_and_close: noSession, stop_at_boundary: noSession };
  }
  if (rec.sharedClaudeIdCount > 1) {
    const ambiguous: ActionGate = {
      allowed: false,
      reason:
        `${rec.sharedClaudeIdCount} open coord sessions share this Claude ` +
        "session id, so a request could reach the wrong one",
    };
    return { finish_and_close: ambiguous, stop_at_boundary: ambiguous };
  }

  let finish: ActionGate;
  if (!rec.windDownKnown) {
    finish = {
      allowed: false,
      reason: "readiness is not fresh, so whether this session is idle is unknown",
    };
  } else if (rec.windDown === null) {
    finish = {
      allowed: false,
      reason: "the runner does not report this session's idle state",
    };
  } else if (rec.windDown.idle_state === "idle") {
    finish = { allowed: true, reason: "" };
  } else if (rec.windDown.idle_state === "busy") {
    finish = {
      allowed: false,
      reason: "the session is working — finish & close is for idle sessions only",
    };
  } else {
    finish = {
      allowed: false,
      reason: "the runner could not tell whether this session is idle",
    };
  }

  const origin = spawnOriginOf(rec);
  const stop: ActionGate =
    origin !== null && BOUNDARY_ORIGINS.has(origin)
      ? { allowed: true, reason: "" }
      : {
          allowed: false,
          reason:
            origin === null
              ? "the session's origin is unknown, so it is not known to have an iteration boundary"
              : "only steward and looping-agent sessions have an iteration boundary to stop at",
        };

  return { finish_and_close: finish, stop_at_boundary: stop };
}

/** `ErrorCode.VALIDATION_ERROR` — the web backend's own request validation. */
export const WEB_VALIDATION_ERROR_CODE = "VALIDATION_ERROR";

/** The longest reason the proxy accepts (`SessionControlRequestBody`). */
export const CONTROL_REASON_MAX_LENGTH = 2000;

export type ControlWriteResult =
  | { ok: true; eventId: string | null }
  | { ok: false; status: number | null; code: string | null; message: string };

/**
 * A control refusal as an operator reads it.
 *
 * The proxy forwards coord's typed body (`structured_errors=True`), which the
 * backend's error envelope splices to the top level (`{error: …}`); a bare
 * FastAPI app nests it (`{detail: {error: …}}`). Both are read.
 *
 * A 422 has two authors and they mean opposite things. The WEB backend's own
 * validation (pydantic, before coord is asked) answers
 * `{error: "VALIDATION_ERROR", details: [{field, message}]}` through the app
 * envelope, or `{detail: [...]}` from a bare app: nothing reached coord. Coord's
 * 422 carries its own code: coord was asked and refused.
 *
 * **Only the pydantic issue array proves the web's own validation.** The app
 * envelope labels EVERY string-detail 422 `VALIDATION_ERROR`
 * (`get_default_error_code(422)`), so a plain-text 422 from coord — an older
 * coord that does not know `stop_at_boundary` — arrives as
 * `{error: "VALIDATION_ERROR", message: <coord's text>}` with no `details`.
 * That is coord's refusal, and `VALIDATION_ERROR` there is the envelope's
 * default label, not a code coord sent.
 */
export function describeControlError(
  status: number,
  bodyText: string
): { code: string | null; message: string } {
  let code: string | null = null;
  let validationIssues: string[] | null = null;
  let envelopeMessage: string | null = null;
  try {
    const parsed: unknown = JSON.parse(bodyText);
    if (isRecord(parsed)) {
      if (typeof parsed.error === "string") code = parsed.error;
      else if (isRecord(parsed.detail) && typeof parsed.detail.error === "string") {
        code = parsed.detail.error;
      }
      if (typeof parsed.message === "string") envelopeMessage = parsed.message;
      const webValidation =
        (code === WEB_VALIDATION_ERROR_CODE && Array.isArray(parsed.details)) ||
        (code === null && Array.isArray(parsed.detail));
      if (webValidation) {
        const issues: unknown[] = Array.isArray(parsed.details)
          ? parsed.details
          : Array.isArray(parsed.detail)
            ? parsed.detail
            : [];
        validationIssues = issues.map((issue) => {
          if (!isRecord(issue)) return String(issue);
          const field =
            typeof issue.field === "string"
              ? issue.field
              : Array.isArray(issue.loc)
                ? issue.loc.join(".")
                : "";
          const message =
            typeof issue.message === "string"
              ? issue.message
              : typeof issue.msg === "string"
                ? issue.msg
                : "invalid";
          return field ? `${field}: ${message}` : message;
        });
      }
    }
  } catch {
    // Not JSON — an intermediary's error page. The status still speaks.
  }
  const snippet = bodyText.trim().slice(0, 200);
  if (status === 422 && validationIssues !== null) {
    return {
      code,
      message:
        "The web backend rejected the request before asking coord" +
        (validationIssues.length > 0 ? ` — ${validationIssues.join("; ")}` : "."),
    };
  }
  if (code === "session_not_found") {
    return {
      code,
      message:
        "Coord has no session with this id, so the request was not recorded. " +
        "It may already have been removed — refresh the list.",
    };
  }
  if (code === "session_closed") {
    return {
      code,
      message:
        "This session is already closed; there is nothing left to finish or stop.",
    };
  }
  if (status === 404) {
    return {
      code,
      message:
        "HTTP 404 without a session_not_found code — this coord likely does " +
        "not serve the session control route yet.",
    };
  }
  if (status === 422) {
    // `VALIDATION_ERROR` without `details` is the envelope's default label on
    // coord's plain-text 422, not a code coord chose — so it is not shown as
    // one, and coord's own text is.
    const coordCode = code === WEB_VALIDATION_ERROR_CODE ? null : code;
    const coordText = (
      code === WEB_VALIDATION_ERROR_CODE && envelopeMessage !== null
        ? envelopeMessage
        : snippet
    )
      .trim()
      .slice(0, 200);
    return {
      code: coordCode,
      message:
        coordCode !== null
          ? `Coord refused the request (${coordCode}) — most likely this coord ` +
            "does not know this action yet."
          : "Coord refused the request as malformed — most likely it does not " +
            `know this action yet.${coordText ? ` (${coordText})` : ""}`,
    };
  }
  if (status === 403) {
    return {
      code,
      message: "Only a coord tenant admin can send session control requests.",
    };
  }
  if (status === 502 || status === 504) {
    return {
      code,
      message: "Coord could not be reached, so the request was not recorded.",
    };
  }
  return {
    code,
    message: `HTTP ${status}${snippet ? `: ${snippet}` : ""}`,
  };
}
