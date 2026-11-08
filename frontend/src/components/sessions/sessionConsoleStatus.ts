/**
 * sessionConsoleStatus — pure status derivation for the consolidated sessions
 * console.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 1. Follows the
 * shape `planStatus.ts` / `treeStatus.ts` carry (first established by the
 * since-retired `alertStatus.ts`): **status derivation
 * lives in a pure, unit-tested module** (R8), so the words an operator reads
 * are testable without a DOM and no page derives a status inline in JSX.
 *
 * ## The two axes, and why neither may stand in for the other
 *
 * This surface reads a JOIN across two coord id spaces, and there are two
 * independent things that can be unknown about a row. §4 of the plan is
 * explicit that conflating them is the trap:
 *
 * | Axis | Question | Vocabulary |
 * |---|---|---|
 * | **read** | did the list read land at all? | `console/readFailure.ts` — {@link readIsUnknown} |
 * | **join** | the read landed and the row is here — is the other half of the join present? | the wire's own {@link SessionRowClass} discriminant |
 *
 * `readIsUnknown(loaded=true, readFailed=false)` returns `false` for a row
 * whose join half is missing, and it is RIGHT to: that read landed. So the
 * page imports `readFailure.ts` for the read axis and keys the join axis on
 * `row_class`. Two axes, two spellings, neither one standing in for the other.
 *
 * ## Absence is not zero (D2)
 *
 * Every accessor below that answers "what does this row say about X?" returns
 * `null` for *we do not know* and the renderer prints `–`. A `lifecycle_only`
 * row's transcript/lineage is `null`, never `"none"`; an `agent_only` row's
 * heartbeat/state is `null`, never `false`, `0` or `"closed"`. This is the
 * direct mitigation for the join hazard `qontinui-coord`'s
 * `crates/coord/tests/session_liveness_id_space.rs` exists to pin — a join
 * miss there manufactured a confident `owner_live = Some(false)` and fed it to
 * a reclaim engine armed in production.
 */

import type { BoundedReadMeta } from "@/components/admin/coord/cursorPager";
import {
  escalateAttention,
  type Attention,
} from "@/components/console/attention";
import {
  AUTHOR_RED,
  INERT,
  UNKNOWN_AMBER,
  WAITING_AMBER,
  type RowStatus,
  type StatusPalette,
} from "@/components/console/statusRow";
import type { SessionAccountStamp } from "@/services/agent-sessions-api";
import type { SessionRow } from "./types";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/**
 * D1's join discriminant, verbatim off the wire.
 *
 * `null` is the fourth answer and the load-bearing one: the read landed, the
 * row is here, and the agent half either did not answer or did not carry this
 * row. It is UNKNOWN — never `lifecycle_only`, which is a positive claim that
 * no `coord.agent_sessions` row can exist (`claude_code_session_id IS NULL`).
 */
export type SessionRowClass = "linked" | "lifecycle_only" | "agent_only" | null;

/**
 * One `coord.agent_sessions` row as coord's `/coord/agent-sessions` emits it.
 *
 * The account stamp ({@link SessionAccountStamp}) rides on it verbatim — the
 * web backend passes the agent row through untouched, so an ABSENT key still
 * means "coord does not serve it" by the time it reaches the console.
 */
export interface AgentSessionHalf extends SessionAccountStamp {
  id: string;
  user_id?: string | null;
  device_id?: string | null;
  first_seen?: string | null;
  last_seen?: string | null;
  label?: string | null;
  closed_at?: string | null;
  name?: string | null;
  derived_name?: string | null;
  summary?: string | null;
  /** coord's own agent-session lifecycle word: `live` | `stale` | `closed`. */
  status?: string | null;
}

/**
 * One row of `GET /operations/sessions?shape=consolidated`.
 *
 * Every `coord.sessions` field is OPTIONAL here, and that is the contract
 * rather than laziness: an `agent_only` row has no `coord.sessions` row at
 * all, so the backend omits those keys entirely instead of writing `null`
 * (absence is what we have; a `null` would read as "coord wrote null"). A
 * consumer must render absent and null identically, as unknown.
 */
export interface ConsolidatedSessionRow extends Partial<
  Omit<SessionRow, "device_id">
> {
  id: string;
  /**
   * Widened to nullable against `SessionRow`'s non-null `device_id`: coord's
   * `agent_sessions.device_id` IS nullable, and an `agent_only` row carries
   * that column rather than a `coord.sessions` one.
   */
  device_id?: string | null;
  row_class: SessionRowClass;
  agent_session?: AgentSessionHalf | null;
  /** The bridge column. Present only on the lifecycle half. */
  claude_code_session_id?: string | null;
  /**
   * `coord.sessions.session_status` — the WORK axis, verbatim off the wire.
   *
   * A THIRD independent axis beside the two in this module's header, and coord
   * says so in its own words: a row can be `state=active` AND
   * `session_status=finished`, or `state=closed` AND never-finished. Liveness
   * (`state`) and work (`session_status`) are orthogonal, and folding one into
   * the other is the specific mistake this field exists to make impossible.
   *
   * Optional AND nullable, and — as everywhere else on this type — the two are
   * the SAME claim: coord serializes the column with
   * `skip_serializing_if = "Option::is_none"`, so an absent key means the
   * session has never reported a work status, or coord is deployed ahead of the
   * migration that added the column. Neither is "not finished" as a measured
   * fact. See {@link isSessionFinished}.
   */
  session_status?: string | null;
}

/** Envelope from `GET /operations/sessions?shape=consolidated`. */
export interface ConsolidatedSessionsResponse {
  count: number;
  scope: string;
  shape: string;
  sessions: ConsolidatedSessionRow[];
  row_class_counts: Record<string, number>;
  /**
   * Sessions the `device` / `status` SERVER filter hid although coord's agent
   * half matched it — the two halves disagree (lifecycle `active`, agent
   * `stale`; or different machines). Not rows of any class, so not in
   * `row_class_counts`. Optional: absent from a backend that predates it, which
   * is "not reported", never zero — the console shows nothing rather than `0`.
   */
  withheld_by_filter?: number;
  /**
   * The lifecycle half's read — coord's `GET /sessions`, which stops at its
   * own hardcoded `LIMIT 500`: the most recently STARTED sessions, closed ones
   * included. `bound` is the shared bounded-read envelope (`BoundedReadMeta`,
   * the one frontend spelling of it) over what coord SERVED, before the web
   * route's own tab / search / machine narrowing — complete, full, or of
   * unknown size ({@link HalfExtent}).
   *
   * Optional, and so is `bound`: absent from a backend that predates them.
   * The console then reads the half as complete — exact counts, no
   * disclosure — which IS a claim, the one it made before the field existed;
   * it is kept for deploy skew only ({@link halfMayBeIncomplete}).
   */
  lifecycle_half?: { read: string; bound?: BoundedReadMeta };
  /**
   * `{read: "ok", bound}`, or `{read: "failed", detail}` — the join axis's own
   * read. Its ceiling is the 500 most recently SEEN agent sessions. A failed
   * read carries no `bound` (there is no page to bound); an older backend
   * carries none either.
   */
  agent_half: { read: string; detail?: string; bound?: BoundedReadMeta };
}

