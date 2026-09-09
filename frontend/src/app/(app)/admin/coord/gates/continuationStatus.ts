/**
 * continuationStatus — the derived state of one gate's CONTINUATION, and R3's
 * audited severity table for it.
 *
 * Plan `2026-09-09-continuation-dispatch-fails-silently-three-times-in-four`
 * Phase 1. Sibling of `gateStatus.ts` and built the same way: the derivation is
 * a pure, unit-tested module (R8), the vocabulary is a CLOSED union so
 * `paletteDisagreements` has something total to audit (R3), and every colour
 * comes from `console/statusRow`'s exported families rather than a fresh
 * literal (§4.1).
 *
 * ## Why this module exists
 *
 * coord has projected the whole continuation lifecycle on its gate reads for
 * months — `continuation_consumed_outcome`, `continuation_deferred_count`,
 * `continuation_deferred_reason`, and the dispatched/consumed/cancelled/
 * deferred/expired stamps — and the console rendered NONE of it. Two
 * populations were therefore invisible on a surface whose entire job is to
 * show them:
 *
 * - **21 gates whose outcome begins `spawn_failed: no Tauri AppHandle (runner
 *   has no webview runtime) — cannot open a visible terminal`.** Those rows
 *   also carry `continuation_consumed_at`, so every reader that asks "was this
 *   consumed?" answers *yes* and the failure disappears. A consumed
 *   continuation that FAILED must not read like one that worked.
 * - **41 gates carrying 1021 deferrals between them — median 27, max 58.** A
 *   continuation pushed back 58 times was indistinguishable from one pushed
 *   back once.
 *
 * ## The reading of each outcome word, and the one that is NOT success
 *
 * `continuation_consumed_outcome` is written by TWO producers and coord's own
 * `normalize_consume_outcome` documents the split. The runner writes the
 * `spawn*` pair the instant the spawn attempt resolves and never revises it, so
 * it answers only *"did a process start?"*. The continuation session itself
 * writes the `work_*` triple later, and answers *"did the work happen?"* — it
 * may supersede a `spawned` exactly once.
 *
 * So **`spawned` is not a success reading**. It says a process started and the
 * work outcome was never reported: either the session is still running (and
 * will supersede it) or it went quiet. That is an open question, and R3's
 * amber — "waiting on something else, it will clear itself" — is the honest
 * hue for it. Painting it green would re-create precisely the invisibility this
 * module was written to remove.
 *
 * A NULL outcome on a consumed row is one step worse and is rendered as its own
 * kind ({@link ContinuationKind} `consumed_silent`): the runner claimed the
 * continuation and never said what came of it. It must not read as success and
 * it must not read as failure — we have no claim either way, so it takes the
 * ignorance floor (`UNKNOWN_AMBER`), never green and never red.
 *
 * ## The three escalations, and where their numbers come from
 *
 * All three mirror `prPipeline`'s `blocked` → `blocked-stale` move: a WAITING
 * state is a promise that something else will clear the row, and once the
 * premise of that promise is demonstrably false the row goes red. Every waiting
 * reading whose premise is CHECKABLE gets checked — a promise nobody audits is
 * the same defect as a failure nobody renders.
 *
 * - `dispatched` → `dispatch_stalled` at {@link DISPATCH_STALE_MS} (15
 *   minutes, the window the retired `summarizeContinuationLifecycle` used).
 *   Only fires when NO deferral explains the silence — a deferred row has a
 *   stated reason and is reported as deferred instead of as unexplained.
 * - `deferred` → `deferral_stuck` at {@link DEFERRAL_STUCK_COUNT}. The runner
 *   rate-limits the deferred stamp to **once per hour per gate**
 *   (`should_post_deferred_stamp`, `agent_runtime.rs`), so a count of N is a
 *   FLOOR on N hours of refusal, and 24 is a full day of a machine saying no.
 *   Past that the retry loop is demonstrably not getting there.
 * - `deferred` → `deferral_abandoned` at {@link DEFERRAL_SILENT_MS}, on the AGE
 *   of the last deferral rather than on its count. The count answers "how hard
 *   is this being refused"; it cannot answer "is anyone still asking". Without
 *   this arm a row dispatched 16 minutes ago and never acked read red while one
 *   dispatched six days ago, deferred twice six days ago and pulled by nobody
 *   since read calm amber over a reason string promising it was still
 *   "re-deliverable" — and nothing contradicted that until coord's 7-day TTL
 *   sweep.
 *
 * Silence wins over count when both fire: "nothing is pulling this any more" is
 * the fact that changes what the operator does, and a 58-count row gone quiet
 * needs a different fix from a 58-count row still being actively refused. The
 * count wins when the deferral TIME is missing, though — that test needs no
 * timestamp, and letting ignorance about *when* erase a judgement that never
 * depended on it would put a row BELOW the evidence, which is the ignorance
 * floor upside down.
 *
 * All of that applies only to a deferral belonging to the dispatch currently in
 * flight. coord re-stamps `continuation_dispatched_at` on re-dispatch and never
 * clears the deferral columns, so a deferral older than the dispatch is a
 * previous cycle's and decides nothing about this one.
 *
 * None of the three is a liveness claim: nothing here probes a device. Each
 * reads a stamp coord holds against a cadence the producer documents, and the
 * operator judges — the same discipline `gateStatus`'s `stale` reading takes.
 */

