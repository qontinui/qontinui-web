/**
 * sessionConsoleStatus — pure status derivation for the consolidated sessions
 * console.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 1. Follows the
 * shape `alertStatus.ts` / `treeStatus.ts` established: **status derivation
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
export type SessionRowClass =
  | "linked"
  | "lifecycle_only"
  | "agent_only"
  | null;

/** One `coord.agent_sessions` row as coord's `/coord/agent-sessions` emits it. */
export interface AgentSessionHalf {
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
export interface ConsolidatedSessionRow
  extends Partial<Omit<SessionRow, "device_id">> {
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
}

/** Envelope from `GET /operations/sessions?shape=consolidated`. */
export interface ConsolidatedSessionsResponse {
  count: number;
  scope: string;
  shape: string;
  sessions: ConsolidatedSessionRow[];
  row_class_counts: Record<string, number>;
  /** `{read: "ok"}`, or `{read: "failed", detail}` — the join axis's own read. */
  agent_half: { read: string; detail?: string };
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
export function lineageAddressable(row: ConsolidatedSessionRow): boolean | null {
  return hasAgentHalf(row);
}

/** The agent-session id this row's lineage/transcript hangs off, if known. */
export function agentSessionId(row: ConsolidatedSessionRow): string | null {
  if (row.agent_session?.id) return row.agent_session.id;
  if (row.row_class === "agent_only") return row.id;
  return null;
}

/** Plain-language explanation of the row's join class, for a title/why slot. */
export function rowClassExplanation(row: ConsolidatedSessionRow): string {
  switch (row.row_class) {
    case "linked":
      return "Both halves: a coord.sessions lifecycle row bridged to its coord.agent_sessions lineage row.";
    case "lifecycle_only":
      return "Lifecycle only: this session has no Claude Code session id, so no agent-session lineage row can exist. Transcript and lineage are not applicable — not empty.";
    case "agent_only":
      return "Agent only: coord has an agent-session lineage row that no coord.sessions row bridges (POST /agents/allocate writes one and never the other). Heartbeat and lifecycle state are unknown — not closed.";
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
  /** Rows needing a person now. `null` while nothing is known. */
  attention: number | null;
  active: number | null;
  waiting: number | null;
  unknownJoin: number | null;
  machines: number | null;
}

/**
 * The page's opening verdict, derived from the rows ALREADY FETCHED (R1) —
 * never a second request.
 *
 * `readUnknown` is the READ axis (`console/readFailure.ts`); every count is
 * then `null`, which `HealthStrip`'s badges and `StatCluster` render as `–`.
 * The JOIN axis rides along as `unknownJoin`, a count of rows whose class the
 * agent half could not establish — and it is surfaced rather than folded into
 * the healthy path, because a page that quietly reports a partially-unknown
 * fleet as green is the failure this plan exists to prevent.
 */
export function deriveSessionsHealth(
  rows: ConsolidatedSessionRow[],
  opts: {
    /** The READ axis — `readIsUnknown(loaded, readFailed)`. */
    readUnknown: boolean;
    /** The JOIN axis's own read: coord answered the list but not the agent half. */
    agentHalfFailed?: boolean;
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

  const level: "green" | "amber" | "red" =
    attention > 0
      ? "red"
      : waiting > 0 || unknownJoin > 0 || opts.agentHalfFailed
        ? "amber"
        : "green";

  const headline =
    attention > 0
      ? `${attention} session${attention === 1 ? "" : "s"} waiting on a person`
      : opts.agentHalfFailed
        ? "Lifecycle half only — the agent half did not answer"
        : unknownJoin > 0
          ? `${unknownJoin} session${unknownJoin === 1 ? "" : "s"} with an unresolved join half`
          : waiting > 0
            ? `${waiting} session${waiting === 1 ? "" : "s"} waiting on the fleet`
            : rows.length === 0
              ? "No sessions match this filter"
              : `${active} session${active === 1 ? "" : "s"} running cleanly`;

  const detail = opts.agentHalfFailed
    ? "Transcript and lineage columns read – for every row: unknown, not absent."
    : `${rows.length} row${rows.length === 1 ? "" : "s"} across ${machines.size} machine${machines.size === 1 ? "" : "s"} — ${active} active, ${waiting} waiting, ${unknownJoin} unresolved`;

  return {
    level,
    headline,
    detail,
    attention,
    active,
    waiting,
    unknownJoin,
    machines: machines.size,
  };
}
