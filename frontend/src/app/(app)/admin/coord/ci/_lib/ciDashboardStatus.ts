/**
 * `/admin/coord/ci` — the wire shape of coord's CI overview read, and every
 * PURE derivation the CI dashboard renders from (style guide R8: status
 * derivation lives in a unit-tested module, never inline in JSX).
 *
 * Plan `2026-10-04-ci-dashboard-in-the-dev-ops-console` Phase 3. The page
 * answers one question — *is CI healthy right now, and if not, where is it
 * stuck and why?* — from three reads, each the owner of its own fact:
 *
 * - `GET /api/v1/operations/ci/overview` → coord `GET /coord/ci/overview`:
 *   per-`(repo, pool)` capacity and queue state, and the per-repo 24 h
 *   job-outcome split. Durable rows (`coord.ci_pool_observations`), so every
 *   replica answers the same; every row carries `state` (D4).
 * - `GET /api/v1/operations/ci-status` (+ its WS): main verdict and open-PR
 *   checks per repo, now with `*_observed_at` freshness stamps.
 * - `GET /api/v1/operations/pr-merge/merge-economics`: candidate-CI p90.
 *
 * ## The rules this module exists to hold (plan D4)
 *
 * 1. **A number renders only when its row is `measured`.** Every other state
 *    (`stale`, `never_observed`, `unknown`) renders `–` WITH its reason, on
 *    the amber ignorance floor (style guide R3 "the one exception", R6). A
 *    `0` appears only on a measured row — `0` is a measurement, `–` is not.
 * 2. **Green is unreachable on ignorance.** The strip is never green while
 *    ANY pool is not `measured` (required or not — an unmeasured pool's
 *    required-ness is itself unknown), while any pool's `required` is `null`,
 *    while any repo lacks a CI-status row, a green/red main or a measured
 *    outcome split, while any open alert has no current pool reading
 *    (`unattached_alerts`), or while either read the strip is built from failed,
 *    never landed, or is older than three polls.
 *    UNKNOWN renders UNKNOWN — not "stuck" and not "healthy"
 *    (`[policy: an-unknown-input-must-not-fire-a-detector]`).
 * 3. **Infra-shaped is never folded into content red.** A job that failed
 *    with zero failed steps (runner died, billing refusal) is not a code
 *    failure, and counting it as one sends authors to fix code that is not
 *    broken. The two are separate counts on every surface.
 * 4. **`hosted` is a refusal FLOOR, never a measured zero** (Phase 5a).
 *    Coord counts hosted jobs GitHub NEVER STARTED (conclusion failure, no
 *    runner, no steps) in the 24 h window as `hosted_refused`. That is INFRA
 *    — "hosted job refused — not a code failure" — and it is never summed
 *    into `content_fail`, the content-red badge, or `infra_shaped` (which is
 *    self-hosted only). Only `state: "observed"` renders a number, and it
 *    renders as `≥N` because the count is a floor. `none_observed` is NOT a
 *    measured zero (`–` with coord's note), `unknown` is `–` UNKNOWN, and an
 *    older coord's `not_measured` is `–` with its note. An open
 *    `ci_billing_refused` alert names the proven cause ("GitHub Actions
 *    billing / spending limit") whatever the state; without it the cause is
 *    "not stored", never guessed.
 *
 * ## Colour means who must act (R3)
 *
 * - **Red** — on a CURRENT, measured reading only: a REQUIRED pool with no
 *   eligible runner, a `ci_job_queue_stalled` alert the reading confirms
 *   (jobs queued, oldest past its bound), or red main. An alert the reading
 *   does not confirm is amber (`alert_contradicted` / `alert_unconfirmed`),
 *   and a stuck pool on a stale read is UNKNOWN ("Last read showed …").
 * - **Amber** — waiting (a queue past its bound, jobs queued with no
 *   eligibility answer) or UNKNOWN (the ignorance floor).
 * - **Green** — only when every pool is measured, every pool's `required` is
 *   known, every repo row is known, and nothing above holds.
 *
 * Everything below is pure and unit-tested (`ciDashboardStatus.test.ts`).
 */

import {
  AUTHOR_RED,
  CI_YELLOW,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  ATTENTION_RANK,
  type AttentionMap,
  type HealthBadge,
  type HealthStripLevel,
  type RowStatus,
  type StatusPalette,
} from "@/components/console";
import type { MergeEconomics } from "@/components/operations/mergeTypes";
import type { RepoCiRow } from "@/components/operations/types";

// ---------------------------------------------------------------------------
// Wire — coord `GET /coord/ci/overview`, field for field (plan Phase 2)
// ---------------------------------------------------------------------------

/**
 * D4's four states. Anything else this build does not know is `unknown`.
 * `never_observed` is a REPO-outcome state only: coord reads a pool the
 * queue watcher has not visited yet as `unknown`, never `never_observed`.
 */
export type ObservationState =
  | "measured"
  | "stale"
  | "never_observed"
  | "unknown";

/** The states coord serves on a pool row (no `never_observed`). */
export type PoolObservationState = Exclude<ObservationState, "never_observed">;

export type EligibilityState = "eligible" | "no_eligible_runner" | "unknown";

/**
 * One open `coord.alerts` row on a `(repo, pool)`. `alert_id` is coord's
 * bigint id rendered as a STRING (not a uuid). `opened_at` is FIRE time and
 * `summary` carries the fire-time numbers: an alert stays open (and its
 * numbers stay as fired) while the pool's current reading may be anything,
 * so neither is ever presented as the pool's current state.
 */
export interface CiPoolAlertWire {
  alert_id: string;
  kind: string;
  opened_at: string;
  /** When coord last re-confirmed the condition. */
  last_seen_at: string | null;
  occurrences: number | null;
  /** Coord's note on how the alert relates to the pool's state NOW. */
  current_state_note: string | null;
  summary: string;
}

export interface CiPoolWire {
  repo: string;
  pool: string;
  /** `measured` / `stale` / `unknown` (an unvisited pool reads `unknown`). */
  state: PoolObservationState | string;
  state_reason: string | null;
  observed_at: string | null;
  stale_after_secs: number | null;
  poll_ok: boolean | null;
  poll_complete: boolean | null;
  queued_jobs: number | null;
  oldest_queued_age_secs: number | null;
  threshold_secs: number | null;
  p90_wait_secs: number | null;
  eligibility_state: EligibilityState | string | null;
  eligible_runners: number | null;
  eligible_registrations: number | null;
  unknown_registrations: number | null;
  eligible_runners_drained: number | null;
  eligibility_observed_at: string | null;
  required: boolean | null;
  required_note: string | null;
  coverage_note: string | null;
  open_alerts: CiPoolAlertWire[] | null;
}

export interface CiOutcomesWire {
  pass: number;
  content_fail: number;
  infra_shaped: number;
  neutral: number;
  unknown: number;
}

/**
 * The repo's open `ci_billing_refused` alert — the PROVEN cause of hosted
 * refusals (Actions billing / spending limit).
 */
export interface CiBillingRefusalWire {
  alert_id: string;
  opened_at: string;
  last_seen_at: string | null;
}

/**
 * Coord's hosted-unstarted block (Phase 5a). `state` is `observed` /
 * `none_observed` / `unknown`; an older coord sends `not_measured` with a
 * note and none of the other fields, so every field past `state` is optional
 * and absent reads as `null`.
 */
export interface CiHostedWire {
  state: string;
  note?: string | null;
  /**
   * Hosted jobs GitHub never started in the window — INFRA, never content.
   * A FLOOR. Non-null only when `state == "observed"` (and then never 0).
   */
  hosted_refused?: number | null;
  /** RFC3339: the newest counted job's `completed_at`. */
  last_refused_at?: string | null;
  billing_refusal?: CiBillingRefusalWire | null;
}