import type { Attention } from "@/components/console/attention";
import type { RowStatus, StatusPalette } from "@/components/console/statusRow";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
} from "@/components/console/statusRow";

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/**
 * A dispatched-but-unconsumed continuation older than this reads as
 * `dispatch_stalled` rather than `dispatched`.
 *
 * 15 minutes, carried over from the (never-rendered)
 * `summarizeContinuationLifecycle` this module replaces. The signal is AGE, not
 * device liveness — the console wires no liveness feed and must never claim
 * one.
 */
export const DISPATCH_STALE_MS = 15 * 60 * 1_000;

/**
 * Deferrals at or above this count read as `deferral_stuck` (red) instead of
 * `deferred` (amber).
 *
 * The runner stamps a deferral at most once per hour per gate, so 24 is a floor
 * on a full day of the target machine refusing the spawn. Against the observed
 * production population (median 27, max 58) this splits the genuinely-wedged
 * continuations from the ones riding out a transient — which is the whole
 * distinction the plan says is missing.
 */
export const DEFERRAL_STUCK_COUNT = 24;

/**
 * A deferred, unconsumed continuation whose LAST deferral is older than this
 * reads as `deferral_abandoned` (red) instead of `deferred` (amber) — however
 * few times it was pushed back.
 *
 * Amber's promise on a deferred row is *"a runner is still pulling this and
 * will retry"*, and that promise has a measurable heartbeat. The runner's
 * backstop re-lists a deferred row every ~300s
 * (`CONTINUATION_BACKSTOP_POLL_SECS_DEFAULT`) and stamps a deferral at most
 * once an hour per gate (`CONTINUATION_DEFERRED_STAMP_INTERVAL =
 * Duration::from_secs(3600)`, qontinui-runner `agent_runtime.rs`). So while
 * ANY runner is still pulling the row, `continuation_deferred_at` refreshes at
 * least hourly. A `deferred_at` much older than that means nothing is pulling
 * it any more — which is `dispatch_stalled`'s condition with a reason attached,
 * and amber is then asserting a premise that is false.
 *
 * **Three hours = three stamp intervals.** The post is best-effort (the runner
 * swallows any non-2xx or transport error), so ONE missed hour is plausibly a
 * transient coord blip and must not turn a healthy row red. Three consecutive
 * misses is not: a row still being pulled had three opportunities to refresh
 * this stamp and took none. It is deliberately far tighter than coord's own
 * `ttl_7d_elapsed` sweep, which is what used to be the only thing that ever
 * contradicted the amber.
 *
 * Longer than {@link DISPATCH_STALE_MS} on purpose. That window asks "has any
 * runner EVER acked this?", where 15 minutes of total silence is already
 * damning. This one asks "has the runner that WAS acking stopped?", and the
 * honest bar for declaring a demonstrated puller gone is the loss of a signal
 * whose cadence we know.
 */
export const DEFERRAL_SILENT_MS = 3 * 60 * 60 * 1_000;

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * The continuation vocabulary the row renders. Closed on purpose: coord's
 * outcome column is free TEXT with a documented producer vocabulary, and a
 * palette cannot be audited against an open one. Anything unreadable
 * normalises to `unknown` exactly once, here.
 */
export type ContinuationKind =
  | "armed"
  | "inert"
  | "dispatched"
  | "dispatch_stalled"
  | "deferred"
  | "deferral_stuck"
  | "deferral_abandoned"
  | "spawned"
  | "work_completed"
  | "work_abandoned"
  | "work_unreported"
  | "spawn_failed"
  | "consumed_silent"
  | "cancelled"
  | "expired"
  | "unknown";