// ---------------------------------------------------------------------------
// The two 500-row ceilings (plan
// `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
// Phase 3)
// ---------------------------------------------------------------------------

/**
 * May this half's read hold fewer rows than coord has?
 *
 * `true` when the half's `bound` is present and does not prove the page is
 * everything — `truncated !== false`, the bounded-read contract's own bit for
 * it. The web route builds each half in one of THREE arms (`_half_bound` in
 * the operations route):
 *
 * - below the ceiling, `bounded_read.complete` (`truncated: false`) — `false`;
 * - a FULL page, `bounded_read.unknown(shown, limit)` with `shown >= limit`
 *   (nothing fetched past it, `truncated: null`) — `true`;
 * - a coord body with no `sessions` list, `bounded_read.unknown(0, limit)`
 *   (nothing countable served) — `true` as well.
 *
 * It does not say WHICH of the last two a half is, and the console reads them
 * oppositely — a full page makes every count a floor, an answer of unknown
 * size supports no number at all — so the console reads each half through
 * {@link halfExtent}, which tells them apart by `shown` against `limit`.
 *
 * An ABSENT bound is `false`, and that IS a claim: the console reads such a
 * half as complete and paints exact counts over it, which is what it showed
 * before the route served a bound at all. It is kept for deploy skew only — a
 * frontend ahead of a backend that predates the field — since the route this
 * console ships with bounds every half it read. A FAILED agent read carries no
 * bound either and is never read that way: {@link sessionsCeiling} gives it
 * its own `failed` extent, because no page arrived to be complete.
 */
export function halfMayBeIncomplete(
  bound: BoundedReadMeta | null | undefined
): boolean {
  return bound != null && bound.truncated !== false;
}

/**
 * How much of coord one half of the consolidated read holds — the five
 * answers the console renders differently:
 *
 * | `kind` | when | the counts over it |
 * |---|---|---|
 * | `complete` | `truncated: false` — below its ceiling | exact |
 * | `capped` | not complete, `shown >= limit` — the page came back FULL | floors; the disclosure names `shown` |
 * | `unknown` | any OTHER bound that is not complete — the route's `unknown(0, limit)` for a body with no list | no number at all: dashes, and words saying the half's size is unknown |
 * | `failed` | the AGENT half's read failed (`agent_half.read: "failed"`) — no page arrived | floors for rows and machines (the lifecycle rows were read; sessions only the agent half holds were not), and dashes for the join classes and the status counts: the route withholds every row's class |
 * | `unreported` | an ANSWERED half with no bound — a backend predating it | exact ({@link halfMayBeIncomplete} says why) |
 *
 * The first three are read off the half's `bound` ({@link halfExtent});
 * `failed` off the agent half's `read`, which only the agent half can fail —
 * a failed lifecycle read fails the whole request. `shown` is what coord
 * SERVED, which can pass the limit the route asked for, so it — not `limit` —
 * is the number a full half is named by.
 */
export type HalfExtent =
  | { kind: "complete" }
  | { kind: "capped"; shown: number }
  | { kind: "unknown" }
  | { kind: "failed" }
  | { kind: "unreported" };

/** Read one half's {@link HalfExtent} off its `bound`. */
export function halfExtent(
  bound: BoundedReadMeta | null | undefined
): HalfExtent {
  if (bound == null) return { kind: "unreported" };
  if (!halfMayBeIncomplete(bound)) return { kind: "complete" };
  return bound.shown >= bound.limit
    ? { kind: "capped", shown: bound.shown }
    : { kind: "unknown" };
}

/** Each half's {@link HalfExtent}. */
export interface SessionsCeiling {
  /** The lifecycle half — the most recently STARTED sessions. */
  lifecycle: HalfExtent;
  /** The agent half — the most recently SEEN agent sessions. */
  agent: HalfExtent;
}

/** Neither half reported a bound — what a caller passing none means. */
export const NO_CEILING: SessionsCeiling = {
  lifecycle: { kind: "unreported" },
  agent: { kind: "unreported" },
};

/** Read each half's extent off the consolidated response. */
export function sessionsCeiling(
  payload:
    | Pick<ConsolidatedSessionsResponse, "lifecycle_half" | "agent_half">
    | null
    | undefined
): SessionsCeiling {
  return {
    lifecycle: halfExtent(payload?.lifecycle_half?.bound),
    // A failed agent read carries no bound, exactly as an older backend's
    // answer does — and it must not READ as one: that would paint the
    // failure as a complete read.
    agent:
      payload?.agent_half?.read === "failed"
        ? { kind: "failed" }
        : halfExtent(payload?.agent_half?.bound),
  };
}

/** Did the agent half's read fail outright? */
export function isAgentHalfFailed(ceiling: SessionsCeiling): boolean {
  return ceiling.agent.kind === "failed";
}

/** Did either half come back FULL? Then a fleet count is at best a floor. */
export function isCapped(ceiling: SessionsCeiling): boolean {
  return ceiling.lifecycle.kind === "capped" || ceiling.agent.kind === "capped";
}

/** Did either half answer with a size nobody can state? */
export function isSizeUnknown(ceiling: SessionsCeiling): boolean {
  return (
    ceiling.lifecycle.kind === "unknown" || ceiling.agent.kind === "unknown"
  );
}

/**
 * How a fleet count over this read may be stated: `exact`; a `floor` — a half
 * came back full, or the agent half FAILED (the lifecycle rows were read, but
 * sessions only the agent half holds were not); or not at all — `unknown`, a
 * half's size is unknown. The unknown arm outranks the floor: a floor is a
 * claim about a read whose size is known, and one half's is not.
 */
export type CountBasis = "exact" | "floor" | "unknown";

export function countBasis(ceiling: SessionsCeiling): CountBasis {
  if (isSizeUnknown(ceiling)) return "unknown";
  if (isCapped(ceiling) || isAgentHalfFailed(ceiling)) return "floor";
  return "exact";
}

/**
 * The words under the stats that say what this read could not count — or
 * `null` when no half is full or of unknown size. A FAILED agent half is the
 * strip's to name ("Lifecycle half only — the agent half did not answer"),
 * directly above; its counts' own titles say the rest.
 *
 * A FULL half is named by its own ordering and by the rows it SERVED, because
 * that is what decides which rows fell off: the lifecycle half keeps the most
 * recently STARTED sessions, the agent half the most recently SEEN. A half of
 * UNKNOWN size is named as exactly that — never by a ceiling it did not reach.
 */
export function ceilingDisclosure(ceiling: SessionsCeiling): string | null {
  const { lifecycle, agent } = ceiling;
  const full = [
    lifecycle.kind === "capped"
      ? `the ${lifecycle.shown} most recently started lifecycle sessions`
      : null,
    agent.kind === "capped"
      ? `the ${agent.shown} most recently seen agent sessions`
      : null,
  ].filter((h): h is string => h !== null);
  const unsized = (["lifecycle", "agent"] as const).filter(
    (half) => ceiling[half].kind === "unknown"
  );

  const sentences: string[] = [];
  if (full.length > 0) {
    // With a half of unknown size beside it there are no totals to be higher
    // than — every fleet count is a dash.
    sentences.push(
      `Showing ${full.join(" and ")}${
        unsized.length > 0 ? "." : "; fleet totals may be higher."
      }`
    );
  }
  if (unsized.length === 1) {
    sentences.push(
      `The ${unsized[0]} half's size is unknown: coord's answer for it carried nothing countable, so the fleet counts above are dashes, not zeros.`
    );
  } else if (unsized.length === 2) {
    sentences.push(
      "The lifecycle and agent halves' sizes are unknown: coord's answers for them carried nothing countable, so the fleet counts above are dashes, not zeros."
    );
  }
  return sentences.length > 0 ? sentences.join(" ") : null;
}