export interface CiRepoOverviewWire {
  repo: string;
  window_hours: number | null;
  state: ObservationState | string;
  state_reason: string | null;
  outcomes: CiOutcomesWire | null;
  hosted: CiHostedWire | null;
  /**
   * Newest job observation for this repo, any age (coord AS-BUILT). The
   * outcome split's freshness stamp. Absent from an older coord and `null`
   * with no observation at all — UNKNOWN freshness either way.
   */
  last_observed_at?: string | null;
  /**
   * Whether coord's queue watcher watches any pool for this repo. `false` is
   * a configuration fact (no self-hosted pool in its workflows), not an
   * error; absent/`null` is unknown.
   */
  pools_watched?: boolean | null;
}

/**
 * An open alert that matches no persisted pool row (coord AS-BUILT). Coord
 * holds NO current observation of its pool, so it can never be confirmed:
 * always amber/UNKNOWN, never "Stuck". Its `current_state_note` says why its
 * numbers are not current.
 */
export interface CiUnattachedAlertWire extends CiPoolAlertWire {
  repo: string;
  pool: string;
}

export interface CiOverviewWire {
  as_of: string | null;
  coverage_note: string | null;
  note: string | null;
  pools: CiPoolWire[];
  repos: CiRepoOverviewWire[];
  /** Absent from a coord predating it — read as `[]` by {@link unattachedAlerts}. */
  unattached_alerts?: CiUnattachedAlertWire[] | null;
}

/** The overview's unattached alerts, `[]` when coord sent none. */
export function unattachedAlerts(
  data: CiOverviewWire | null
): CiUnattachedAlertWire[] {
  return data?.unattached_alerts ?? [];
}

/** `/ci/overview` poll cadence — the queue-wait watcher's tick (plan Phase 4). */
export const CI_OVERVIEW_POLL_MS = 120_000;
/**
 * A read older than three polls is not current, whatever it says: a coord
 * that stopped answering (or a tab that stopped polling) must not keep a
 * green strip lit off its last good read.
 */
export const CI_OVERVIEW_STALE_AFTER_SECS = (3 * CI_OVERVIEW_POLL_MS) / 1000;

/** The open-alert kind that is red on its own: coord saw a queue stall. */
export const QUEUE_STALLED_ALERT = "ci_job_queue_stalled";
/** Coord's no-eligible-runner alert kind (`ci_pool_alerts.rs`). */
export const NO_ELIGIBLE_RUNNER_ALERT = "ci_pool_no_eligible_runner";

// ---------------------------------------------------------------------------
// Readings — one cell, which either carries a number or says why not
// ---------------------------------------------------------------------------

/** A value that may refuse to answer. `known: false` renders amber `–`. */
export interface CellReading {
  text: string;
  known: boolean;
  /** Why it is not a number — rendered as the cell's title, always present when `known` is false. */
  reason: string | null;
  /**
   * A known figure's explanation, rendered as its title. Only the hosted
   * refusal cell sets it (what the floor means, and its cause).
   */
  note?: string | null;
  /**
   * `infra` paints a KNOWN figure amber: an infrastructure signal (hosted
   * job refused), never content red. Absent = the calm default.
   */
  tone?: "infra";
}

export const DASH = "–";

const KNOWN_STATES: ReadonlySet<string> = new Set([
  "measured",
  "stale",
  "never_observed",
  "unknown",
]);

/** Coerce a wire state this build may not know onto D4's four. */
export function normalizeState(
  state: string | null | undefined
): ObservationState {
  return state && KNOWN_STATES.has(state)
    ? (state as ObservationState)
    : "unknown";
}

/** The human reason for a non-measured state, preferring coord's own words. */
export function stateReason(
  state: ObservationState,
  coordReason: string | null | undefined
): string {
  if (coordReason && coordReason.trim()) return coordReason;
  switch (state) {
    case "stale":
      return "last observation is older than its staleness bound — not current";
    case "never_observed":
      return "coord has never observed this — no measurement exists";
    case "unknown":
      return "the last poll failed or was partial — no measurement";
    case "measured":
      return "";
  }
}

/** Seconds → `3h12m` / `14m` / `40s`. Never called on a null. */
export function formatDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  if (h < 48) return rm ? `${h}h${String(rm).padStart(2, "0")}m` : `${h}h`;
  return `${Math.floor(h / 24)}d${h % 24 ? `${h % 24}h` : ""}`;
}

/**
 * The cell rule, in one place: a number only on a measured row. A measured
 * row's `null` field is "not reported in this pass" — still a dash, with that
 * reason — because a `null` is never a `0`.
 */
export function cell(
  value: number | null | undefined,
  state: ObservationState,
  reason: string | null,
  format: (n: number) => string = String
): CellReading {
  if (state !== "measured") {
    return { text: DASH, known: false, reason: stateReason(state, reason) };
  }
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return {
      text: DASH,
      known: false,
      reason: "coord measured this pool but did not report this figure",
    };
  }
  return { text: format(value), known: true, reason: null };
}

// ---------------------------------------------------------------------------
// Pools — per-`(repo, pool)` status, and the per-pool group the page lists
// ---------------------------------------------------------------------------

export type PoolKind =
  | "queue_stalled"
  | "alert_unconfirmed"
  | "alert_contradicted"
  | "alert_incomplete"
  | "no_eligible_runner"
  | "no_runner_required_unknown"
  | "queue_over_bound"
  | "eligibility_unknown"
  | "required_unknown"
  | "queued"
  | "clear"
  | "no_runner_not_required"
  | "stale"
  | "never_observed"
  | "unknown";

/**
 * The audit, one line per kind:
 *
 * - `queue_stalled` — AUTHOR. Coord raised `ci_job_queue_stalled` for this
 *   `(repo, pool)` AND the pool currently reads `measured`: jobs have waited
 *   past the bound and nothing is taking them. The 130-jobs-vs-2-runners and
 *   hours-queued incidents.
 * - `alert_contradicted` — WAITING. An alert is open on a MEASURED pool, but
 *   the current reading DISPROVES it (a stall alert while nothing is queued
 *   or the oldest job is within a reported bound; a no-eligible-runner alert
 *   while the pool reads eligible). The alert is
 *   coord's to close; the reading says nothing is stuck now, so it is not red.
 * - `alert_incomplete` — WAITING (ignorance floor). An alert is open on a
 *   MEASURED pool but the reading lacks the figure that would confirm or
 *   disprove it (no stall bound, no oldest age, eligibility unresolved).
 *   The reason names the missing figure.
 * - `alert_unconfirmed` — WAITING (ignorance floor). An alert is open, but
 *   the pool does not currently read `measured`, so nothing confirms the
 *   alert's fire-time numbers still hold. Live on 2026-10-04 coord kept
 *   day-old `ci_pool_no_eligible_runner` / `ci_job_queue_stalled` rows open
 *   on pools reading `unknown`; painting those "Stuck" would let an UNKNOWN
 *   input fire a detector (`[policy: an-unknown-input-must-not-fire-a-detector]`).
 *   The row shows the alert's age and coord's `current_state_note` instead.
 * - `no_eligible_runner` — AUTHOR. A pool on a REQUIRED path has no runner
 *   that can take its jobs; every PR waiting on it waits forever.
 * - `no_runner_required_unknown` — WAITING (ignorance floor). No eligible
 *   runner, and coord could not say whether the pool is on a required path —
 *   so we cannot say whether anything is blocked. Not red: that would claim a
 *   blocked merge we cannot see.
 * - `queue_over_bound` — WAITING. The oldest queued job is past its bound but
 *   coord has not raised a stall: either runners drain it, or the stall alert
 *   fires and the row turns red.
 * - `eligibility_unknown` — WAITING (ignorance floor). Queue measured, but
 *   whether any runner can take the work is not.
 * - `required_unknown` — WAITING (ignorance floor). Measured and clear, but
 *   coord cannot say whether the pool is required, so it cannot vouch for
 *   green.
 * - `queued` — none. Jobs queued within their bound: CI working.
 * - `clear` — none. Measured, eligible, nothing waiting.
 * - `no_runner_not_required` — none. No eligible runner, but the pool is on
 *   no required path: nothing is blocked. Calm, with the ask in words (R3's
 *   third case) — its jobs will not run until a runner is added.
 * - `stale` / `never_observed` / `unknown` — WAITING, the ignorance floor.
 */