/**
 * The audited kind → attention table. TOTAL over {@link ContinuationKind}, one
 * documented row each:
 *
 * | kind | attention | why |
 * |---|---|---|
 * | `armed` | `none` | A continuation is attached and will fire when the anchor clears. The normal, healthy resting state of an open gate. |
 * | `inert` | `none` | Attached, but coord's own `continuation_will_dispatch` says clearing dispatches nothing (a `notify_only` payload). Correct behaviour, not a lost dispatch — so calm, and visibly different from `armed` so nobody reads a safety net that is not there. |
 * | `dispatched` | `none` | coord emitted it and a runner has not yet acked. In flight; nobody is blocked. |
 * | `dispatch_stalled` | `author` | Emitted, unconsumed past {@link DISPATCH_STALE_MS}, and NO deferral explains it. Nothing retries it into existence; a human decides. |
 * | `deferred` | `waiting` | A runner saw it and pushed back with a stated reason (thread pressure, a cap, a duplicate anchor). The row stays pending and re-deliverable — this is exactly amber's promise. |
 * | `deferral_stuck` | `author` | Pushed back {@link DEFERRAL_STUCK_COUNT}+ times and still being pushed back. The promise amber makes is demonstrably not being kept. |
 * | `deferral_abandoned` | `author` | Deferred, unconsumed, and the last deferral is older than {@link DEFERRAL_SILENT_MS}. Amber's premise on a deferred row is that a runner is still pulling it, and that has a known heartbeat; past three stamp intervals nothing is pulling it any more. Same condition as `dispatch_stalled`, with a reason attached. |
 * | `spawned` | `waiting` | A process started; the work outcome was **never reported**. Not success — see the module header. The session may still supersede it, which is what makes this amber rather than red. |
 * | `work_completed` | `none` | The continuation session reported it finished the work. The ONLY success reading in this vocabulary. |
 * | `work_abandoned` | `author` | The session reported it gave up. The work the gate existed for did not happen. |
 * | `work_unreported` | `waiting` | The runner's PTY-exit fallback: the session ended without reporting. A statement of ignorance about a terminal process — R3's ignorance floor, never green and never red. |
 * | `spawn_failed` | `author` | The runner consumed it and no session opened. The 21-row population this plan exists for; it was reading as "consumed". |
 * | `consumed_silent` | `waiting` | Consumed, outcome never claimed. Worse than a recorded `spawn_failed` — but we hold no claim either way, so it takes the ignorance floor rather than borrowing red. |
 * | `cancelled` | `none` | Somebody withdrew it, and coord had NOT already expired it. A CHOICE, terminal, costs nobody anything — the same reading `gateStatus` gives `withdrawn`. |
 * | `expired` | `author` | coord's stall watcher gave up on it: it will never dispatch. Nothing re-arms it on its own. Beats `cancelled` when both stamps are present. |
 * | `unknown` | `waiting` | An outcome string this build has no reading for. R3's ignorance floor. |
 *
 * Note `dispatched` is `none` while `spawned` is `waiting`, which looks
 * backwards until you read what each is waiting ON. `dispatched` waits on a
 * runner to pick the row up, which is ordinary queueing and by far the most
 * common in-flight state. `spawned` waits on a claim about whether the WORK
 * happened — the claim this plan exists because nobody was making.
 */
export const CONTINUATION_ATTENTION_BY_KIND: Record<
  ContinuationKind,
  Attention
> = {
  armed: "none",
  inert: "none",
  dispatched: "none",
  dispatch_stalled: "author",
  deferred: "waiting",
  deferral_stuck: "author",
  deferral_abandoned: "author",
  spawned: "waiting",
  work_completed: "none",
  work_abandoned: "author",
  work_unreported: "waiting",
  spawn_failed: "author",
  consumed_silent: "waiting",
  cancelled: "none",
  expired: "author",
  unknown: "waiting",
};

/** In-flight and nobody is blocked — the same blue `prPipeline` gives `landing`. */
const IN_MOTION_BLUE = "bg-blue-500/15 text-blue-200 border-blue-500/30";
/** The one success reading. */
const DONE_GREEN = "bg-green-500/15 text-green-200 border-green-500/30";
/** Terminal and deliberate — the dashed "not in play" treatment. */
const NOT_IN_PLAY =
  "bg-transparent text-muted-foreground border-border border-dashed";