/**
 * What `agent_only` can claim while the lifecycle half it was compared against
 * may be incomplete — or `null` while that half is complete (or reported no
 * bound), when the class's own claim stands.
 *
 * The class is a set difference against the lifecycle rows coord SERVED, so
 * beyond the lifecycle ceiling — or over a lifecycle answer of unknown size —
 * it no longer says "no coord.sessions row exists": the row's lifecycle twin
 * may simply be one coord did not serve. The class and its agent half are kept
 * (they are real); the claim is narrowed to what was actually compared.
 */
export function agentOnlyQualifier(lifecycle: HalfExtent): string | null {
  switch (lifecycle.kind) {
    case "capped":
      return `no coord.sessions row among the ${lifecycle.shown} most recently started that coord served — one may exist beyond its ceiling`;
    case "unknown":
      return "no coord.sessions row among the lifecycle rows coord served — that half's size is unknown, so one may exist that it did not serve";
    default:
      return null;
  }
}

/**
 * One count as a count slot renders it — a tab's count, a stat, a strip
 * badge: its text, and the sentence its `title` carries beside it.
 */
export interface CountCell {
  /** `null` renders `–`: unknown, never zero. */
  value: number | string | null;
  title?: string;
}

/**
 * A floor of zero where the slot has room for words. Named for the ROWS — a
 * floor counts only the rows read — so it reads true under any label
 * ("machines 0 among rows read"), never "0 of those [machines] read".
 */
export const ZERO_AMONG_ROWS_READ = "0 among rows read";

/** The sentence every floor carries in its `title`. */
const FLOOR_TITLE =
  "a floor: it counts only the rows read, and this read did not reach every session";

/** …and a floor of zero, which says what it counted rather than "none". */
const FLOOR_ZERO_TITLE =
  "0 among the rows read: it counts only the rows read, and this read did not reach every session, so the true count may be higher";

/**
 * The `title` of a count the failed agent half left unestablished — the join
 * classes, and agent-only — once its read failed.
 */
export const AGENT_HALF_DID_NOT_ANSWER =
  "the agent half did not answer — unknown, not zero";

/** …and of the status counts, which no row's class could establish. */
export const STATUSES_UNESTABLISHED =
  "the agent half did not answer, so no row's status is established — unknown, not zero";

/**
 * A fleet count — rows, machines, a join class, a strip badge, the answered
 * tab — as one count slot renders it. ONE spelling per {@link CountBasis}:
 *
 * - `exact`   → `n`
 * - `floor`   → `≥n`. A floor of ZERO is never `≥0` (true of every count, it
 *   says nothing): it is {@link ZERO_AMONG_ROWS_READ} where the slot has room
 *   for words, and a bare `0` in a `compact` one — a tab's monospace count.
 * - `unknown` → `null`, which every console primitive renders `–`
 *
 * Every floor carries its sentence in `title` — a bare `0` above all, whose
 * title is the only place left to say it counts only the rows read. `title`
 * is the slot's own sentence, kept, with the floor's added after it. "at
 * least" is the PROSE spelling of the same floor, kept to the strip's
 * sentences. `agent-only` is not a fleet count (see {@link agentOnlyStat}).
 */
export function fleetCount(
  n: number,
  basis: CountBasis,
  opts: { compact?: boolean; title?: string } = {}
): CountCell {
  if (basis !== "floor") {
    return { value: basis === "exact" ? n : null, title: opts.title };
  }
  const floor = n === 0 ? FLOOR_ZERO_TITLE : FLOOR_TITLE;
  return {
    value: n > 0 ? `≥${n}` : opts.compact ? 0 : ZERO_AMONG_ROWS_READ,
    title: opts.title ? `${opts.title} — ${floor}` : floor,
  };
}

/**
 * The `linked` stat. A row is linked when a lifecycle row READ bridges an
 * agent row READ, so the count can be higher than shown only through a
 * session one half did not reach:
 *
 * - the lifecycle half came back full — a bridged session may have started
 *   before its ceiling: a floor;
 * - the agent half came back full AND some row is unresolved — a bridged row
 *   whose agent twin lies past the agent ceiling reads unresolved (D2), so
 *   those rows may be linked: a floor. With nothing unresolved no row can be
 *   hiding that way, and the count is exact;
 * - a half of unknown size: nothing established (`–`);
 * - a FAILED agent read: `–` — the route withholds EVERY row's class
 *   (`row_class: null` for all of them, shells included).
 *
 * `meaning` is the stat's own sentence; `unresolved` the rows of this read
 * whose class is null.
 */
export function linkedCount(
  n: number,
  ceiling: SessionsCeiling,
  meaning: string,
  unresolved: number
): CountCell {
  if (isAgentHalfFailed(ceiling)) {
    return { value: null, title: AGENT_HALF_DID_NOT_ANSWER };
  }
  const basis: CountBasis = isSizeUnknown(ceiling)
    ? "unknown"
    : ceiling.lifecycle.kind === "capped" ||
        (ceiling.agent.kind === "capped" && unresolved > 0)
      ? "floor"
      : "exact";
  return fleetCount(n, basis, { title: meaning });
}

/**
 * The `lifecycle-only` stat. Unlike `linked`, this class is a fact of the
 * LIFECYCLE row alone — a session with no Claude Code session id — so how it
 * may be stated depends on the lifecycle half alone: exact while every
 * lifecycle row was read (whatever the agent half did), a floor once that
 * half came back full, `–` when its size is unknown. A FAILED agent read still
 * dashes it: the route then withholds every row's class, shells included.
 */
export function lifecycleOnlyCount(
  n: number,
  ceiling: SessionsCeiling,
  meaning: string
): CountCell {
  if (isAgentHalfFailed(ceiling)) {
    return { value: null, title: AGENT_HALF_DID_NOT_ANSWER };
  }
  const basis: CountBasis =
    ceiling.lifecycle.kind === "unknown"
      ? "unknown"
      : ceiling.lifecycle.kind === "capped"
        ? "floor"
        : "exact";
  return fleetCount(n, basis, { title: meaning });
}

/** The `agent-only` stat's value, and the sentence its `title` carries. */
export interface AgentOnlyStat extends CountCell {
  title: string;
}

const AGENT_ONLY_MEANING =
  "an allocated agent session no coord.sessions row bridges — heartbeat and state are unknown, not closed";