export const CI_POOL_ATTENTION_BY_KIND = {
  queue_stalled: "author",
  alert_unconfirmed: "waiting",
  alert_contradicted: "waiting",
  alert_incomplete: "waiting",
  no_eligible_runner: "author",
  no_runner_required_unknown: "waiting",
  queue_over_bound: "waiting",
  eligibility_unknown: "waiting",
  required_unknown: "waiting",
  queued: "none",
  clear: "none",
  no_runner_not_required: "none",
  stale: "waiting",
  never_observed: "waiting",
  unknown: "waiting",
} satisfies AttentionMap<PoolKind>;

const CLEAR_GREEN = "bg-green-500/15 text-green-200 border-green-500/30";

export const CI_POOL_BADGE_CLASS: Record<PoolKind, string> = {
  queue_stalled: AUTHOR_RED,
  alert_unconfirmed: UNKNOWN_AMBER,
  alert_contradicted: WAITING_AMBER,
  alert_incomplete: UNKNOWN_AMBER,
  no_eligible_runner: AUTHOR_RED,
  no_runner_required_unknown: UNKNOWN_AMBER,
  queue_over_bound: WAITING_AMBER,
  eligibility_unknown: UNKNOWN_AMBER,
  required_unknown: UNKNOWN_AMBER,
  queued: CI_YELLOW,
  clear: CLEAR_GREEN,
  no_runner_not_required: INERT,
  stale: UNKNOWN_AMBER,
  never_observed: UNKNOWN_AMBER,
  unknown: UNKNOWN_AMBER,
};

export const CI_POOL_AUTHOR_GLYPH_KINDS: ReadonlySet<PoolKind> =
  new Set<PoolKind>(["queue_stalled", "no_eligible_runner"]);

export const CI_POOL_PALETTE: StatusPalette<PoolKind> = {
  badgeClass: CI_POOL_BADGE_CLASS,
  authorGlyphKinds: CI_POOL_AUTHOR_GLYPH_KINDS,
};

/** `[self-hosted, qontinui]` — the label set as an operator reads it. */
export function poolLabel(pool: string): string {
  const labels = pool
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  return labels.length ? `[${labels.join(", ")}]` : `[${pool}]`;
}

function stalledAlert(row: CiPoolWire): CiPoolAlertWire | null {
  return (
    (row.open_alerts ?? []).find((a) => a.kind === QUEUE_STALLED_ALERT) ?? null
  );
}

function queueSummary(row: CiPoolWire): string {
  const parts: string[] = [];
  if (row.queued_jobs !== null) parts.push(`${row.queued_jobs} queued`);
  if (row.oldest_queued_age_secs !== null) {
    parts.push(`oldest ${formatDuration(row.oldest_queued_age_secs)}`);
  }
  return parts.join(", ");
}

/**
 * An open alert's provenance in words: what it said when it fired, when it
 * fired, when coord last re-confirmed it, and coord's note on now. Never the
 * pool's current state — that is the row's `state`.
 */
export function alertAgeText(a: CiPoolAlertWire): string {
  const parts = [
    `${a.kind}${a.summary ? ` ("${a.summary}")` : ""}`,
    `fired ${a.opened_at}`,
    a.last_seen_at
      ? `last re-confirmed ${a.last_seen_at}`
      : "never re-confirmed",
  ];
  if (a.occurrences !== null && a.occurrences !== undefined) {
    parts.push(`${a.occurrences} occurrence${a.occurrences === 1 ? "" : "s"}`);
  }
  if (a.current_state_note) parts.push(a.current_state_note);
  return parts.join(", ");
}

/** One `(repo, pool)` row's verdict. */
export function poolRowStatus(row: CiPoolWire): RowStatus<PoolKind> {
  const make = (
    kind: PoolKind,
    label: string,
    reason: string
  ): RowStatus<PoolKind> => ({
    kind,
    label,
    reason,
    attention: CI_POOL_ATTENTION_BY_KIND[kind],
  });
  const state = normalizeState(row.state);
  // An open alert keeps its FIRE-time numbers however the pool reads now, so
  // it may drive red only when the pool is currently measured. On any other
  // state it is reported with its age and coord's note — never "Stuck".
  const alerts = row.open_alerts ?? [];
  const firstAlert = alerts[0];
  if (state !== "measured" && firstAlert) {
    const more = alerts.length > 1 ? ` (+${alerts.length - 1} more open)` : "";
    return make(
      "alert_unconfirmed",
      "alert · pool unknown",
      `${alertAgeText(firstAlert)}${more}; the pool reads ${state} now (${stateReason(state, row.state_reason)}), so the alert's numbers are not current`
    );
  }
  if (state !== "measured") {
    const label = state === "never_observed" ? "never observed" : state;
    return make(state, label, stateReason(state, row.state_reason));
  }
  const queue = queueSummary(row);
  // A stall alert drives red only when the CURRENT reading confirms it: jobs
  // queued and the oldest past its bound. Its fire-time summary is never the
  // reason on its own — the reason says when it fired and what it saw.
  const stall = stalledAlert(row);
  const stallConfirmed =
    stall !== null &&
    (row.queued_jobs ?? 0) > 0 &&
    row.oldest_queued_age_secs !== null &&
    row.threshold_secs !== null &&
    row.oldest_queued_age_secs > row.threshold_secs;
  if (stall && stallConfirmed) {
    return make(
      "queue_stalled",
      "queue stalled",
      `${queue} now, past the ${formatDuration(row.threshold_secs ?? 0)} bound; ${alertAgeText(stall)}`
    );
  }
  if (row.eligibility_state === "no_eligible_runner") {
    const what = `0 eligible runners${queue ? `, ${queue}` : ""}`;
    if (row.required === true) {
      return make(
        "no_eligible_runner",
        "no eligible runner",
        `${what} — this pool is on a required path, so PRs waiting on it cannot land`
      );
    }
    if (row.required === null) {
      return make(
        "no_runner_required_unknown",
        "no runner · required?",
        `${what} — whether this pool is on a required path is unknown${row.required_note ? ` (${row.required_note})` : ""}`
      );
    }
    return make(
      "no_runner_not_required",
      "no runner (not required)",
      `${what}; no required check runs here, so nothing is blocked — its jobs will not run until a runner is registered`
    );
  }
  // An open alert the current reading does not CONFIRM. Two different
  // answers: the reading DISPROVES it (`alert_contradicted`, "reading
  // clear"), or the reading lacks the figure that would decide it
  // (`alert_incomplete`) — the second is ignorance, never "clear".
  const noRunnerAlert =
    (row.open_alerts ?? []).find((a) => a.kind === NO_ELIGIBLE_RUNNER_ALERT) ??
    null;
  const incomplete: { alert: CiPoolAlertWire; missing: string }[] = [];
  const disproved: CiPoolAlertWire[] = [];
  if (stall) {
    const disprovesStall =
      row.queued_jobs === 0 ||
      (row.oldest_queued_age_secs !== null &&
        row.threshold_secs !== null &&
        row.oldest_queued_age_secs <= row.threshold_secs);
    if (disprovesStall) {
      disproved.push(stall);
    } else {
      const missing = [
        row.queued_jobs === null ? "the queued-job count" : null,
        row.oldest_queued_age_secs === null
          ? "the oldest queued job's age"
          : null,
        row.threshold_secs === null ? "the stall bound" : null,
      ].filter(Boolean);
      incomplete.push({ alert: stall, missing: missing.join(" and ") });
    }
  }
  if (noRunnerAlert) {
    if (row.eligibility_state === "eligible") {
      disproved.push(noRunnerAlert);
    } else {
      incomplete.push({
        alert: noRunnerAlert,
        missing: `the eligibility verdict (reads ${row.eligibility_state ?? "not reported"})`,
      });
    }
  }
  const firstIncomplete = incomplete[0];
  if (firstIncomplete) {
    return make(
      "alert_incomplete",
      "alert open · reading incomplete",
      `${alertAgeText(firstIncomplete.alert)}; the current reading cannot confirm or clear it — coord did not report ${firstIncomplete.missing}`
    );
  }
  const firstDisproved = disproved[0];
  if (firstDisproved) {
    return make(
      "alert_contradicted",
      "alert open · reading clear",
      `${alertAgeText(firstDisproved)}; the current reading disproves it (${queue || "nothing queued"}, eligibility ${row.eligibility_state ?? "not reported"})`
    );
  }
  if (
    row.oldest_queued_age_secs !== null &&
    row.threshold_secs !== null &&
    row.oldest_queued_age_secs > row.threshold_secs
  ) {
    return make(
      "queue_over_bound",
      "over bound",
      `${queue} — past the ${formatDuration(row.threshold_secs)} bound; coord has not raised a stall yet`
    );
  }
  if (row.eligibility_state !== "eligible") {
    return make(
      "eligibility_unknown",
      "eligibility unknown",
      `queue measured${queue ? ` (${queue})` : ""}, but whether any runner can take this pool's jobs is unknown`
    );
  }
  if (row.required === null) {
    return make(
      "required_unknown",
      "required?",
      `measured and clear, but whether this pool is on a required path is unknown${row.required_note ? ` (${row.required_note})` : ""}`
    );
  }
  if ((row.queued_jobs ?? 0) > 0) {
    return make("queued", "queued", `${queue} — within bound`);
  }
  return make("clear", "clear", "eligible runners, nothing queued");
}