export const CONTINUATION_KIND_CLASS: Record<ContinuationKind, string> = {
  armed: INERT,
  inert: NOT_IN_PLAY,
  dispatched: IN_MOTION_BLUE,
  dispatch_stalled: AUTHOR_RED,
  deferred: WAITING_AMBER,
  deferral_stuck: AUTHOR_RED,
  deferral_abandoned: AUTHOR_RED,
  spawned: UNKNOWN_AMBER,
  work_completed: DONE_GREEN,
  work_abandoned: AUTHOR_RED,
  work_unreported: UNKNOWN_AMBER,
  spawn_failed: AUTHOR_RED,
  consumed_silent: UNKNOWN_AMBER,
  cancelled: NOT_IN_PLAY,
  expired: AUTHOR_RED,
  unknown: UNKNOWN_AMBER,
};

/** Red ⇔ the colourblind-safe `✕`: exactly the `author` kinds, derived. */
export const CONTINUATION_AUTHOR_GLYPH_KINDS: ReadonlySet<ContinuationKind> =
  new Set(
    (Object.keys(CONTINUATION_ATTENTION_BY_KIND) as ContinuationKind[]).filter(
      (k) => CONTINUATION_ATTENTION_BY_KIND[k] === "author"
    )
  );

/**
 * The kinds whose whole content is *"we do not know whether the work
 * happened"*, as opposed to the ones that are merely waiting on a runner.
 *
 * This is the population the plan calls invisible, and it is a SET rather than
 * `attention === "waiting"` because the two differ by exactly the deferral
 * kinds: a deferred continuation has a stated reason and a live retry loop, so
 * it is waiting on something nameable, while these four are silence. The gates
 * table counts and filters on this directly.
 */
export const CONTINUATION_UNKNOWN_OUTCOME_KINDS: ReadonlySet<ContinuationKind> =
  new Set<ContinuationKind>([
    "spawned",
    "work_unreported",
    "consumed_silent",
    "unknown",
  ]);

export const CONTINUATION_STATUS_PALETTE: StatusPalette<ContinuationKind> = {
  badgeClass: CONTINUATION_KIND_CLASS,
  authorGlyphKinds: CONTINUATION_AUTHOR_GLYPH_KINDS,
  // `work_completed` alone. `spawned` deliberately does NOT get the ✓ — the
  // glyph would restate exactly the success claim the module header refuses.
  doneGlyphKinds: new Set<ContinuationKind>(["work_completed"]),
};

// ---------------------------------------------------------------------------
// The deferral reason grammar
// ---------------------------------------------------------------------------

/**
 * The COMPLETE `continuation_deferred_reason` vocabulary, transcribed from its
 * producer's own table (`post_continuation_deferred`, qontinui-runner
 * `agent_runtime.rs`) — every stamp comes from one of four constructors:
 *
 * | reason | meaning |
 * |---|---|
 * | `thread_pressure:<severity>:<observed>_over_<limit>` | the machine is out of OS threads |
 * | `duplicate_anchor:<terminal_id>` | a live session already owns the anchor |
 * | `at_cap:<cap>` | the runner's continuation concurrency cap |
 * | `spawn_authorization_<label>` | the agent registry refused the spawn |
 *
 * The first three follow `<class>:<detail>`; the fourth is `_`-delimited and
 * predates the grammar, which the producer documents as the exception rather
 * than quietly fixing. coord itself also writes one non-runner reason directly
 * (`"no runner online"`, `gate_routes.rs`), which matches no constructor and
 * falls through to the verbatim arm below — correctly, since it is already
 * plain English.
 *
 * Unrecognised input is returned VERBATIM, never blanked and never guessed at:
 * an unreadable reason the operator can still read beats a confident wrong one.
 */
export function humanizeDeferralReason(raw: string | null | undefined): string | null {
  const reason = raw?.trim();
  if (!reason) return null;

  const thread = /^thread_pressure:([^:]+):(\d+)_over_(\d+)$/.exec(reason);
  if (thread) {
    const [, severity, observed, limit] = thread;
    return `the machine was out of OS threads (${severity}) — ${observed} observed against a limit of ${limit}`;
  }

  const cap = /^at_cap:(.+)$/.exec(reason);
  if (cap) {
    return `the runner was already at its continuation cap of ${cap[1]}`;
  }

  const anchor = /^duplicate_anchor:(.+)$/.exec(reason);
  if (anchor) {
    return `a live session already owned this anchor (terminal ${anchor[1]})`;
  }

  const authz = /^spawn_authorization_(.+)$/.exec(reason);
  if (authz) {
    return `the agent registry refused the spawn (${authz[1]})`;
  }

  return reason;
}