/**
 * The `agent-only` stat — NOT a {@link fleetCount}. `agent_only` is a SET
 * DIFFERENCE: the agent rows read, less the ones a lifecycle row READ
 * bridges. Which way `n` can be wrong therefore depends on WHICH half stopped:
 *
 * | lifecycle | agent | `n` is | renders |
 * |---|---|---|---|
 * | complete | complete | exact | `n` |
 * | complete | full | a floor — agent sessions past the ceiling may be unmatched too | `≥n` |
 * | full | complete | a CEILING — a row's lifecycle twin may lie past the lifecycle ceiling | `≤n`; `0` is exact |
 * | full | full | neither — both errors at once | `n unmatched among rows read` |
 * | either of unknown size | | nothing established | `–` |
 * | any | FAILED | nothing established — no agent row was read | `–` |
 *
 * An `unreported` half reads as complete, as it does for every count. A
 * FAILED agent half never does: "every agent session was read" would be the
 * one thing that read did not do.
 */
export function agentOnlyStat(
  n: number,
  ceiling: SessionsCeiling
): AgentOnlyStat {
  const { lifecycle, agent } = ceiling;
  if (agent.kind === "failed") {
    return { value: null, title: AGENT_HALF_DID_NOT_ANSWER };
  }
  if (lifecycle.kind === "unknown" || agent.kind === "unknown") {
    return {
      value: null,
      title:
        "agent sessions no coord.sessions row bridges — not stated: a half of this read is of unknown size, so no number here would be a total, a floor or a ceiling",
    };
  }
  if (lifecycle.kind === "capped" && agent.kind === "capped") {
    return {
      value: `${n} unmatched among rows read`,
      title: `agent sessions read that matched no coord.sessions row among the ${lifecycle.shown} most recently started that coord served — neither a floor nor a ceiling of the fleet's agent-only sessions: a row's twin may lie past the lifecycle ceiling, and agent sessions past the agent ceiling were not read`,
    };
  }
  if (lifecycle.kind === "capped") {
    return n === 0
      ? {
          // At most none is none: every agent session was read, and each one
          // matched a lifecycle row coord served.
          value: 0,
          title:
            "none: every agent session was read, and each has a coord.sessions row among those coord served",
        }
      : {
          value: `≤${n}`,
          title: `at most ${n}: each is an allocated agent session with ${agentOnlyQualifier(lifecycle)}`,
        };
  }
  if (agent.kind === "capped") {
    return {
      value: n > 0 ? `≥${n}` : ZERO_AMONG_ROWS_READ,
      title: `${AGENT_ONLY_MEANING} — ${
        n > 0 ? "at least this many" : "0 among the rows read"
      }: it counts only the rows read, and the agent half stopped at its ceiling, so agent sessions past it were not read`,
    };
  }
  return { value: n, title: AGENT_ONLY_MEANING };
}

// ---------------------------------------------------------------------------
// The status vocabulary (R3)
// ---------------------------------------------------------------------------

/**
 * The kind union this surface paints.
 *
 * Deliberately ONE vocabulary across all three row classes rather than a
 * parallel `agent-*` set: both halves are answering the same question — *is
 * this session alive?* — and a second spelling of "stale" would be a second
 * chance for the two to disagree. Which half ANSWERED is the `row_class`
 * column's job, and it is rendered separately.
 */
export type SessionStatusKind =
  | "active"
  | "starting"
  | "heartbeat-late"
  | "pending-resolution"
  | "stale"
  | "closed"
  | "unknown";

/**
 * The audited kind → attention table (R3). TOTAL over
 * {@link SessionStatusKind}; `console/attention.test.ts` audits
 * {@link SESSION_STATUS_CLASS} against it.
 *
 * The only `author` kind is `pending-resolution`, and the discipline is worth
 * stating because the tempting answer is wrong: a session whose heartbeat has
 * gone quiet looks alarming, but coord's staleness watcher auto-closes it at
 * 180s — it *will* clear itself, which is precisely R3's definition of amber.
 * `pending_resolution` is the one state coord enters BECAUSE it has stopped
 * and needs a human decision, so it is the one state that earns red.
 *
 * `unknown` is amber, never calm: painting ignorance green is the
 * `silent-empty-is-unknown` mistake with a badge attached, and it is the same
 * floor `attentionOf` applies to a kind it does not recognise.
 */
export const SESSION_ATTENTION_BY_KIND: Record<SessionStatusKind, Attention> = {
  "pending-resolution": "author",
  "heartbeat-late": "waiting",
  stale: "waiting",
  unknown: "waiting",
  active: "none",
  starting: "none",
  closed: "none",
};

/** Kind → badge classes, built only from the shared console colour families. */
export const SESSION_STATUS_CLASS: Record<SessionStatusKind, string> = {
  "pending-resolution": AUTHOR_RED,
  "heartbeat-late": WAITING_AMBER,
  stale: WAITING_AMBER,
  // R3's ignorance floor — amber's lighter sibling. Still amber, never calm.
  unknown: UNKNOWN_AMBER,
  active: "bg-green-500/15 text-green-200 border-green-500/30",
  starting: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  closed: INERT,
};

/** Red ⇔ ✕: exactly the kinds whose declared attention is `author`. */
export const SESSION_AUTHOR_GLYPH_KINDS: ReadonlySet<SessionStatusKind> =
  new Set(
    (Object.keys(SESSION_ATTENTION_BY_KIND) as SessionStatusKind[]).filter(
      (k) => SESSION_ATTENTION_BY_KIND[k] === "author"
    )
  );

export const SESSION_STATUS_PALETTE: StatusPalette<SessionStatusKind> = {
  badgeClass: SESSION_STATUS_CLASS,
  authorGlyphKinds: SESSION_AUTHOR_GLYPH_KINDS,
};

// ---------------------------------------------------------------------------
// D2 — the absence accessors. `null` means UNKNOWN and renders `–`.
// ---------------------------------------------------------------------------

/**
 * Does this row's LIFECYCLE half exist?
 *
 * `false` only for `agent_only`, where coord has told us in terms that
 * `POST /agents/allocate` wrote an `agent_sessions` row and no `sessions` row.
 * `null` while the join axis is unknown.
 */
export function hasLifecycleHalf(row: ConsolidatedSessionRow): boolean | null {
  if (row.row_class === null || row.row_class === undefined) return null;
  return row.row_class !== "agent_only";
}

/**
 * Does this row's AGENT half exist?
 *
 * `false` only for `lifecycle_only`, which is a structural claim and not an
 * observation: the session has no `claude_code_session_id` at all, so no
 * `coord.agent_sessions` row CAN exist for it. `null` while the join axis is
 * unknown — including for a bridged row the (capped, filtered) agent read did
 * not carry.
 */
export function hasAgentHalf(row: ConsolidatedSessionRow): boolean | null {
  if (row.row_class === null || row.row_class === undefined) return null;
  return row.row_class !== "lifecycle_only";
}

/**
 * The row's `coord.sessions.state`, or `null` when we cannot say.
 *
 * **Never `"closed"` for a missing half.** An `agent_only` row has no
 * lifecycle row, so it has no state — reporting one would be the exact
 * fabrication D2 forbids.
 */
export function lifecycleState(row: ConsolidatedSessionRow): string | null {
  if (hasLifecycleHalf(row) !== true) return null;
  return row.state ?? null;
}

/**
 * The row's last heartbeat, or `null` when we cannot say.
 *
 * Two different `null`s collapse here on purpose, and both are honest: no
 * lifecycle half (nothing writes a heartbeat), and a lifecycle half that has
 * not recorded one yet. Neither is "the heartbeat stopped".
 */