const STATE_RANK: Record<ObservationState, number> = {
  measured: 0,
  stale: 1,
  never_observed: 2,
  unknown: 3,
};

/** One `(repo, pool)` row and its verdict. */
export interface PoolEntry {
  member: CiPoolWire;
  status: RowStatus<PoolKind>;
}

/** The pool the page lists: one label set, across the repos that use it. */
export interface PoolGroup {
  pool: string;
  members: CiPoolWire[];
  /** The worst member's verdict — the group is as healthy as its worst repo. */
  status: RowStatus<PoolKind>;
  /** Each member with its own verdict, in the same order as `members`. */
  entries: PoolEntry[];
  /** Worst member state: a group is measured only when every member is. */
  state: ObservationState;
  /**
   * OLDEST member `observed_at` — the group is only as fresh as its stalest
   * member. `null` when any member has none (undatable), never a newer
   * member's stamp standing in for it.
   */
  observedAt: string | null;
  openAlerts: (CiPoolAlertWire & { repo: string })[];
}

export function groupPools(pools: CiPoolWire[]): PoolGroup[] {
  const byPool = new Map<string, CiPoolWire[]>();
  for (const p of pools) {
    const list = byPool.get(p.pool) ?? [];
    list.push(p);
    byPool.set(p.pool, list);
  }
  const groups: PoolGroup[] = [];
  for (const [pool, members] of byPool) {
    members.sort((a, b) => a.repo.localeCompare(b.repo));
    const entries: PoolEntry[] = members.map((member) => ({
      member,
      status: poolRowStatus(member),
    }));
    let worst: PoolEntry | null = null;
    for (const e of entries) {
      if (
        worst === null ||
        ATTENTION_RANK[e.status.attention] >
          ATTENTION_RANK[worst.status.attention]
      ) {
        worst = e;
      }
    }
    if (worst === null) continue;
    const status: RowStatus<PoolKind> =
      members.length > 1
        ? {
            ...worst.status,
            reason: `${worst.member.repo}: ${worst.status.reason ?? ""}`,
          }
        : worst.status;
    let state: ObservationState = "measured";
    let observedAt: string | null = null;
    let anyUndated = false;
    for (const m of members) {
      const s = normalizeState(m.state);
      if (STATE_RANK[s] > STATE_RANK[state]) state = s;
      if (!m.observed_at || !Number.isFinite(Date.parse(m.observed_at))) {
        // Missing or unparseable: undatable, so the group is too.
        anyUndated = true;
      } else if (
        observedAt === null ||
        Date.parse(m.observed_at) < Date.parse(observedAt)
      ) {
        observedAt = m.observed_at;
      }
    }
    if (anyUndated) observedAt = null;
    const openAlerts = members.flatMap((m) =>
      (m.open_alerts ?? []).map((a) => ({ ...a, repo: m.repo }))
    );
    groups.push({
      pool,
      members,
      status,
      entries,
      state,
      observedAt,
      openAlerts,
    });
  }
  // Who must act first, then the label.
  groups.sort(
    (a, b) =>
      ATTENTION_RANK[b.status.attention] - ATTENTION_RANK[a.status.attention] ||
      a.pool.localeCompare(b.pool)
  );
  return groups;
}

export interface PoolCells {
  eligible: CellReading;
  registered: CellReading;
  drained: CellReading;
  queued: CellReading;
  oldest: CellReading;
  p90: CellReading;
}

/** Cells for one `(repo, pool)` member. */
export function poolMemberCells(row: CiPoolWire): PoolCells {
  const state = normalizeState(row.state);
  const reason = row.state_reason;
  // Eligibility is its own measurement: a measured queue with an unknown
  // eligibility verdict must not print a runner count.
  const eligState: ObservationState =
    state === "measured" && row.eligibility_state === "unknown"
      ? "unknown"
      : state;
  const eligReason =
    eligState === "unknown" && state === "measured"
      ? "the eligibility pass could not resolve this pool's runners"
      : reason;
  let oldest: CellReading;
  if (state === "measured" && row.queued_jobs === 0) {
    oldest = { text: "none queued", known: true, reason: null };
  } else {
    oldest = cell(row.oldest_queued_age_secs, state, reason, (n) =>
      row.threshold_secs !== null
        ? `${formatDuration(n)} / ${formatDuration(row.threshold_secs)}`
        : formatDuration(n)
    );
  }
  return {
    eligible: cell(row.eligible_runners, eligState, eligReason),
    registered: cell(row.eligible_registrations, eligState, eligReason),
    drained: cell(row.eligible_runners_drained, eligState, eligReason),
    queued: cell(row.queued_jobs, state, reason),
    oldest,
    p90: cell(row.p90_wait_secs, state, reason, formatDuration),
  };
}

/**
 * Cells for the pool group. Summed across members only when EVERY member is
 * measured: a sum over the measured subset would present a partial count as
 * the pool's total. Otherwise `–`, naming how many repos were not measured —
 * the per-repo detail still shows each measured member's own figures.
 */
export function poolGroupCells(group: PoolGroup): PoolCells {
  const only = group.members.length === 1 ? group.members[0] : undefined;
  if (only) return poolMemberCells(only);
  const memberCells = group.members.map(poolMemberCells);
  const notKnown = (pick: (c: PoolCells) => CellReading) =>
    memberCells.filter((c) => !pick(c).known).length;
  const sum = (
    pick: (c: PoolCells) => CellReading,
    value: (m: CiPoolWire) => number | null
  ): CellReading => {
    const missing = notKnown(pick);
    if (missing > 0) {
      return {
        text: DASH,
        known: false,
        reason: `${missing} of ${group.members.length} repos not measured — expand the row for each repo's own figure`,
      };
    }
    return {
      text: String(group.members.reduce((acc, m) => acc + (value(m) ?? 0), 0)),
      known: true,
      reason: null,
    };
  };
  const worstOf = (
    pick: (c: PoolCells) => CellReading,
    value: (m: CiPoolWire) => number | null,
    fmt: (n: number) => string
  ): CellReading => {
    const missing = notKnown(pick);
    if (missing > 0) {
      return {
        text: DASH,
        known: false,
        reason: `${missing} of ${group.members.length} repos not measured — expand the row for each repo's own figure`,
      };
    }
    const values = group.members
      .map(value)
      .filter((v): v is number => v !== null);
    if (values.length === 0)
      return { text: "none queued", known: true, reason: null };
    return { text: fmt(Math.max(...values)), known: true, reason: null };
  };
  return {
    eligible: sum(
      (c) => c.eligible,
      (m) => m.eligible_runners
    ),
    registered: sum(
      (c) => c.registered,
      (m) => m.eligible_registrations
    ),
    drained: sum(
      (c) => c.drained,
      (m) => m.eligible_runners_drained
    ),
    queued: sum(
      (c) => c.queued,
      (m) => m.queued_jobs
    ),
    oldest: worstOf(
      (c) => c.oldest,
      (m) => m.oldest_queued_age_secs,
      formatDuration
    ),
    p90: worstOf(
      (c) => c.p90,
      (m) => m.p90_wait_secs,
      formatDuration
    ),
  };
}