/** What coord recorded about the dispatch being pushed back. */
export interface ContinuationDeferral {
  /** Deferral count as coord reported it. Meaningless unless `countKnown`. */
  count: number;
  /**
   * `false` when coord stamped a deferral but no usable count came with it (a
   * hand-edited NULL in a NOT-NULL-DEFAULT-0 column). The count then renders
   * `?`, never `0` — absence is not zero.
   */
  countKnown: boolean;
  /** The reason in plain English, via {@link humanizeDeferralReason}. */
  reason: string | null;
  /** coord's raw reason string, for the `raw` slot. */
  rawReason: string | null;
  /** When the LAST deferral was stamped (RFC 3339). */
  at: string | null;
  /** `count >= DEFERRAL_STUCK_COUNT` — the retry promise is not being kept. */
  stuck: boolean;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

/** The fields this derivation reads — a structural subset of `GateOverviewRow`. */
export interface ContinuationStatusInput {
  continuation_spawn?: Record<string, unknown> | null;
  continuation_action?: string | null;
  continuation_will_dispatch?: boolean | null;
  continuation_dispatched_at?: string | null;
  continuation_consumed_at?: string | null;
  continuation_consumed_outcome?: string | null;
  continuation_cancelled_at?: string | null;
  continuation_cancel_reason?: string | null;
  continuation_deferred_at?: string | null;
  continuation_deferred_reason?: string | null;
  continuation_deferred_count?: number | null;
  continuation_expired_at?: string | null;
  continuation_expired_reason?: string | null;
}

export interface ContinuationStatus {
  /** The badge the row renders, through {@link CONTINUATION_STATUS_PALETTE}. */
  status: RowStatus<ContinuationKind>;
  /**
   * Non-null whenever the dispatch was EVER pushed back — including on a gate
   * that has since dispatched, been consumed or expired. "Deferred 58 times
   * before it finally ran" is pressure the row must keep showing after the
   * kind has moved on.
   */
  deferral: ContinuationDeferral | null;
  /** The `<detail>` half of a `marker: detail` outcome, when there is one. */
  outcomeDetail: string | null;
  /** coord's `continuation_consumed_outcome` verbatim, for the `raw` slot. */
  rawOutcome: string | null;
  /**
   * Is {@link status} ABOUT the deferral — i.e. does the badge already say
   * what {@link deferral} says?
   *
   * A caller that renders both the badge and a separate "after N deferrals"
   * history chip must suppress the chip when this is `true`, or the row states
   * the same fact twice with a tooltip ("pushed back BEFORE this state") that
   * contradicts the badge beside it.
   *
   * This is a per-row flag and not a kind-membership test on purpose. Three of
   * the readings this module produces are `unknown` — an unreadable outcome,
   * an unreadable dispatch time, and an unreadable deferral time — so the KIND
   * cannot say what a badge is about, and a set of "deferral kinds" would leave
   * exactly one hole while looking complete. It is set in one place, by the
   * single constructor every arm of the deferral branch returns through, so a
   * reading added there enrols itself and one added elsewhere cannot claim it
   * by accident.
   *
   * `false` whenever a deferral is present but HISTORIC — a previous dispatch
   * cycle's stamps on a row coord has since re-dispatched. The chip is exactly
   * right there, which is the case that makes the flag worth carrying.
   */
  deferralRendered: boolean;
}

/** Split `"spawn_failed: no Tauri AppHandle …"` into its marker and detail. */
function splitOutcome(outcome: string): { marker: string; detail: string | null } {
  const idx = outcome.indexOf(":");
  if (idx < 0) return { marker: outcome.trim(), detail: null };
  const detail = outcome.slice(idx + 1).trim();
  return { marker: outcome.slice(0, idx).trim(), detail: detail || null };
}

function readDeferral(g: ContinuationStatusInput): ContinuationDeferral | null {
  const rawCount = g.continuation_deferred_count;
  const countKnown = typeof rawCount === "number" && Number.isFinite(rawCount);
  const count = countKnown ? (rawCount as number) : 0;
  // A stamped `continuation_deferred_at`/`_reason` with a zero or absent count
  // still means a deferral happened — the count column is the thing that can be
  // missing, not the event.
  const stamped = Boolean(g.continuation_deferred_at || g.continuation_deferred_reason);
  // The ONLY gate on "is there a deferral at all". Everything below reports
  // what coord recorded; nothing below re-decides existence.
  if (!stamped && count <= 0) return null;
  return {
    count,
    // `countKnown` answers "did coord send a usable number", and nothing else.
    // It used to be `countKnown && count > 0`, which sent a genuine
    // `deferred_count: 0` arriving beside a stamped `deferred_at` down the
    // same branch as "no count came with it" and rendered `deferred ×?` — the
    // null/zero collapse this module refuses everywhere else. A real zero is a
    // measurement; the early return above is what handles its absence.
    countKnown,
    reason: humanizeDeferralReason(g.continuation_deferred_reason),
    rawReason: g.continuation_deferred_reason?.trim() || null,
    at: g.continuation_deferred_at ?? null,
    stuck: countKnown && count >= DEFERRAL_STUCK_COUNT,
  };
}

/** `deferred ×58`, or `deferred ×?` when the count column gave us nothing. */
function deferralLabel(d: ContinuationDeferral): string {
  return `deferred ×${d.countKnown ? d.count : "?"}`;
}

function status(
  kind: ContinuationKind,
  label: string,
  reason?: string
): RowStatus<ContinuationKind> {
  return {
    kind,
    label,
    reason,
    attention: CONTINUATION_ATTENTION_BY_KIND[kind],
  };
}

/**
 * The gate's continuation status, or `null` when the gate has no continuation
 * at all — no attached spawn and not one lifecycle stamp. `null` means "this
 * question does not arise", and the caller renders an explicit *no
 * continuation* marker for it rather than a blank cell.
 *
 * Precedence is **terminal-first, then explained-before-unexplained**:
 *
 * 1. `expired`, then `cancelled` — coord or somebody ended it; nothing after
 *    that stamp can be the current state. Expiry outranks cancellation because
 *    coord accepts a cancel on an already-expired row, and the expiry is the
 *    one of the two it raised an alert for.
 * 2. the consumed OUTCOME, on its marker word.
 * 3. consumed with no outcome → `consumed_silent`.
 * 4. dispatched and unconsumed → a DEFERRAL if one was stamped *for this
 *    dispatch* (it explains the silence and names a reason), else age decides
 *    `dispatched` vs `dispatch_stalled`. Reporting a deferred row as "not
 *    picked up" would manufacture a mystery out of a row that already told us
 *    why — but a deferral OLDER than the dispatch belongs to a previous cycle
 *    (coord re-stamps `dispatched_at` and never clears the deferral columns),
 *    so it is reported as history and the dispatch age decides the state.
 * 5. attached but nothing dispatched → `inert` when coord says clearing
 *    dispatches nothing, else `armed`.
 *
 * `now` is injectable for deterministic tests; defaults to `Date.now()`.
 */
export function deriveContinuationStatus(
  g: ContinuationStatusInput,
  now: number = Date.now()
): ContinuationStatus | null {
  const deferral = readDeferral(g);
  const rawOutcome = g.continuation_consumed_outcome?.trim() || null;
  const attached = Boolean(g.continuation_spawn);
  const touched =
    attached ||
    Boolean(
      g.continuation_dispatched_at ||
        g.continuation_consumed_at ||
        g.continuation_cancelled_at ||
        g.continuation_expired_at
    ) ||
    deferral !== null;
  if (!touched) return null;

  const outcome = rawOutcome ? splitOutcome(rawOutcome) : null;
  const outcomeDetail = outcome?.detail ?? null;
  const wrap = (
    s: RowStatus<ContinuationKind>,
    deferralRendered = false
  ): ContinuationStatus => ({
    status: s,
    deferral,
    outcomeDetail,
    rawOutcome,
    deferralRendered,
  });

  // 1 — terminal, EXPIRY FIRST.
  //
  // The two are not mutually exclusive on the wire. coord's cancel writer
  // (`gates.rs`) guards only on `continuation_consumed_at IS NULL` and
  // `continuation_cancelled_at IS NULL` — it has no `continuation_expired_at
  // IS NULL` clause — so a cancel landing on an already-expired row is
  // accepted and both stamps sit on it.
  //
  // Expiry therefore wins. coord stamps `continuation_expired_at` only after
  // its stall watcher has given up and raised a durable alert; a later
  // cancellation adds a fact but retracts nothing, and ordering `cancelled`
  // first turned an alerted `ttl_7d_elapsed` red row into a calm grey
  // `cancelled` with attention `none` — a downgrade of the loudest thing coord
  // had to say about the row. The cancellation is not dropped: it is named in
  // the reason and carried verbatim in the panel's `raw` slot.
  //
  // `GateActions` separately stops OFFERING the cancel on an expired row, so
  // the console no longer invites the transition. That guard and this ordering
  // close different holes — one stops the console proposing it, the other
  // stops any other door's cancel from erasing the expiry here.
  if (g.continuation_expired_at) {
    const why = g.continuation_expired_reason?.trim();
    const alsoCancelled = g.continuation_cancelled_at
      ? " (a cancellation was recorded afterwards, which does not undo the expiry)"
      : "";
    return wrap(
      status(
        "expired",
        "expired",
        why
          ? `coord expired this continuation (${why}) — it will never dispatch${alsoCancelled}`
          : `coord expired this continuation — it will never dispatch${alsoCancelled}`
      )
    );
  }
  if (g.continuation_cancelled_at) {
    const why = g.continuation_cancel_reason?.trim();
    return wrap(
      status(
        "cancelled",
        "cancelled",
        why
          ? `the continuation was cancelled — ${why}`
          : "the continuation was cancelled before it ran; no reason was recorded"
      )
    );
  }

  // 2 — the outcome the runner or the continuation session recorded.
  if (outcome) {
    const detailTail = outcomeDetail ? ` — ${outcomeDetail}` : "";
    switch (outcome.marker) {
      case "spawn_failed":
        return wrap(
          status(
            "spawn_failed",
            "spawn failed",
            `the runner consumed this continuation and no session opened${detailTail}`
          )
        );
      case "work_abandoned":
        return wrap(
          status(
            "work_abandoned",
            "work abandoned",
            `the continuation session gave up on the work${detailTail}`
          )
        );
      case "work_unreported":
        return wrap(
          status(
            "work_unreported",
            "work unreported",
            `the continuation session ended without reporting what it did${detailTail} — whether the work happened is unknown`
          )
        );
      case "work_completed":
        return wrap(
          status(
            "work_completed",
            "work completed",
            "the continuation session reported that it finished the work"
          )
        );
      case "spawned":
        return wrap(
          status(
            "spawned",
            "spawned — outcome unknown",
            "a session started and never reported whether the work happened; only a later work_completed/work_abandoned answers that"
          )
        );
      default:
        return wrap(
          status(
            "unknown",
            "unreadable outcome",
            `coord recorded the outcome "${rawOutcome}", which this build has no reading for`
          )
        );
    }
  }

  // 3 — claimed, and never spoke again.
  if (g.continuation_consumed_at) {
    return wrap(
      status(
        "consumed_silent",
        "consumed — no outcome",
        "a runner claimed this continuation and never recorded what came of it; whether a session opened is unknown"
      )
    );
  }

  // 4 — out for delivery.
  if (g.continuation_dispatched_at) {
    // Read FIRST, because every reading below is derived from it — including
    // whether the deferral stamps belong to the dispatch we are looking at.
    const dispatchedMs = new Date(g.continuation_dispatched_at).getTime();
    if (Number.isNaN(dispatchedMs)) {
      // Inherited verbatim from the deleted summarizer, which fell through to
      // a calm "waiting for a runner to claim it" — a positive claim about a
      // row whose only evidence is an unparseable string. The age tests are
      // the whole basis of the readings below, so without one neither is
      // available.
      return wrap(
        status(
          "unknown",
          "dispatch time unreadable",
          `coord recorded the dispatch time as "${g.continuation_dispatched_at}", which this build cannot read — how long this has been out is unknown`
        )
      );
    }

    const deferredMs = deferral?.at
      ? new Date(deferral.at).getTime()
      : Number.NaN;
    const deferredTimeKnown = !Number.isNaN(deferredMs);

    // **Whose dispatch is this deferral about?**
    //
    // coord's `stamp_continuation_dispatched` (`gates.rs`) re-stamps
    // `continuation_dispatched_at` and NULLs the two expiry columns, and
    // touches NONE of the three deferral columns — and nothing else in coord
    // resets them either (no `continuation_deferred_at = NULL` / `_count = 0`
    // writer exists). Its own doc says the stamp goes "precisely to gates
    // whose anchor can still be re-cleared", so a re-dispatch carrying a
    // previous cycle's deferral stamps is a DESIGNED path.
    //
    // A deferral older than the dispatch therefore says nothing about the
    // dispatch now in flight: measuring silence from `now` alone read a row
    // coord dispatched three seconds ago as red "nothing pulling", every
    // clause of which was false. Such a deferral drops to HISTORY — it stays
    // on `ContinuationStatus.deferral` so the panel keeps reporting it, and
    // the current state comes from the dispatch age instead, which is the only
    // evidence about the cycle actually running.
    const deferralIsCurrent =
      deferral != null && (!deferredTimeKnown || deferredMs >= dispatchedMs);

    if (deferral && deferralIsCurrent) {
      const why = deferral.reason ? ` — last time: ${deferral.reason}` : "";
      const times = deferral.countKnown
        ? `${deferral.count} time${deferral.count === 1 ? "" : "s"}`
        : "an unrecorded number of times";

      /**
       * The ONE constructor for a status whose subject IS the deferral.
       *
       * `deferralRendered` is what stops the row rendering the deferral twice
       * (the badge plus the panel's "after N deferrals" history chip). It is a
       * per-row flag rather than a kind-membership test because `unknown` is
       * reachable from THREE unrelated branches — an unreadable outcome, an
       * unreadable dispatch time, and the unreadable deferral time below — so
       * the kind alone cannot say what a row's badge is about. Routing every
       * arm of this block through one constructor is what makes a future
       * deferral reading enrol itself: there is no list to extend and no way
       * to return from here without setting the flag.
       */
      const deferralState = (
        kind: ContinuationKind,
        label: string,
        reason: string
      ) => wrap(status(kind, label, reason), true);

      // The AGE test decides amber-vs-red, because amber on a deferred row
      // promises a runner is still pulling it and that promise has a heartbeat
      // we can check. The COUNT test needs no timestamp at all, so it is
      // consulted first when the time is missing: ignorance about *when* must
      // not erase a judgement that never depended on knowing when.
      if (!deferredTimeKnown) {
        if (deferral.stuck) {
          return deferralState(
            "deferral_stuck",
            deferralLabel(deferral),
            `a runner has pushed this dispatch back ${times}; the retry loop is not getting to it${why}. coord recorded no readable time for the last deferral, so whether it is STILL being refused could not be checked — the count alone is enough for this reading`
          );
        }
        return deferralState(
          "unknown",
          "deferral time unreadable",
          `coord recorded ${times} deferred${why}, but no readable time for the last one — whether any runner is still pulling this cannot be established`
        );
      }
      if (now - deferredMs >= DEFERRAL_SILENT_MS) {
        return deferralState(
          "deferral_abandoned",
          `${deferralLabel(deferral)} — nothing pulling`,
          `pushed back ${times}, and the last deferral is older than the runner's hourly stamp allows for a row anything is still pulling; it is not being retried${why}`
        );
      }
      if (deferral.stuck) {
        return deferralState(
          "deferral_stuck",
          deferralLabel(deferral),
          `a runner has pushed this dispatch back ${times} and is still doing so; the retry loop is not getting to it${why}`
        );
      }
      return deferralState(
        "deferred",
        deferralLabel(deferral),
        `a runner saw this continuation and pushed it back; it is still being re-listed, so it stays pending and re-deliverable${why}`
      );
    }

    const reDispatched = deferral != null;
    return wrap(
      now - dispatchedMs >= DISPATCH_STALE_MS
        ? status(
            "dispatch_stalled",
            "not picked up",
            reDispatched
              ? "coord re-dispatched this continuation and no runner has claimed it since; the deferrals on this row are from an earlier dispatch"
              : "coord dispatched this continuation and no runner has claimed it, with no deferral recorded to explain why"
          )
        : status(
            "dispatched",
            "dispatched",
            reDispatched
              ? "coord has re-dispatched this continuation and is waiting for a runner to claim it; the deferrals on this row are from an earlier dispatch"
              : "coord has emitted this continuation and is waiting for a runner to claim it"
          )
    );
  }

  // 5 — attached, nothing in flight yet.
  if (g.continuation_will_dispatch === false) {
    const action = g.continuation_action?.trim();
    return wrap(
      status(
        "inert",
        "no dispatch",
        `a continuation is attached${action ? ` (${action})` : ""} but coord reports that clearing this gate dispatches nothing`
      )
    );
  }
  const action = g.continuation_action?.trim();
  return wrap(
    status(
      "armed",
      "armed",
      `a continuation is attached${action ? ` (${action})` : ""} and will fire when this gate's anchor clears`
    )
  );
}