export function lastHeartbeatAt(row: ConsolidatedSessionRow): string | null {
  if (hasLifecycleHalf(row) !== true) return null;
  return row.last_heartbeat_at ?? null;
}

/**
 * Whether a transcript/lineage read is even ADDRESSABLE for this row, or
 * `null` when we cannot say.
 *
 * Deliberately not "does a transcript exist" — nothing on the list read
 * answers that, and Phase 2 is what probes it. This answers the weaker,
 * true thing: is there an agent-session id to address one by? A
 * `lifecycle_only` row has none (`false`); an unknown join axis is `null`.
 * Both render `–`, and the tooltip says which.
 */
export function lineageAddressable(
  row: ConsolidatedSessionRow
): boolean | null {
  return hasAgentHalf(row);
}

/** The agent-session id this row's lineage/transcript hangs off, if known. */
export function agentSessionId(row: ConsolidatedSessionRow): string | null {
  if (row.agent_session?.id) return row.agent_session.id;
  if (row.row_class === "agent_only") return row.id;
  return null;
}

/**
 * Plain-language explanation of the row's join class, for a title/why slot.
 *
 * `lifecycle` is the lifecycle half's {@link HalfExtent}. While that half is
 * full or of unknown size an `agent_only` row is qualified
 * ({@link agentOnlyQualifier}) rather than reclassified: `row_class: null`
 * would be false here, because the account cell and the status read null as
 * "the agent half did not answer", and it did.
 */
export function rowClassExplanation(
  row: ConsolidatedSessionRow,
  opts: { lifecycle?: HalfExtent } = {}
): string {
  switch (row.row_class) {
    case "linked":
      return "Both halves: a coord.sessions lifecycle row bridged to its coord.agent_sessions lineage row.";
    case "lifecycle_only":
      return "Lifecycle only: this session has no Claude Code session id, so no agent-session lineage row can exist. Transcript and lineage are not applicable — not empty.";
    case "agent_only": {
      const narrowed = opts.lifecycle
        ? agentOnlyQualifier(opts.lifecycle)
        : null;
      if (narrowed) {
        return `Agent only: coord has an agent-session lineage row with ${narrowed}. Heartbeat and lifecycle state are unknown — not closed.`;
      }
      return "Agent only: coord has an agent-session lineage row that no coord.sessions row bridges (POST /agents/allocate writes one and never the other). Heartbeat and lifecycle state are unknown — not closed.";
    }
    default:
      return "Unknown: the read landed but the agent half did not answer for this row, so which halves exist has not been established. Every dash below is unknown, not zero.";
  }
}

// ---------------------------------------------------------------------------
// Heartbeat + status derivation
// ---------------------------------------------------------------------------

/** Heartbeat cadence is 15s; coord marks stale at 45s and auto-closes at 180s. */
const HEARTBEAT_STALE_MS = 45_000;
const HEARTBEAT_DEAD_MS = 180_000;

/** Options carried so a test can render deterministically without stubbing time. */
export interface DeriveOptions {
  /** The clock, epoch ms. Defaults to `Date.now()`. */
  now?: number;
}

/**
 * The row status the console renders.
 *
 * Reads the lifecycle half when there is one and the agent half's own
 * `status` word when there is not — and reports `unknown` when the join axis
 * has not answered, rather than guessing from whichever half happens to be
 * present.
 */
export function deriveSessionStatus(
  row: ConsolidatedSessionRow,
  options: DeriveOptions = {}
): RowStatus<SessionStatusKind> {
  const now = options.now ?? Date.now();
  const lifecycle = hasLifecycleHalf(row);

  if (lifecycle === null) {
    return {
      kind: "unknown",
      label: "unknown",
      reason: "the agent half of the join did not answer for this row",
      attention: SESSION_ATTENTION_BY_KIND.unknown,
    };
  }

  if (lifecycle === false) {
    // `agent_only`: coord's own `live` | `stale` | `closed` word is all there
    // is, and an absent one is unknown rather than closed.
    const word = row.agent_session?.status ?? null;
    if (word === "live") {
      return {
        kind: "active",
        label: "live",
        reason: "agent session seen within the fleet staleness window",
        attention: SESSION_ATTENTION_BY_KIND.active,
      };
    }
    if (word === "stale") {
      return {
        kind: "stale",
        label: "stale",
        reason: "agent session not seen inside the staleness window",
        attention: SESSION_ATTENTION_BY_KIND.stale,
      };
    }
    if (word === "closed") {
      return {
        kind: "closed",
        label: "closed",
        reason: "agent session recorded a close",
        attention: SESSION_ATTENTION_BY_KIND.closed,
      };
    }
    return {
      kind: "unknown",
      label: "unknown",
      reason: "coord served no lifecycle word for this agent session",
      attention: SESSION_ATTENTION_BY_KIND.unknown,
    };
  }

  const state = row.state ?? null;
  if (state === "closed") {
    return {
      kind: "closed",
      label: "closed",
      reason: "session closed",
      attention: SESSION_ATTENTION_BY_KIND.closed,
    };
  }
  if (state === "pending_resolution") {
    return {
      kind: "pending-resolution",
      label: "needs resolution",
      reason: "coord stopped on a conflict and is waiting on a person",
      attention: SESSION_ATTENTION_BY_KIND["pending-resolution"],
    };
  }
  if (state === "stale") {
    return {
      kind: "stale",
      label: "stale",
      reason: "coord marked this stale; the staleness sweep will close it",
      attention: SESSION_ATTENTION_BY_KIND.stale,
    };
  }
  if (state !== "active") {
    return {
      kind: "unknown",
      label: state ? `state ${state}` : "unknown",
      reason: state
        ? "coord served a session state this console does not know"
        : "coord served no session state for this row",
      attention: SESSION_ATTENTION_BY_KIND.unknown,
    };
  }

  // Active. The heartbeat is EVIDENCE the state cannot see, so it may only
  // escalate (`escalateAttention`'s contract), never calm the row down.
  const beat = row.last_heartbeat_at ?? null;
  if (!beat) {
    return {
      kind: "starting",
      label: "starting",
      reason: "active, no heartbeat recorded yet",
      attention: SESSION_ATTENTION_BY_KIND.starting,
    };
  }
  const age = now - new Date(beat).getTime();
  if (Number.isNaN(age)) {
    return {
      kind: "unknown",
      label: "unknown",
      reason: "coord served an unparseable heartbeat timestamp",
      attention: SESSION_ATTENTION_BY_KIND.unknown,
    };
  }
  if (age >= HEARTBEAT_DEAD_MS) {
    return {
      kind: "heartbeat-late",
      label: "no heartbeat",
      reason: "silent for 3m+ — coord's staleness sweep will close it",
      attention: escalateAttention(
        SESSION_ATTENTION_BY_KIND.active,
        SESSION_ATTENTION_BY_KIND["heartbeat-late"]
      ),
    };
  }
  if (age >= HEARTBEAT_STALE_MS) {
    return {
      kind: "heartbeat-late",
      label: "heartbeat late",
      reason: "missed heartbeats — 15s cadence, stale at 45s",
      attention: escalateAttention(
        SESSION_ATTENTION_BY_KIND.active,
        SESSION_ATTENTION_BY_KIND["heartbeat-late"]
      ),
    };
  }
  return {
    kind: "active",
    label: "active",
    reason: "heartbeat fresh",
    attention: SESSION_ATTENTION_BY_KIND.active,
  };
}