// ---------------------------------------------------------------------------
// Repos — main verdict, PR checks, candidate p90, the 24 h outcome split
// ---------------------------------------------------------------------------

export type RepoKind =
  | "main_red"
  | "main_unknown"
  | "main_vacuous"
  | "outcomes_unknown"
  | "checks_running"
  | "healthy";

/**
 * - `main_red` — AUTHOR. Main is failing its required checks; every PR on the
 *   repo is blocked behind it and only a fix lands it green.
 * - `main_unknown` — WAITING (ignorance floor): coord could not read main's
 *   verdict, or the CI-status read never landed for this repo.
 * - `main_vacuous` — WAITING (ignorance floor): `vacuously_green` — no
 *   required check has ever reported on main. Green would claim a pass that
 *   was never observed.
 * - `outcomes_unknown` — WAITING (ignorance floor): main is green, but the
 *   24 h job-outcome split is not measured, so "no infra failures" cannot be
 *   claimed.
 * - `checks_running` — none: open-PR checks in flight.
 * - `healthy` — none: main green, outcomes measured.
 */
export const CI_REPO_ATTENTION_BY_KIND = {
  main_red: "author",
  main_unknown: "waiting",
  main_vacuous: "waiting",
  outcomes_unknown: "waiting",
  checks_running: "none",
  healthy: "none",
} satisfies AttentionMap<RepoKind>;

export const CI_REPO_BADGE_CLASS: Record<RepoKind, string> = {
  main_red: AUTHOR_RED,
  main_unknown: UNKNOWN_AMBER,
  main_vacuous: UNKNOWN_AMBER,
  outcomes_unknown: UNKNOWN_AMBER,
  checks_running: CI_YELLOW,
  healthy: CLEAR_GREEN,
};

export const CI_REPO_AUTHOR_GLYPH_KINDS: ReadonlySet<RepoKind> =
  new Set<RepoKind>(["main_red"]);

export const CI_REPO_PALETTE: StatusPalette<RepoKind> = {
  badgeClass: CI_REPO_BADGE_CLASS,
  authorGlyphKinds: CI_REPO_AUTHOR_GLYPH_KINDS,
};

/** The economics read, as the repo rows need it. `byRepo: null` = no answer. */
export interface EconomicsRead {
  byRepo: Record<string, MergeEconomics> | null;
  asOf: string | null;
  /** The latest read failed (whatever is in `byRepo` is the last good one). */
  failed: boolean;
}

export interface OutcomeCells {
  pass: CellReading;
  content_fail: CellReading;
  infra_shaped: CellReading;
  neutral: CellReading;
  unknown: CellReading;
  /**
   * Hosted jobs GitHub never started (Phase 5a): `≥N` INFRA on `observed`,
   * otherwise `–` with the reason. Never `0`, never part of `content_fail`.
   */
  hosted: CellReading;
}

export interface RepoRowModel {
  repo: string;
  status: RowStatus<RepoKind>;
  ci: RepoCiRow | null;
  overview: CiRepoOverviewWire | null;
  mainVerdict: CellReading;
  mainObservedAt: string | null;
  prChecks: CellReading;
  prChecksObservedAt: string | null;
  candidateP90: CellReading;
  outcomes: OutcomeCells;
  outcomesState: ObservationState;
  windowHours: number | null;
  /** The outcome split's freshness (`last_observed_at`); null = unknown. */
  outcomesObservedAt: string | null;
  /** `false` = coord watches no pool for this repo; `null` = not reported. */
  poolsWatched: boolean | null;
  /** The pipeline Train tab, filtered to this repo — train blockers live there (D2). */
  trainHref: string;
}

export function trainHref(repo: string): string {
  return `/admin/coord/pipeline?tab=train&repo=${encodeURIComponent(repo)}`;
}

const MAIN_VERDICT_TEXT: Record<string, string> = {
  green: "green",
  red: "red",
  unknown: DASH,
  vacuously_green: DASH,
};

/** The proven cause, in an operator's words. */
export const BILLING_REFUSAL_TEXT =
  "GitHub Actions billing refusing hosted jobs";

/** A positive integer, or null — `hosted_refused` is never a 0 count. */
function refusedCount(h: CiHostedWire | null | undefined): number | null {
  if (!h || h.state !== "observed") return null;
  const n = h.hosted_refused;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

function billingSentence(b: CiBillingRefusalWire): string {
  return `Cause: ${BILLING_REFUSAL_TEXT} (Actions billing / spending limit — open ci_billing_refused alert ${b.alert_id} since ${b.opened_at}${b.last_seen_at ? `, last seen ${b.last_seen_at}` : ""}).`;
}

/**
 * The hosted cell (rule 4). A count only on `observed`, shown as the floor
 * it is (`≥N refused`) on the amber INFRA tone; every other state is `–`
 * with its reason. An open billing alert is surfaced in either case.
 */
export function hostedCell(h: CiHostedWire | null | undefined): CellReading {
  const billing = h?.billing_refusal ?? null;
  const note = h?.note?.trim() ? h.note.trim() : null;
  const n = refusedCount(h);
  if (n !== null) {
    const cause = billing
      ? billingSentence(billing)
      : "Cause not stored — no open billing alert names one.";
    return {
      text: `≥${n} refused${billing ? " (billing)" : ""}`,
      known: true,
      reason: null,
      tone: "infra",
      note: [
        `Hosted job refused — not a code failure. At least ${n} hosted job(s) GitHub never started in the window (a floor; not counted in content fail).`,
        h?.last_refused_at ? `Newest refusal ${h.last_refused_at}.` : null,
        cause,
        note,
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  const state = h?.state ?? null;
  const base =
    h === null || h === undefined
      ? "coord sent no hosted block for this repo — not measured"
      : state === "observed"
        ? "coord reported hosted refusals without a positive count — UNKNOWN, not 0"
        : state === "none_observed"
          ? `no hosted refusal observed — not a measured zero${note ? ` (${note})` : ""}`
          : state === "not_measured"
            ? `not measured — ${note ?? "hosted-only workflows are not sampled, so no hosted count exists"}`
            : `UNKNOWN — ${note ?? "coord could not read hosted job state"}`;
  return {
    text: DASH,
    known: false,
    reason: billing ? `${base}. ${billingSentence(billing)}` : base,
  };
}

export function outcomeCells(row: CiRepoOverviewWire | null): OutcomeCells {
  const hosted = hostedCell(row?.hosted);
  if (row === null) {
    const r =
      "coord's CI overview has no outcome row for this repo — not measured";
    const dash: CellReading = { text: DASH, known: false, reason: r };
    return {
      pass: dash,
      content_fail: dash,
      infra_shaped: dash,
      neutral: dash,
      unknown: dash,
      hosted,
    };
  }
  const state = normalizeState(row.state);
  const o = row.outcomes;
  const pick = (k: keyof CiOutcomesWire): CellReading =>
    o === null
      ? state === "measured"
        ? {
            text: DASH,
            known: false,
            reason: "coord reported no outcome counts for this window",
          }
        : {
            text: DASH,
            known: false,
            reason: stateReason(state, row.state_reason),
          }
      : cell(o[k], state, row.state_reason);
  return {
    pass: pick("pass"),
    content_fail: pick("content_fail"),
    infra_shaped: pick("infra_shaped"),
    neutral: pick("neutral"),
    unknown: pick("unknown"),
    hosted,
  };
}

export function repoRowStatus(
  repo: string,
  ci: RepoCiRow | null,
  overview: CiRepoOverviewWire | null
): RowStatus<RepoKind> {
  const make = (
    kind: RepoKind,
    label: string,
    reason: string
  ): RowStatus<RepoKind> => ({
    kind,
    label,
    reason,
    attention: CI_REPO_ATTENTION_BY_KIND[kind],
  });
  if (ci?.main_verdict === "red") {
    return make(
      "main_red",
      "main red",
      `${repo}'s main is failing a required check; PRs cannot land until it is fixed`
    );
  }
  if (
    ci === null ||
    ci.main_verdict === "unknown" ||
    !Object.hasOwn(MAIN_VERDICT_TEXT, ci.main_verdict)
  ) {
    return make(
      "main_unknown",
      "main unknown",
      ci === null
        ? "no CI-status row for this repo — main's verdict is unknown"
        : "coord could not read main's verdict — unknown, not green"
    );
  }
  if (ci.main_verdict === "vacuously_green") {
    return make(
      "main_vacuous",
      "no main baseline",
      "no required check has ever reported on main — green would be an absence of evidence, not a pass"
    );
  }
  const outcomesState = overview
    ? normalizeState(overview.state)
    : "never_observed";
  if (outcomesState !== "measured" || overview?.outcomes == null) {
    return make(
      "outcomes_unknown",
      "outcomes unknown",
      `main is green, but the 24 h job-outcome split is not measured (${overview ? stateReason(outcomesState, overview.state_reason) : "no outcome row"})`
    );
  }
  if (ci.open_pr_checks.pending > 0) {
    return make(
      "checks_running",
      "checks running",
      `main green; ${ci.open_pr_checks.pending} open-PR check(s) running`
    );
  }
  return make("healthy", "healthy", "main green; job outcomes measured");
}

function candidateP90(repo: string, economics: EconomicsRead): CellReading {
  if (economics.byRepo === null) {
    return {
      text: DASH,
      known: false,
      reason: economics.failed
        ? "the merge-economics read failed — unknown"
        : "merge economics not read yet — unknown",
    };
  }
  const e = economics.byRepo[repo];
  const p90 = e?.candidate_ci_p90_secs;
  if (p90 === null || p90 === undefined || !Number.isFinite(p90)) {
    return {
      text: DASH,
      known: false,
      reason: e
        ? "coord measured no merge-candidate CI run for this repo in its window"
        : "coord's merge economics has no row for this repo (or the read degraded to empty)",
    };
  }
  return { text: formatDuration(p90), known: true, reason: null };
}

export function buildRepoRows(
  overview: CiOverviewWire | null,
  ciRows: RepoCiRow[],
  economics: EconomicsRead
): RepoRowModel[] {
  const ciByRepo = new Map(ciRows.map((r) => [r.repo.toLowerCase(), r]));
  const ovByRepo = new Map(
    (overview?.repos ?? []).map((r) => [r.repo.toLowerCase(), r])
  );
  const names = new Map<string, string>();
  for (const r of ciRows) names.set(r.repo.toLowerCase(), r.repo);
  for (const r of overview?.repos ?? []) {
    if (!names.has(r.repo.toLowerCase()))
      names.set(r.repo.toLowerCase(), r.repo);
  }
  const rows: RepoRowModel[] = [];
  for (const [key, repo] of names) {
    const ci = ciByRepo.get(key) ?? null;
    const ov = ovByRepo.get(key) ?? null;
    const status = repoRowStatus(repo, ci, ov);
    const verdict = ci?.main_verdict;
    const mainVerdict: CellReading =
      verdict === "green" || verdict === "red"
        ? { text: verdict, known: true, reason: null }
        : {
            text: DASH,
            known: false,
            reason:
              verdict === "vacuously_green"
                ? "vacuously green — no required check has reported on main"
                : ci === null
                  ? "no CI-status row for this repo"
                  : "coord could not read main's verdict",
          };
    const prChecks: CellReading =
      ci === null
        ? { text: DASH, known: false, reason: "no CI-status row for this repo" }
        : {
            text: `${ci.open_pr_checks.failure} failing · ${ci.open_pr_checks.pending} pending · ${ci.open_pr_checks.success} passed`,
            known: true,
            reason: null,
          };
    rows.push({
      repo,
      status,
      ci,
      overview: ov,
      mainVerdict,
      mainObservedAt: ci?.main_verdict_observed_at ?? null,
      prChecks,
      prChecksObservedAt: ci?.pr_checks_observed_at ?? null,
      candidateP90: candidateP90(repo, economics),
      outcomes: outcomeCells(ov),
      outcomesState: ov ? normalizeState(ov.state) : "never_observed",
      windowHours: ov?.window_hours ?? null,
      outcomesObservedAt: ov?.last_observed_at ?? null,
      poolsWatched: ov?.pools_watched ?? null,
      trainHref: trainHref(repo),
    });
  }
  rows.sort(
    (a, b) =>
      ATTENTION_RANK[b.status.attention] - ATTENTION_RANK[a.status.attention] ||
      a.repo.localeCompare(b.repo)
  );
  return rows;
}

// ---------------------------------------------------------------------------
// The health strip (R1) — derived from the reads already on the page
// ---------------------------------------------------------------------------

/** The CI overview read as the strip needs it. */
export interface OverviewRead {
  /** The last good body, or `null` if none ever landed. */
  data: CiOverviewWire | null;
  /** The LATEST read failed (or answered unusably). */
  failed: boolean;
  /** Why, in words, when `failed`. */
  failureText: string | null;
}

/** The CI-status stream as the strip needs it. */
export interface CiStatusRead {
  rows: RepoCiRow[];
  /** A REST seed has succeeded at least once. */
  seeded: boolean;
  /** The last seed / WS error, or null. */
  error: string | null;
}

/** The verdict before it is painted: `unknown` is its own answer, not amber's. */
export type CiHealthLevel = "red" | "amber" | "green" | "unknown";

export interface CiHealth {
  level: CiHealthLevel;
  headline: string;
  detail: string | null;
  badges: HealthBadge[];
  /** Pool groups, derived once and shared with the Pools panel. */
  pools: PoolGroup[];
}

/**
 * The strip paints `unknown` amber — R3's ignorance floor — while the verdict
 * itself stays distinguishable (`data-ci-health` on the page, and in tests).
 */
export function stripLevel(level: CiHealthLevel): HealthStripLevel {
  return level === "unknown" ? "amber" : level;
}

function countBadge(
  key: string,
  label: string,
  n: number | null,
  tone: HealthBadge["tone"],
  title?: string
): HealthBadge {
  return {
    key,
    label: `${label} ${n === null ? DASH : n}`,
    tone,
    title,
    "data-testid": `ci-health-badge-${key}`,
  };
}

/** Sum a measured outcome across repos; `null` if ANY repo is unmeasured. */
function sumOutcome(
  overview: CiOverviewWire,
  k: keyof CiOutcomesWire
): { value: number | null; unmeasured: number } {
  let total = 0;
  let unmeasured = 0;
  for (const r of overview.repos) {
    if (normalizeState(r.state) !== "measured" || r.outcomes === null) {
      unmeasured++;
      continue;
    }
    total += r.outcomes[k];
  }
  return {
    value: unmeasured > 0 || overview.repos.length === 0 ? null : total,
    unmeasured,
  };
}

/** The strip's view of every repo's hosted block (rule 4). */
export interface HostedSummary {
  /** Sum of the observed floors; null when no repo is `observed`. A FLOOR. */
  refusedFloor: number | null;
  /** Repos with an `observed` positive count. */
  refusedRepos: string[];
  /** Repos with an open `ci_billing_refused` alert (any hosted state). */
  billingRepos: string[];
  /** Repos whose hosted block is `unknown` (or a state this build does not know). */
  unknownRepos: string[];
}

export function hostedSummary(data: CiOverviewWire | null): HostedSummary {
  let floor = 0;
  const refusedRepos: string[] = [];
  const billingRepos: string[] = [];
  const unknownRepos: string[] = [];
  for (const r of data?.repos ?? []) {
    const n = refusedCount(r.hosted);
    if (n !== null) {
      floor += n;
      refusedRepos.push(r.repo);
    }
    if (r.hosted?.billing_refusal) billingRepos.push(r.repo);
    const st = r.hosted?.state;
    if (n === null && st !== "none_observed" && st !== "not_measured")
      unknownRepos.push(r.repo);
  }
  return {
    refusedFloor: refusedRepos.length > 0 ? floor : null,
    refusedRepos,
    billingRepos,
    unknownRepos,
  };
}

function reposText(repos: string[]): string {
  return repos.length === 1 && repos[0] ? repos[0] : `${repos.length} repos`;
}

/**
 * The strip's hosted badge. Tone: `waiting` (amber), never `attention` (red).
 * Why amber, for a cause the operator has to fix (billing): R3's red is
 * reserved here for a CURRENT, measured reading that names content or a stuck
 * pool. A hosted refusal count is a 24 h WINDOW floor — it says refusals
 * happened, not that one is happening now — and a spending-limit refusal
 * clears itself at the billing-cycle rollover; where no billing alert names
 * the cause, the badge is also amber's "we do not know" floor. Above all it
 * must never read as content red: it is never folded into the content-fail
 * badge, the main-red count, or `infra_shaped` (self-hosted only).
 */
export function hostedBadge(h: HostedSummary): HealthBadge {
  const billing = h.billingRepos.length > 0;
  if (h.refusedFloor !== null || billing) {
    const n = h.refusedFloor === null ? DASH : `≥${h.refusedFloor}`;
    return {
      key: "hosted",
      label: billing ? `billing refusing hosted ${n}` : `hosted refused ${n}`,
      tone: "waiting",
      title: [
        h.refusedFloor !== null
          ? `Hosted job refused — not a code failure. At least ${h.refusedFloor} hosted job(s) GitHub never started in 24 h on ${reposText(h.refusedRepos)} (a floor; NOT counted in content fail).`
          : "No hosted refusal count was observed — a dash, not a zero.",
        billing
          ? `${BILLING_REFUSAL_TEXT} on ${reposText(h.billingRepos)} (open ci_billing_refused alert — Actions billing / spending limit).`
          : "Cause not stored — no open billing alert names one.",
      ].join(" "),
      "data-testid": "ci-health-badge-hosted",
    };
  }
  return {
    key: "hosted",
    label: `hosted ${DASH}`,
    tone: "muted",
    title:
      h.unknownRepos.length > 0
        ? `Hosted refusals UNKNOWN for ${reposText(h.unknownRepos)} — a dash, not a zero.`
        : "No hosted refusal observed — not a measured zero. Never a count of 0.",
    "data-testid": "ci-health-badge-hosted",
  };
}

/** The hosted infra sentence the strip adds to its detail, or null. */
function hostedDetail(h: HostedSummary): string | null {
  if (h.billingRepos.length > 0) {
    return `${BILLING_REFUSAL_TEXT} on ${reposText(h.billingRepos)} — infra (Actions billing / spending limit), not a code failure${h.refusedFloor !== null ? `; ≥${h.refusedFloor} hosted job(s) refused in 24 h` : ""}.`;
  }
  if (h.refusedFloor !== null) {
    return `≥${h.refusedFloor} hosted job(s) refused in 24 h on ${reposText(h.refusedRepos)} — infra, not a code failure; cause not stored.`;
  }
  return null;
}

/**
 * The strip verdict. Hosted refusals (rule 4) never move red and never touch
 * the content counts: they add their sentence to the detail of whatever arm
 * fired, and they hold an otherwise-green strip at amber, naming the cause —
 * a strip is not "healthy" while GitHub is refusing hosted jobs.
 */
export function deriveCiHealth(
  overview: OverviewRead,
  ciStatus: CiStatusRead,
  now: number
): CiHealth {
  const base = deriveCiHealthCore(overview, ciStatus, now);
  const h = hostedSummary(overview.data);
  const sentence = hostedDetail(h);
  if (sentence === null) return base;
  if (base.level === "green") {
    return {
      ...base,
      level: "amber",
      headline:
        h.billingRepos.length > 0
          ? `${BILLING_REFUSAL_TEXT} on ${reposText(h.billingRepos)} — infra, not a code failure`
          : `Hosted jobs refused on ${reposText(h.refusedRepos)} (≥${h.refusedFloor} in 24 h) — infra, not a code failure`,
      detail: `${sentence} Otherwise: ${base.headline}.`,
    };
  }
  return {
    ...base,
    detail: [base.detail, sentence].filter(Boolean).join(" "),
  };
}

function deriveCiHealthCore(
  overview: OverviewRead,
  ciStatus: CiStatusRead,
  // The page clock (ms). The row verdicts are coord's (`state` is computed
  // server-side against `stale_after_secs`); `now` only ages the read itself.
  now: number
): CiHealth {
  const data = overview.data;
  if (data === null) {
    return {
      level: "unknown",
      headline: overview.failed
        ? "CI health UNKNOWN — coord's CI overview could not be read"
        : "Reading CI state from coord…",
      detail: overview.failed ? overview.failureText : null,
      badges: [countBadge("pools", "pools", null, "muted")],
      pools: [],
    };
  }

  const pools = groupPools(data.pools);
  const entries = pools.flatMap((g) => g.entries);
  const stuck = entries.filter(({ status }) => status.attention === "author");
  const nonMeasured = data.pools.filter(
    (p) => normalizeState(p.state) !== "measured"
  );
  const requiredNull = data.pools.filter((p) => p.required === null);
  const waiting = entries.filter(
    ({ status }) => status.attention === "waiting"
  );
  const mainRed = ciStatus.rows.filter((r) => r.main_verdict === "red");

  const contentFail = sumOutcome(data, "content_fail");
  const infra = sumOutcome(data, "infra_shaped");
  // Open alerts on pools coord holds NO current reading of. Never red (no
  // reading can confirm them), never ignored (they disqualify green).
  const unattached = unattachedAlerts(data);
  const unattachedText = unattached.map(
    (a) =>
      `Open alert on ${a.repo} ${poolLabel(a.pool)} with no current pool reading: ${alertAgeText(a)}.`
  );

  const badges: HealthBadge[] = [
    countBadge("pools", "pools", pools.length, "muted"),
  ];
  if (stuck.length > 0)
    badges.push(countBadge("stuck", "stuck", stuck.length, "attention"));
  if (nonMeasured.length > 0) {
    badges.push(
      countBadge(
        "unknown",
        "not measured",
        nonMeasured.length,
        "muted",
        "Pool rows whose state is stale or unknown — their figures render –, never 0."
      )
    );
  }
  if (unattached.length > 0) {
    badges.push(
      countBadge(
        "unattached-alerts",
        "alerts unconfirmed",
        unattached.length,
        "muted",
        "Open alerts on pools coord holds no current reading of — their numbers are from when they fired, and nothing confirms or clears them. UNKNOWN, not stuck."
      )
    );
  }
  if (mainRed.length > 0)
    badges.push(
      countBadge("main-red", "main red", mainRed.length, "attention")
    );
  // Content and infra are ALWAYS separate badges (rule 3). Each dashes when
  // any repo's split is unmeasured — a partial sum is not the total.
  badges.push(
    countBadge(
      "content-fail",
      "content fail 24h",
      contentFail.value,
      "default",
      contentFail.value === null
        ? `Not measured for ${contentFail.unmeasured} repo(s) — a dash, not a zero. Self-hosted jobs only.`
        : "Jobs that failed in a step — a code failure. Self-hosted jobs only; infra-shaped failures are NOT counted here."
    ),
    countBadge(
      "infra",
      "infra-shaped 24h",
      infra.value,
      "default",
      infra.value === null
        ? `Not measured for ${infra.unmeasured} repo(s) — a dash, not a zero.`
        : "Jobs that failed with zero failed steps (runner died, refused, billing) — not a code failure."
    ),
    hostedBadge(hostedSummary(data))
  );

  // The read itself ages by the page clock: a failed refresh, an as_of older
  // than three polls, or no as_of at all (undatable) each make the rows a
  // last-known reading rather than a current one.
  const asOfMs = data.as_of ? Date.parse(data.as_of) : NaN;
  const readAgeSecs = Number.isFinite(asOfMs) ? (now - asOfMs) / 1000 : null;
  const readTooOld =
    readAgeSecs === null || readAgeSecs > CI_OVERVIEW_STALE_AFTER_SECS;
  const staleRead = overview.failed || readTooOld;
  const readQualifier = overview.failed
    ? `Last overview refresh failed${overview.failureText ? ` (${overview.failureText})` : ""} — rows are from the read at ${data.as_of ?? "an unknown time"}, not current.`
    : readTooOld
      ? readAgeSecs === null
        ? "Coord's overview carried no as_of, so how current these rows are is unknown."
        : `The overview read is ${formatDuration(readAgeSecs)} old — older than three polls, not current.`
      : null;
  const ciStatusQualifier = !ciStatus.seeded
    ? `CI-status read has not landed${ciStatus.error ? ` (${ciStatus.error})` : ""} — main verdicts are unknown.`
    : ciStatus.error
      ? `CI-status refresh failed (${ciStatus.error}) — main verdicts may be stale.`
      : null;
  const qualifiers = [readQualifier, ciStatusQualifier]
    .filter(Boolean)
    .join(" ");

  // RED — someone must act now, but only off a CURRENT read. On a stale or
  // failed overview read the last good read's "stuck" is reported as what it
  // is — a past reading — at UNKNOWN; the stuck badge stays so the count is
  // not lost (R6's stale arm keeps counts; the dot says what is true NOW).
  const firstStuck = stuck[0];
  if (firstStuck) {
    const { status: s, member: m } = firstStuck;
    const more = stuck.length > 1 ? ` (+${stuck.length - 1} more)` : "";
    const what =
      s.kind === "no_eligible_runner"
        ? `has 0 eligible runners${m.queued_jobs !== null ? `, ${m.queued_jobs} queued` : ""}${m.oldest_queued_age_secs !== null ? `, oldest ${formatDuration(m.oldest_queued_age_secs)}` : ""}`
        : `queue stalled${queueSummary(m) ? ` — ${queueSummary(m)}` : ""}`;
    if (staleRead) {
      return {
        level: "unknown",
        headline: `Last read showed ${poolLabel(m.pool)} on ${m.repo} ${what}${more} — not current`,
        detail: qualifiers || null,
        badges,
        pools,
      };
    }
    return {
      level: "red",
      headline: `Stuck: ${poolLabel(m.pool)} on ${m.repo} ${what}${more}`,
      detail: qualifiers || null,
      badges,
      pools,
    };
  }
  if (mainRed.length > 0) {
    const where =
      mainRed.length === 1 && mainRed[0]
        ? mainRed[0].repo
        : `${mainRed.length} repos`;
    // The verdicts come from the CI-status read; when its latest refresh
    // failed (or it never seeded) they are the last good read, not now.
    if (ciStatus.error || !ciStatus.seeded) {
      return {
        level: "unknown",
        headline: `Last read showed main red on ${where} — not current`,
        detail: qualifiers || null,
        badges,
        pools,
      };
    }
    return {
      level: "red",
      headline: `Main is red on ${where}`,
      detail: qualifiers || null,
      badges,
      pools,
    };
  }

  // UNKNOWN — the ignorance floor. Every arm here disqualifies green.
  if (pools.length === 0) {
    return {
      level: "unknown",
      headline:
        "CI capacity UNKNOWN — coord has no pool observations for this tenant",
      detail:
        [data.note, ...unattachedText, qualifiers].filter(Boolean).join(" ") ||
        "No pool has ever been observed; that is no measurement, not an idle fleet.",
      badges,
      pools,
    };
  }
  const first = nonMeasured[0];
  if (first) {
    const poolsAffected = new Set(nonMeasured.map((p) => p.pool)).size;
    const reason = stateReason(normalizeState(first.state), first.state_reason);
    // Open alerts on these pools are reported, with their age, as what they
    // are — fire-time claims nothing currently confirms — never as "Stuck".
    const unconfirmed = nonMeasured.flatMap((p) =>
      (p.open_alerts ?? []).map(
        (a) =>
          `Open alert on ${p.repo} ${poolLabel(p.pool)}, not confirmed by a current reading: ${alertAgeText(a)}.`
      )
    );
    return {
      level: "unknown",
      headline: `CI capacity UNKNOWN for ${poolsAffected} pool${poolsAffected === 1 ? "" : "s"} — ${reason}`,
      detail:
        [...unconfirmed, ...unattachedText, qualifiers]
          .filter(Boolean)
          .join(" ") || null,
      badges,
      pools,
    };
  }
  if (unattached.length > 0) {
    return {
      level: "unknown",
      headline: `CI health UNKNOWN — ${unattached.length} open alert${unattached.length === 1 ? "" : "s"} with no current pool reading`,
      detail: [...unattachedText, qualifiers].filter(Boolean).join(" ") || null,
      badges,
      pools,
    };
  }
  if (requiredNull.length > 0) {
    const poolsAffected = new Set(requiredNull.map((p) => p.pool)).size;
    return {
      level: "unknown",
      headline: `CI health UNKNOWN — whether ${poolsAffected} pool${poolsAffected === 1 ? " is" : "s are"} on a required path is unknown`,
      detail:
        [requiredNull[0]?.required_note, qualifiers]
          .filter(Boolean)
          .join(" ") || null,
      badges,
      pools,
    };
  }
  // Repos: green also needs every repo's own row to be known — a CI-status
  // row, a green/red main, and a measured outcome split. A repo the strip
  // cannot vouch for would otherwise sit as a `–` badge beside a green dot.
  const repoNames = new Map<string, string>();
  for (const r of ciStatus.rows) repoNames.set(r.repo.toLowerCase(), r.repo);
  for (const r of data.repos) {
    if (!repoNames.has(r.repo.toLowerCase()))
      repoNames.set(r.repo.toLowerCase(), r.repo);
  }
  const ciByRepo = new Map(ciStatus.rows.map((r) => [r.repo.toLowerCase(), r]));
  const ovByRepo = new Map(data.repos.map((r) => [r.repo.toLowerCase(), r]));
  const unknownRepos = [...repoNames.entries()]
    .map(([key, name]) =>
      repoRowStatus(name, ciByRepo.get(key) ?? null, ovByRepo.get(key) ?? null)
    )
    .filter((st) => st.attention !== "none");

  if (staleRead || !ciStatus.seeded || ciStatus.error) {
    return {
      level: "unknown",
      headline: staleRead
        ? "CI health UNKNOWN — showing the last good read, not current"
        : "CI health UNKNOWN — main verdicts not read",
      detail: qualifiers || null,
      badges,
      pools,
    };
  }

  const firstUnknownRepo = unknownRepos[0];
  if (repoNames.size === 0) {
    return {
      level: "unknown",
      headline:
        "CI health UNKNOWN — no repo has a CI-status or outcome row to vouch for",
      detail: data.note ?? null,
      badges,
      pools,
    };
  }
  if (firstUnknownRepo) {
    return {
      level: "unknown",
      headline: `CI health UNKNOWN for ${unknownRepos.length} repo${unknownRepos.length === 1 ? "" : "s"} — ${firstUnknownRepo.reason ?? firstUnknownRepo.label}`,
      detail: null,
      badges,
      pools,
    };
  }

  // AMBER — waiting on something that clears itself.
  const firstWaiting = waiting[0];
  if (firstWaiting) {
    const { status: s, member: m } = firstWaiting;
    return {
      level: "amber",
      headline: `Waiting: ${poolLabel(m.pool)} on ${m.repo} — ${s.reason ?? s.label}${waiting.length > 1 ? ` (+${waiting.length - 1} more)` : ""}`,
      detail: null,
      badges,
      pools,
    };
  }
  const anyQueued = entries.some(({ member }) => (member.queued_jobs ?? 0) > 0);
  return {
    level: "green",
    headline: `CI healthy — ${pools.length} pool${pools.length === 1 ? "" : "s"} measured, no queue over bound${anyQueued ? "" : ", nothing queued"}`,
    detail: null,
    badges,
    pools,
  };
}