// ---------------------------------------------------------------------------
// The WORK axis — `coord.sessions.session_status`, whose terminal word is
// `finished`. Deliberately a SECOND vocabulary beside `SessionStatusKind`
// rather than a member of it.
// ---------------------------------------------------------------------------
//
// Plan `2026-09-01-session-finished-marker-and-unfinished-resume.md` Phase 4.
//
// **Why not just add `finished` to {@link SessionStatusKind}.** That union
// answers *is this session alive?* — one badge, one answer. The work axis
// answers a different question, and the two cross: a session can be
// `state=active` and `session_status=finished` (it declared its work done and
// has not exited yet), or `state=closed` and never finished (it died
// mid-task — the whole reason the resume half of this plan exists). Adding
// `finished` to the liveness union would force one badge to answer two
// questions, and the row would have to pick which of the two truths to hide.
// So it is its own one-kind vocabulary, its own palette, and its own badge
// rendered BESIDE the liveness one.

/** The work axis's rendered vocabulary. One kind — the terminal one. */
export type SessionWorkKind = "finished";

/**
 * The work axis's attention table, audited by `console/attention.test.ts`
 * exactly like {@link SESSION_ATTENTION_BY_KIND}.
 *
 * `none`, and it is the calm family's textbook case rather than a shrug: a
 * finished session is terminal on this axis, nothing is blocked on it, and
 * nothing decays while it sits there. Amber would promise something clears it
 * (nothing does — it is already done) and red would claim an operator must act
 * (they need not). Style guide §4.1, "everything else … terminal".
 */
export const SESSION_WORK_ATTENTION_BY_KIND: Record<
  SessionWorkKind,
  Attention
> = {
  finished: "none",
};

/**
 * Kind → badge classes for the work axis.
 *
 * Green — the calm family's "done" hue (style guide R3: *green = done*), the
 * same literal {@link SESSION_STATUS_CLASS} already spells for `active`.
 *
 * **It MUST NOT be {@link INERT}, which is what `closed` wears.** `closed` and
 * `finished` are the terminal words of two DIFFERENT axes and an operator has
 * to be able to tell "this session stopped" from "this session's work is
 * done" at a glance — a closed-but-unfinished session is exactly the row the
 * resume half of this plan goes looking for. Painting them the same grey is
 * the conflation the whole feature exists to prevent.
 */
export const SESSION_WORK_CLASS: Record<SessionWorkKind, string> = {
  finished: "bg-green-500/15 text-green-200 border-green-500/30",
};

export const SESSION_WORK_PALETTE: StatusPalette<SessionWorkKind> = {
  badgeClass: SESSION_WORK_CLASS,
  // No red on this axis, so no `✕` — the set is empty rather than absent so
  // the audit reads it as a measured "none", not as a forgotten field.
  authorGlyphKinds: new Set<SessionWorkKind>(),
  // `✓` — the colourblind-safe half of "done", so the marker survives at any
  // contrast and does not rely on the green alone.
  doneGlyphKinds: new Set<SessionWorkKind>(["finished"]),
};

/**
 * The wire words that mean "the agent declared its work complete".
 *
 * `finished` is coord's canonical spelling. `done` is the pre-Phase-4 legacy
 * alias: coord's `SessionStatus::parse` still ACCEPTS it (so old writers and
 * old rows keep gating correctly) while `SessionStatus::as_str` NEVER emits
 * it — verified against `qontinui-coord` `crates/coord/src/sessions.rs` on
 * origin/main, 2026-09-03. It is accepted here anyway, deliberately: this
 * field is a plain nullable `TEXT` column that coord re-serves verbatim, so a
 * legacy row written before the rename can still carry the old word past a
 * decoder that never normalised it. Accepting it costs one set member; missing
 * it would silently un-finish a real row.
 */
export const SESSION_FINISHED_WORDS: ReadonlySet<string> = new Set([
  "finished",
  "done",
]);

/**
 * Has this session declared its work complete?
 *
 * **`false` for an ABSENT or `null` `session_status`, and that is UNKNOWN
 * being rendered safely — not a measured negative. Do not "optimise" this into
 * treating unknown as a real answer.**
 *
 * coord serializes the column with `skip_serializing_if = "Option::is_none"`,
 * so a missing key means *this session has never reported a work status* (or
 * coord predates the migration). That is ignorance, and the fleet rule for
 * ignorance is `verification-and-evidence` `silent-empty-is-unknown`: an
 * absence is never a zero.
 *
 * The `false` this returns is therefore a statement about what the CALLER may
 * do with the row, not a claim about the session: every caller here uses it to
 * decide whether to HIDE the row or paint a "finished" marker on it, and the
 * safe answer to "we do not know" is to show the row and paint nothing. A
 * predicate that reported unknown as finished would silently hide sessions
 * nobody has heard from — precisely the rows an operator most needs to see.
 *
 * If a caller ever needs to distinguish *unfinished* from *never reported*,
 * read {@link ConsolidatedSessionRow.session_status} directly and branch on
 * `== null`. Do not widen this predicate's return to `boolean | null`: its two
 * consumers both need a total answer, and a `null` arm would be re-collapsed
 * to `false` at each of them anyway, one copy at a time.
 */
export function isSessionFinished(row: ConsolidatedSessionRow): boolean {
  const word = row.session_status;
  // Absent OR null — the same claim (see the field's own doc), and neither is
  // evidence of anything.
  if (word == null) return false;
  return SESSION_FINISHED_WORDS.has(word);
}

/**
 * The work-axis badge for a row, or `null` when there is nothing to say.
 *
 * `null` rather than an "unfinished" badge on purpose: a row we have heard
 * nothing from and a row actively working would both have to wear it, and the
 * badge would be asserting the one thing {@link isSessionFinished} refuses to.
 * The absence of a green marker is not a claim; a grey "unfinished" one would
 * be.
 */
export function deriveSessionWorkStatus(
  row: ConsolidatedSessionRow
): RowStatus<SessionWorkKind> | null {
  if (!isSessionFinished(row)) return null;
  return {
    kind: "finished",
    label: "finished",
    reason:
      "the agent declared its work complete — the WORK axis, not liveness; this row may still be live",
    attention: SESSION_WORK_ATTENTION_BY_KIND.finished,
  };
}

/** The timestamp a row's time slot reports — the most recent thing it said. */
export function rowTimestamp(row: ConsolidatedSessionRow): string | null {
  return (
    row.last_heartbeat_at ??
    row.agent_session?.last_seen ??
    row.started_at ??
    row.agent_session?.first_seen ??
    null
  );
}

/**
 * Sort: attention first, recency second (§4.1's density target).
 *
 * A stable total order, so a poll that returns the same rows re-renders them
 * in the same places. Rows with no timestamp sort last within their band
 * rather than jumping to the top — an unknown time is not a recent one.
 */
export function compareSessionRows(
  a: ConsolidatedSessionRow,
  b: ConsolidatedSessionRow,
  options: DeriveOptions = {}
): number {
  const rank = (r: ConsolidatedSessionRow) =>
    ATTENTION_ORDER[deriveSessionStatus(r, options).attention];
  const byAttention = rank(b) - rank(a);
  if (byAttention !== 0) return byAttention;
  const at = (r: ConsolidatedSessionRow) => {
    const iso = rowTimestamp(r);
    if (!iso) return Number.NEGATIVE_INFINITY;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  const byTime = at(b) - at(a);
  if (byTime !== 0 && Number.isFinite(byTime)) return byTime;
  if (at(a) !== at(b)) return at(a) === Number.NEGATIVE_INFINITY ? 1 : -1;
  return a.id.localeCompare(b.id);
}

/**
 * Local rank map. Imported from `console/attention`'s `ATTENTION_RANK` would
 * be identical; it is aliased here so the comparator reads in one place.
 */
const ATTENTION_ORDER: Record<Attention, number> = {
  none: 0,
  waiting: 1,
  author: 2,
};

// ---------------------------------------------------------------------------
// The opening verdict (R1)
// ---------------------------------------------------------------------------

export interface SessionsHealth {
  level: "green" | "amber" | "red";
  headline: string;
  detail: string;
  /**
   * Rows needing a person now. `null` while nothing is known — and over a
   * FAILED agent read, which establishes no row's status (so `active` too).
   */
  attention: number | null;
  active: number | null;
  waiting: number | null;
  unknownJoin: number | null;
  machines: number | null;
}

/**
 * The status filter a tab sends as `?status=` — a SERVER filter on `state`,
 * so it narrows what coord answered and the strip must say so.
 */
export type SessionStatusFilter = "live" | "stale" | "closed";

/**
 * What coord was asked for: the referent every number on the strip counts.
 *
 * Every member is a SERVER filter (`?status=`, `?q=`, `?device=`), so the rows
 * the strip is derived from are coord's answer to exactly this question —
 * never the whole fleet once any is set. The client facets (kind, provider,
 * machine, work, account) are NOT part of it: they narrow the list below the
 * strip, never the strip, which is why the console derives the strip from
 * `rows` and not from what the facets left visible.
 */
export interface SessionsReferent {
  /** The status tab, or `null` / absent for the `All` tab. */
  status?: SessionStatusFilter | null;
  /** The applied search, or `""` / absent for none. */
  query?: string;
  /**
   * The machine a `?device=` deep link narrowed coord's answer to, as the
   * console labels it — or `null` / absent for the whole fleet.
   */
  machine?: string | null;
}

/**
 * The page's opening verdict, derived from the rows ALREADY FETCHED (R1) —
 * never a second request.
 *
 * `readUnknown` is the READ axis (`console/readFailure.ts`); every count is
 * then `null`, which `HealthStrip`'s badges and `StatCluster` render as `–`.
 * `loaded: false` is the same ignorance BEFORE the first answer — the window
 * in which the console used to paint a green "No sessions match this filter"
 * over a list nobody had read yet (plan
 * `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
 * U2). It is amber — `HealthStrip` has no neutral level, and amber is the
 * ignorance floor — with every count `null`, the arm the sibling derivers
 * already have (`plansHealth.tsx`, `findingStatus.ts`).
 *
 * The JOIN axis rides along as `unknownJoin`, a count of rows whose class the
 * agent half could not establish — and it is surfaced rather than folded into
 * the healthy path, because a page that quietly reports a partially-unknown
 * fleet as green is the failure this plan exists to prevent.
 *
 * ## The words name the referent (U3)
 *
 * `rows` is coord's answer for the {@link SessionsReferent}, so "on the fleet"
 * is said only while nothing narrowed the question: a status tab names its
 * sessions ("No live sessions on the fleet"), a `?device=` deep link names
 * its machine instead of the fleet, and a search becomes the referent itself
 * ("1 of the sessions matching “outgoing” is waiting") and never says "on the
 * fleet" — the page holds no unsearched read to say it of, and a second fetch
 * for the strip is what R1 forbids.
 *
 * ## A read that stopped short of the fleet says how (U4)
 *
 * While a half came back FULL ({@link HalfExtent} `capped`) the fleet numbers
 * read "at least" — never "at least 0", which says nothing — and an empty or
 * none-running answer holds "among those read". While a half's size is
 * UNKNOWN not even a floor is stated: the headline counts the rows READ and
 * says the total is unknown. Either way the strip cannot be GREEN: rows past a
 * ceiling were never read, and an all-clear over them is a claim the page did
 * not observe — the same rule `derivePlansHealth`'s `incomplete` holds. A red
 * row still outranks both; one found in part of the fleet is still red.
 *
 * A FAILED agent read ({@link HalfExtent} `failed`, or `agentHalfFailed`) is
 * not a complete one: the route withholds every row's class, so no row's
 * status is established and `attention` / `active` are `null` — unknown, not
 * zero — under the "Lifecycle half only" headline.
 *
 * ## Matches the filter hid are never a green empty tab
 *
 * `withheld` counts sessions the status / machine SERVER filter hid although
 * coord's agent half matched it — their two halves disagree. The tab's answer
 * is then not the whole story, so the strip is amber and names them: in the
 * headline when the answer is otherwise empty ("No live sessions on the fleet
 * — 2 matches hidden: …"), in the detail otherwise.
 */
export function deriveSessionsHealth(
  rows: ConsolidatedSessionRow[],
  opts: {
    /** The READ axis — `readIsUnknown(loaded, readFailed)`. */
    readUnknown: boolean;
    /** Has coord answered at least once? Before it has, nothing is counted. */
    loaded: boolean;
    /** The JOIN axis's own read: coord answered the list but not the agent half. */
    agentHalfFailed?: boolean;
    /** What coord was asked for. Absent: the whole fleet. */
    referent?: SessionsReferent;
    /** Each half's extent — complete, full, of unknown size, or unreported. */
    ceiling?: SessionsCeiling;
    /**
     * `withheld_by_filter`: sessions the server filter hid although their
     * agent half matched it. Absent or `0`: none reported.
     */
    withheld?: number;
    options?: DeriveOptions;
  }
): SessionsHealth {
  if (opts.readUnknown) {
    return {
      level: "amber",
      headline: "Sessions could not be read",
      detail:
        "coord did not answer; these counts are a dash, not a zero — nothing here is a claim that the fleet is idle",
      attention: null,
      active: null,
      waiting: null,
      unknownJoin: null,
      machines: null,
    };
  }

  if (!opts.loaded) {
    return {
      level: "amber",
      headline: "Reading sessions…",
      detail:
        "Nothing has answered yet, so every count is a dash rather than a zero.",
      attention: null,
      active: null,
      waiting: null,
      unknownJoin: null,
      machines: null,
    };
  }

  let attention = 0;
  let active = 0;
  let waiting = 0;
  let unknownJoin = 0;
  const machines = new Set<string>();
  for (const row of rows) {
    const device = row.device_id ?? row.agent_session?.device_id;
    if (device) machines.add(String(device));
    if (row.row_class == null) unknownJoin += 1;
    const status = deriveSessionStatus(row, opts.options);
    if (status.attention === "author") attention += 1;
    else if (status.attention === "waiting") waiting += 1;
    if (status.kind === "active" || status.kind === "starting") active += 1;
  }

  const ceiling = opts.ceiling ?? NO_CEILING;
  const basis = countBasis(ceiling);
  const withheld = opts.withheld ?? 0;
  // The flag and the ceiling's `failed` extent are the same fact, read off
  // the same answer; either is enough.
  const agentFailed = opts.agentHalfFailed || isAgentHalfFailed(ceiling);
  const level: "green" | "amber" | "red" =
    attention > 0
      ? "red"
      : waiting > 0 ||
          unknownJoin > 0 ||
          agentFailed ||
          basis !== "exact" ||
          withheld > 0
        ? "amber"
        : "green";

  const say = referentPhrasing(opts.referent, basis);
  // Whether the headline already names the hidden matches — then the detail
  // does not repeat them.
  let hiddenNamed = false;
  let headline: string;
  if (attention > 0) headline = say.attention(attention);
  else if (basis === "unknown") headline = say.sizeUnknown(rows.length);
  else if (agentFailed)
    headline = "Lifecycle half only — the agent half did not answer";
  else if (unknownJoin > 0) headline = say.unresolved(unknownJoin);
  else if (waiting > 0) headline = say.waiting(waiting);
  else if (rows.length === 0) {
    headline = say.none(withheld);
    hiddenNamed = withheld > 0;
  } else if (active > 0) headline = say.clean(active);
  else headline = say.noneRunning(rows.length);

  const base = agentFailed
    ? "Transcript and lineage columns read – for every row: unknown, not absent."
    : say.detail({
        rows: rows.length,
        machines: machines.size,
        active,
        waiting,
        unknownJoin,
      });
  const detail =
    withheld > 0 && !hiddenNamed
      ? `${base.replace(/\.$/, "")}; ${say.hidden(withheld)}`
      : base;

  return {
    level,
    headline,
    detail,
    // A failed agent read withholds every row's class, so no row's status is
    // established (D2): "0 need a person" and "0 active" would be counts of
    // nothing. Unknown, not zero.
    attention: agentFailed ? null : attention,
    active: agentFailed ? null : active,
    waiting,
    unknownJoin,
    machines: machines.size,
  };
}

/**
 * The strip's sentences for one referent — every count named against what
 * coord was asked for, read as a floor ("at least") over a full half, and as
 * a count of the rows READ over a half of unknown size.
 *
 * `unknownJoin` is the one count never floored: it is a property of THIS read
 * (rows whose other half did not answer), not a fleet total a larger read
 * could only add to.
 */
function referentPhrasing(
  referent: SessionsReferent | undefined,
  basis: CountBasis
) {
  const query = referent?.query?.trim() || null;
  const adj = referent?.status ? `${referent.status} ` : "";
  // A `?device=` deep link narrows coord's answer to one machine, and then
  // that machine is where the sessions are — never "the fleet".
  const onMachine = referent?.machine ? ` on ${referent.machine}` : "";
  // The prose floor. Never "at least 0": true of every count, it says nothing.
  const qty = (n: number) =>
    basis === "floor" && n > 0 ? `at least ${n}` : `${n}`;
  const Qty = (n: number) => capitalize(qty(n));
  const sessions = (n: number) => `${adj}session${n === 1 ? "" : "s"}`;
  const plural = (n: number, one: string, many: string) =>
    n === 1 ? one : many;
  // The search, as the referent: "the live sessions matching “q”".
  const matching = query
    ? `the ${adj}sessions matching “${query}”${onMachine}`
    : "";
  const matchingQuery = query ? ` matching “${query}”` : "";
  // Over a read that stopped short of the fleet — at a ceiling, or at a size
  // nobody knows — an EMPTY or none-running answer holds only of the rows read.
  const among = basis === "exact" ? "" : " among those read";
  // Over a half of UNKNOWN size not even a floor is stated: a count is of the
  // rows read, and says so.
  const ofRead = basis === "unknown" ? " among those read" : "";
  // The matches a server filter hid because the session's halves disagree.
  const hidden = (n: number) =>
    `${n} ${plural(n, "match", "matches")} hidden: ${plural(n, "its", "their")} two halves disagree`;

  return {
    attention: (n: number) =>
      query
        ? `${Qty(n)} of ${matching} ${plural(n, "waits", "wait")} on a person${ofRead}`
        : `${Qty(n)} ${sessions(n)}${onMachine} waiting on a person${ofRead}`,
    unresolved: (n: number) =>
      query
        ? `${n} of ${matching} ${plural(n, "has", "have")} an unresolved join half`
        : `${n} ${sessions(n)}${onMachine} with an unresolved join half`,
    waiting: (n: number) =>
      query
        ? `${Qty(n)} of ${matching} ${plural(n, "is", "are")} waiting`
        : `${Qty(n)} ${sessions(n)} waiting${onMachine || " on the fleet"}`,
    none: (withheld = 0) => {
      const empty = query
        ? `0 ${adj}sessions match “${query}”${onMachine}${among}`
        : onMachine || basis === "exact"
          ? `No ${adj}sessions${onMachine || " on the fleet"}${among}`
          : `No ${adj}sessions${among}`;
      // The empty answer is not the whole story while the filter hid matches.
      return withheld > 0 ? `${empty} — ${hidden(withheld)}` : empty;
    },
    clean: (n: number) =>
      query
        ? `${Qty(n)} of ${matching} ${plural(n, "is", "are")} running cleanly`
        : `${Qty(n)} ${sessions(n)}${onMachine} running cleanly`,
    // Rows, none of them waiting and none running: every one has ended — of
    // the rows read, when the read stopped short of the fleet.
    noneRunning: (n: number) =>
      query
        ? `${Qty(n)} ${sessions(n)} match “${query}”${onMachine}, none running${among}`
        : `${Qty(n)} ${sessions(n)}${onMachine}, none running${among}`,
    // A half of unknown size: the rows read are all that can be counted.
    sizeUnknown: (n: number) =>
      `${n === 0 ? "No" : n} ${sessions(n)}${matchingQuery}${onMachine} read — the total is unknown`,
    hidden,
    detail: (c: {
      rows: number;
      machines: number;
      active: number;
      waiting: number;
      unknownJoin: number;
    }) => {
      const rowsWord = `${adj}row${c.rows === 1 ? "" : "s"}${matchingQuery}`;
      const machinesWord = `machine${c.machines === 1 ? "" : "s"}`;
      const classes = `${c.active} active, ${c.waiting} waiting, ${c.unknownJoin} unresolved`;
      // Short of the fleet with nothing read, there is nothing to break down —
      // and a floor of zero would say nothing.
      if (basis !== "exact" && c.rows === 0) {
        return `0 ${rowsWord} among those read`;
      }
      if (basis === "unknown") {
        return `${c.rows} ${rowsWord} read across ${c.machines} ${machinesWord} — ${classes}`;
      }
      return `${qty(c.rows)} ${rowsWord} across ${qty(c.machines)} ${machinesWord} — ${
        basis === "floor" ? `of those read, ${classes}` : classes
      }`;
    },
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
