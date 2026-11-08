/**
 * `sessionConsoleStatus` — the pure half of the consolidated sessions console.
 *
 * Plan `2026-08-26-sessions-console-consolidation.md` Phase 1, D1/D2.
 *
 * The palette↔attention agreement (R3) is audited cross-surface in
 * `console/attention.test.ts` and is NOT re-asserted here. What is asserted
 * here is the thing that audit cannot see: that a missing join half comes back
 * as UNKNOWN and never as `false`, `0` or `"closed"`.
 */

import { describe, expect, it } from "vitest";

import type { BoundedReadMeta } from "@/components/admin/coord/cursorPager";
import {
  SESSION_ATTENTION_BY_KIND,
  SESSION_WORK_ATTENTION_BY_KIND,
  agentOnlyStat,
  agentSessionId,
  ceilingDisclosure,
  countBasis,
  deriveSessionWorkStatus,
  isSessionFinished,
  compareSessionRows,
  deriveSessionStatus,
  deriveSessionsHealth,
  fleetCount,
  halfExtent,
  halfMayBeIncomplete,
  hasAgentHalf,
  hasLifecycleHalf,
  isCapped,
  linkedCount,
  lifecycleOnlyCount,
  lastHeartbeatAt,
  lifecycleState,
  rowClassExplanation,
  rowTimestamp,
  sessionsCeiling,
  type ConsolidatedSessionRow,
} from "./sessionConsoleStatus";

/** A fixed clock, so the heartbeat bands are deterministic. */
const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function linked(
  over: Partial<ConsolidatedSessionRow> = {}
): ConsolidatedSessionRow {
  return {
    id: "s-linked",
    device_id: "dev-a",
    row_class: "linked",
    session_kind: "terminal_claude",
    state: "active",
    started_at: ago(600_000),
    last_heartbeat_at: ago(5_000),
    provider: "claude",
    agent_session: { id: "agent-1", status: "live", last_seen: ago(5_000) },
    ...over,
  };
}

function lifecycleOnly(
  over: Partial<ConsolidatedSessionRow> = {}
): ConsolidatedSessionRow {
  return {
    id: "s-shell",
    device_id: "dev-a",
    row_class: "lifecycle_only",
    session_kind: "terminal_shell",
    state: "active",
    started_at: ago(600_000),
    last_heartbeat_at: ago(5_000),
    agent_session: null,
    ...over,
  };
}

function agentOnly(
  over: Partial<ConsolidatedSessionRow> = {}
): ConsolidatedSessionRow {
  // NOTE the shape: the lifecycle keys are ABSENT, not null — that is what the
  // backend emits, because there is no `coord.sessions` row to have written
  // one. Anything reading them must not turn absence into a value.
  return {
    id: "agent-2",
    device_id: "dev-b",
    row_class: "agent_only",
    agent_session: { id: "agent-2", status: "live", last_seen: ago(20_000) },
    ...over,
  };
}

function unresolved(
  over: Partial<ConsolidatedSessionRow> = {}
): ConsolidatedSessionRow {
  return {
    id: "s-unknown",
    device_id: "dev-a",
    row_class: null,
    session_kind: "terminal_claude",
    state: "active",
    last_heartbeat_at: ago(5_000),
    agent_session: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// D2 — absence is not zero
// ---------------------------------------------------------------------------

describe("D2 — a missing join half is UNKNOWN, never a value", () => {
  it("an agent_only row reports NO lifecycle state — not 'closed'", () => {
    const row = agentOnly();
    expect(lifecycleState(row)).toBeNull();
    expect(lifecycleState(row)).not.toBe("closed");
    expect(hasLifecycleHalf(row)).toBe(false);
  });

  it("an agent_only row reports NO heartbeat — not 0, not false", () => {
    const beat = lastHeartbeatAt(agentOnly());
    expect(beat).toBeNull();
    expect(beat).not.toBe(0);
    expect(beat).not.toBe(false);
  });

  it("a lifecycle_only row reports NO agent half — and that is a POSITIVE claim", () => {
    // `claude_code_session_id IS NULL` means no `coord.agent_sessions` row CAN
    // exist. This is the one absence the surface is entitled to call an answer,
    // so it is `false` rather than `null` — and the copy says "not applicable",
    // never "no transcript".
    expect(hasAgentHalf(lifecycleOnly())).toBe(false);
    expect(agentSessionId(lifecycleOnly())).toBeNull();
  });

  it("an unresolved row (row_class null) reports UNKNOWN for BOTH halves", () => {
    const row = unresolved();
    expect(hasLifecycleHalf(row)).toBeNull();
    expect(hasAgentHalf(row)).toBeNull();
    expect(lifecycleState(row)).toBeNull();
    expect(lastHeartbeatAt(row)).toBeNull();
  });

  it("an unresolved row's status is `unknown`, not derived from the half it has", () => {
    // The row carries `state: "active"` and a fresh heartbeat. Reading those
    // and calling it active would be exactly the join-miss fabrication
    // `session_liveness_id_space.rs` exists to pin.
    const status = deriveSessionStatus(unresolved(), { now: NOW });
    expect(status.kind).toBe("unknown");
    expect(status.attention).toBe("waiting");
  });

  it("an agent_only row with no coord status word is unknown, not closed", () => {
    const status = deriveSessionStatus(
      agentOnly({ agent_session: { id: "agent-2" } }),
      { now: NOW }
    );
    expect(status.kind).toBe("unknown");
    expect(status.label).not.toBe("closed");
  });
});

// ---------------------------------------------------------------------------
// The status ladder
// ---------------------------------------------------------------------------

describe("deriveSessionStatus", () => {
  it("a fresh heartbeat on an active session is calm", () => {
    const s = deriveSessionStatus(linked(), { now: NOW });
    expect(s.kind).toBe("active");
    expect(s.attention).toBe("none");
  });

  it("an active session with no heartbeat yet is `starting`, not stale", () => {
    const s = deriveSessionStatus(linked({ last_heartbeat_at: null }), {
      now: NOW,
    });
    expect(s.kind).toBe("starting");
    expect(s.attention).toBe("none");
  });

  it("a heartbeat past 45s is amber — it will clear itself", () => {
    const s = deriveSessionStatus(linked({ last_heartbeat_at: ago(60_000) }), {
      now: NOW,
    });
    expect(s.kind).toBe("heartbeat-late");
    expect(s.attention).toBe("waiting");
  });

  it("a heartbeat past 180s is still amber, because coord auto-closes it", () => {
    // The tempting answer is red. It is wrong: R3's amber is "waiting on
    // something else, it will clear itself", and coord's staleness sweep is
    // exactly that something else.
    const s = deriveSessionStatus(linked({ last_heartbeat_at: ago(600_000) }), {
      now: NOW,
    });
    expect(s.attention).toBe("waiting");
    expect(s.label).toBe("no heartbeat");
  });

  it("pending_resolution is the ONE red state — coord stopped for a person", () => {
    const s = deriveSessionStatus(linked({ state: "pending_resolution" }), {
      now: NOW,
    });
    expect(s.kind).toBe("pending-resolution");
    expect(s.attention).toBe("author");
    expect(SESSION_ATTENTION_BY_KIND[s.kind]).toBe("author");
  });

  it("a session state this console does not know floors at unknown, never calm", () => {
    const s = deriveSessionStatus(linked({ state: "teleporting" }), {
      now: NOW,
    });
    expect(s.kind).toBe("unknown");
    expect(s.attention).toBe("waiting");
  });

  it("an unparseable heartbeat is unknown, not a duration", () => {
    const s = deriveSessionStatus(linked({ last_heartbeat_at: "not-a-date" }), {
      now: NOW,
    });
    expect(s.kind).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// The WORK axis — `session_status`, terminal word `finished`
//
// Plan `2026-09-01-session-finished-marker-and-unfinished-resume` Phase 4.
// ---------------------------------------------------------------------------

describe("isSessionFinished", () => {
  it("is true for coord's canonical terminal word", () => {
    expect(isSessionFinished(linked({ session_status: "finished" }))).toBe(
      true
    );
  });

  it("accepts the legacy `done` alias coord still parses", () => {
    // coord's `SessionStatus::parse` maps `"done"` → `Finished` and
    // `as_str` never emits it, so this arm only ever fires on a legacy row
    // that coord re-serves verbatim. Cheap to accept; a silent un-finish to
    // miss.
    expect(isSessionFinished(linked({ session_status: "done" }))).toBe(true);
  });

  it("is false for every NON-terminal work word", () => {
    for (const word of ["working", "blocked", "stalled", "waiting_human"]) {
      expect(isSessionFinished(linked({ session_status: word }))).toBe(false);
    }
  });

  // THE case this predicate exists for.
  it("an ABSENT session_status is not finished — and that is UNKNOWN rendered safely", () => {
    const row = linked();
    // The key is absent, not null — exactly what coord's
    // `skip_serializing_if = "Option::is_none"` puts on the wire for a session
    // that has never reported.
    expect("session_status" in row).toBe(false);
    expect(isSessionFinished(row)).toBe(false);
    // And the consequence that matters: no marker is painted on a row we have
    // heard nothing from, so nothing on screen claims it is unfinished either.
    expect(deriveSessionWorkStatus(row)).toBeNull();
  });

  it("an explicit null reads IDENTICALLY to an absent key", () => {
    expect(isSessionFinished(linked({ session_status: null }))).toBe(false);
    expect(
      deriveSessionWorkStatus(linked({ session_status: null }))
    ).toBeNull();
  });

  it("a work word this build has never seen is not finished", () => {
    // Fail-open on the WORK axis specifically: an unrecognised word must not
    // be promoted to the terminal one, or a vocabulary extension silently
    // hides live rows.
    expect(isSessionFinished(linked({ session_status: "teleporting" }))).toBe(
      false
    );
  });

  it("reads the work axis independently of liveness — both directions", () => {
    // A LIVE session that declared itself finished...
    const liveDone = linked({ state: "active", session_status: "finished" });
    expect(isSessionFinished(liveDone)).toBe(true);
    expect(deriveSessionStatus(liveDone, { now: NOW }).kind).toBe("active");
    // ...and a CLOSED session that never did. Conflating the two is the
    // mistake this plan exists to prevent.
    const closedUnfinished = linked({ state: "closed" });
    expect(isSessionFinished(closedUnfinished)).toBe(false);
    expect(deriveSessionStatus(closedUnfinished, { now: NOW }).kind).toBe(
      "closed"
    );
  });
});

describe("deriveSessionWorkStatus", () => {
  it("paints a calm, terminal badge — never red, never amber", () => {
    const work = deriveSessionWorkStatus(
      linked({ session_status: "finished" })
    );
    expect(work?.kind).toBe("finished");
    expect(work?.label).toBe("finished");
    expect(work?.attention).toBe("none");
    expect(SESSION_WORK_ATTENTION_BY_KIND.finished).toBe("none");
  });

  it("says in words that it is the work axis, not liveness", () => {
    const work = deriveSessionWorkStatus(
      linked({ session_status: "finished" })
    );
    expect(work?.reason).toMatch(/work axis/i);
  });
});

// ---------------------------------------------------------------------------
// Ordering (§4.1 — attention then recency)
// ---------------------------------------------------------------------------

describe("compareSessionRows", () => {
  it("sorts attention first, recency second", () => {
    const rows = [
      linked({ id: "calm-old", last_heartbeat_at: ago(10_000) }),
      linked({ id: "calm-new", last_heartbeat_at: ago(1_000) }),
      linked({ id: "loud", state: "pending_resolution" }),
    ];
    const sorted = [...rows].sort((a, b) =>
      compareSessionRows(a, b, { now: NOW })
    );
    expect(sorted.map((r) => r.id)).toEqual(["loud", "calm-new", "calm-old"]);
  });

  it("a row with no timestamp sorts LAST in its band, not first", () => {
    const withTime = agentOnly({ id: "timed" });
    const noTime = agentOnly({
      id: "timeless",
      agent_session: { id: "timeless", status: "live" },
    });
    expect(rowTimestamp(noTime)).toBeNull();
    const sorted = [noTime, withTime].sort((a, b) =>
      compareSessionRows(a, b, { now: NOW })
    );
    expect(sorted.map((r) => r.id)).toEqual(["timed", "timeless"]);
  });
});

// ---------------------------------------------------------------------------
// R1 — the opening verdict
// ---------------------------------------------------------------------------

describe("deriveSessionsHealth", () => {
  it("an unknown READ makes every count null — a dash, never a zero", () => {
    const h = deriveSessionsHealth([], { readUnknown: true, loaded: false });
    expect(h.attention).toBeNull();
    expect(h.active).toBeNull();
    expect(h.machines).toBeNull();
    expect(h.level).toBe("amber");
  });

  // Plan `2026-11-08-sessions-console-hides-its-columns-and-paints-a-green-empty-fleet-before-the-first-read`
  // U2: before the first answer the console painted a GREEN "No sessions match
  // this filter" with zero counts over a list nobody had read yet.
  it("before the first read lands it is amber, says it is reading, and counts nothing", () => {
    const h = deriveSessionsHealth([], { readUnknown: false, loaded: false });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Reading sessions…");
    expect(h.detail).toBe(
      "Nothing has answered yet, so every count is a dash rather than a zero."
    );
    expect(h.attention).toBeNull();
    expect(h.active).toBeNull();
    expect(h.waiting).toBeNull();
    expect(h.unknownJoin).toBeNull();
    expect(h.machines).toBeNull();
    expect(h.headline).not.toMatch(/No sessions/);
  });

  it("a landed read over an empty fleet gives real zeroes — we looked", () => {
    const h = deriveSessionsHealth([], { readUnknown: false, loaded: true });
    expect(h.attention).toBe(0);
    expect(h.machines).toBe(0);
    expect(h.level).toBe("green");
    // The fleet's referent, never the list's narrowing sentence: that one is
    // the empty state's, directly below the strip.
    expect(h.headline).toBe("No sessions on the fleet");
    expect(h.headline).not.toMatch(/No sessions match/);
  });

  it("an empty answer to a status tab names the tab's sessions", () => {
    const h = deriveSessionsHealth([], {
      readUnknown: false,
      loaded: true,
      referent: { status: "live" },
    });
    expect(h.headline).toBe("No live sessions on the fleet");
  });

  it("a `?device=` deep link names its machine, never the fleet", () => {
    const waiting = linked({ last_heartbeat_at: ago(60_000) });
    const h = deriveSessionsHealth([waiting], {
      readUnknown: false,
      loaded: true,
      referent: { machine: "alpha" },
      options: { now: NOW },
    });
    expect(h.headline).toBe("1 session waiting on alpha");
    const none = deriveSessionsHealth([], {
      readUnknown: false,
      loaded: true,
      referent: { status: "stale", machine: "alpha" },
    });
    expect(none.headline).toBe("No stale sessions on alpha");
    expect(`${h.headline} ${none.headline}`).not.toMatch(/on the fleet/);
  });

  it("a search is the referent — the strip names it and never says 'on the fleet'", () => {
    const waiting = linked({
      id: "s-outgoing",
      last_heartbeat_at: ago(60_000),
    });
    const h = deriveSessionsHealth([waiting], {
      readUnknown: false,
      loaded: true,
      referent: { query: "outgoing" },
      options: { now: NOW },
    });
    expect(h.headline).toBe("1 of the sessions matching “outgoing” is waiting");
    expect(h.detail).toMatch(/^1 row matching “outgoing” across 1 machine — /);
    expect(`${h.headline} ${h.detail}`).not.toMatch(/on the fleet/);
  });

  it("an empty answer to a search names the search, not the list's narrowing", () => {
    const h = deriveSessionsHealth([], {
      readUnknown: false,
      loaded: true,
      referent: { query: "zzz-no-match" },
    });
    expect(h.headline).toBe("0 sessions match “zzz-no-match”");
    expect(`${h.headline} ${h.detail}`).not.toMatch(
      /No sessions match|on the fleet/
    );
  });

  it("unresolved join halves make the page amber, never green", () => {
    // A page that quietly reports a partially-unknown fleet as healthy is the
    // failure this plan exists to prevent.
    const h = deriveSessionsHealth([linked(), unresolved()], {
      readUnknown: false,
      loaded: true,
      options: { now: NOW },
    });
    expect(h.unknownJoin).toBe(1);
    expect(h.level).toBe("amber");
  });

  it("a failed agent half says so in the headline rather than reading green", () => {
    const h = deriveSessionsHealth([linked()], {
      readUnknown: false,
      loaded: true,
      agentHalfFailed: true,
      options: { now: NOW },
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toContain("agent half did not answer");
    expect(h.detail).toContain("unknown, not absent");
  });

  it("a row needing a person turns the strip red", () => {
    const h = deriveSessionsHealth([linked({ state: "pending_resolution" })], {
      readUnknown: false,
      loaded: true,
      options: { now: NOW },
    });
    expect(h.level).toBe("red");
    expect(h.attention).toBe(1);
  });

  // U4: each half stops at 500 rows. Over a capped read every fleet number is
  // a floor, and the all-clear is not observed — the unread rows may hold the
  // session that needs someone.
  it("over a read that stopped at a ceiling the numbers are floors and the strip is never green", () => {
    const h = deriveSessionsHealth([linked(), linked({ id: "s-2" })], {
      readUnknown: false,
      loaded: true,
      ceiling: ceilingOf({ lifecycle: bound(500, "unknown") }),
      options: { now: NOW },
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("At least 2 sessions running cleanly");
    expect(h.detail).toBe(
      "at least 2 rows across at least 1 machine — of those read, 2 active, 0 waiting, 0 unresolved"
    );
    // The counts themselves stay numbers — the floor is in the words.
    expect(h.active).toBe(2);
  });

  it("a red row found in part of the fleet is still red", () => {
    const h = deriveSessionsHealth([linked({ state: "pending_resolution" })], {
      readUnknown: false,
      loaded: true,
      ceiling: ceilingOf({
        lifecycle: bound(500, "unknown"),
        agent: bound(500, "unknown"),
      }),
      options: { now: NOW },
    });
    expect(h.level).toBe("red");
    expect(h.headline).toBe("At least 1 session waiting on a person");
  });

  it("over a capped read, 'none running' is said of the rows read — never of the fleet", () => {
    const closed = [
      linked({ state: "closed" }),
      linked({ id: "s-2", state: "closed" }),
    ];
    const capped = deriveSessionsHealth(closed, {
      readUnknown: false,
      loaded: true,
      ceiling: ceilingOf({ lifecycle: bound(500, "unknown") }),
      options: { now: NOW },
    });
    expect(capped.headline).toBe(
      "At least 2 sessions, none running among those read"
    );
    // Over a complete read the universal claim is the measured one.
    const complete = deriveSessionsHealth(closed, {
      readUnknown: false,
      loaded: true,
      options: { now: NOW },
    });
    expect(complete.headline).toBe("2 sessions, none running");
  });

  it("over a capped read an empty answer counts nothing it did not read — no 'at least 0'", () => {
    const h = deriveSessionsHealth([], {
      readUnknown: false,
      loaded: true,
      ceiling: ceilingOf({ lifecycle: bound(500, "unknown") }),
    });
    expect(h.headline).toBe("No sessions among those read");
    expect(h.detail).toBe("0 rows among those read");
    expect(`${h.headline} ${h.detail}`).not.toMatch(/at least 0/);
  });

  // A half whose bound is neither complete nor FULL answered with nothing
  // countable: its size is unknown, so nothing is a total OR a floor.
  it("over a half of UNKNOWN size it states the rows read, never a total or a floor", () => {
    const h = deriveSessionsHealth([agentOnly()], {
      readUnknown: false,
      loaded: true,
      ceiling: ceilingOf({
        lifecycle: bound(0, "unknown"),
        agent: bound(1, "complete"),
      }),
      options: { now: NOW },
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("1 session read — the total is unknown");
    expect(h.detail).toBe(
      "1 row read across 1 machine — 1 active, 0 waiting, 0 unresolved"
    );
    expect(`${h.headline} ${h.detail}`).not.toMatch(/at least|on the fleet/);

    // A row needing a person is red wherever it was found — said of the
    // rows read, not as a fleet total.
    const red = deriveSessionsHealth(
      [lifecycleOnly({ state: "pending_resolution" })],
      {
        readUnknown: false,
        loaded: true,
        ceiling: ceilingOf({
          lifecycle: bound(1, "complete"),
          agent: bound(0, "unknown"),
        }),
        options: { now: NOW },
      }
    );
    expect(red.level).toBe("red");
    expect(red.headline).toBe("1 session waiting on a person among those read");
  });

  // `withheld_by_filter`: sessions the status/machine SERVER filter hid
  // although coord's agent half matched it. The tab's answer is then not the
  // whole story, so it is never the green all-clear.
  it("an empty answer with matches hidden because their halves disagree is amber and names them", () => {
    const h = deriveSessionsHealth([], {
      readUnknown: false,
      loaded: true,
      referent: { status: "live" },
      withheld: 2,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "No live sessions on the fleet — 2 matches hidden: their two halves disagree"
    );
    const one = deriveSessionsHealth([], {
      readUnknown: false,
      loaded: true,
      referent: { status: "stale", machine: "alpha" },
      withheld: 1,
    });
    expect(one.headline).toBe(
      "No stale sessions on alpha — 1 match hidden: its two halves disagree"
    );
  });

  it("a non-empty answer with hidden matches names them in the detail, amber rather than green", () => {
    const h = deriveSessionsHealth([linked()], {
      readUnknown: false,
      loaded: true,
      referent: { status: "live" },
      withheld: 2,
      options: { now: NOW },
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("1 live session running cleanly");
    expect(h.detail).toBe(
      "1 live row across 1 machine — 1 active, 0 waiting, 0 unresolved; 2 matches hidden: their two halves disagree"
    );
    // Nothing hidden (or not reported): the clean read stays green.
    expect(
      deriveSessionsHealth([linked()], {
        readUnknown: false,
        loaded: true,
        withheld: 0,
        options: { now: NOW },
      }).level
    ).toBe("green");
  });
});

// ---------------------------------------------------------------------------
// U4 — the two 500-row ceilings
// ---------------------------------------------------------------------------

/**
 * The backend's envelope for a half, as `bounded_read.complete` / `unknown`
 * serve it. `unknown` below 500 is the route's third arm — a coord body with
 * no `sessions` list (`unknown(0, 500)`); at or past 500 it is a FULL page.
 */
function bound(shown: number, kind: "complete" | "unknown"): BoundedReadMeta {
  return {
    available: true,
    bound_kind: kind,
    count: shown,
    enumerate_via: null,
    filter_narrowed: null,
    limit: 500,
    next_cursor: null,
    shown,
    total: null,
    truncated: kind === "complete" ? false : null,
  };
}

/** The ceilings a consolidated response whose halves carry these bounds reads as. */
function ceilingOf(halves: {
  lifecycle?: BoundedReadMeta;
  agent?: BoundedReadMeta;
}) {
  return sessionsCeiling({
    lifecycle_half: halves.lifecycle
      ? { read: "ok", bound: halves.lifecycle }
      : undefined,
    agent_half: halves.agent
      ? { read: "ok", bound: halves.agent }
      : { read: "ok" },
  });
}

describe("the 500-row ceilings", () => {
  it("a half is open exactly while its bound does not prove the page is everything", () => {
    expect(halfMayBeIncomplete(bound(500, "unknown"))).toBe(true);
    expect(halfMayBeIncomplete(bound(0, "unknown"))).toBe(true);
    expect(halfMayBeIncomplete(bound(3, "complete"))).toBe(false);
    // An older backend reports no bound — read as complete (deploy skew only).
    expect(halfMayBeIncomplete(undefined)).toBe(false);
  });

  it("tells a FULL half from one whose size is unknown", () => {
    expect(halfExtent(bound(500, "unknown"))).toEqual({
      kind: "capped",
      shown: 500,
    });
    expect(halfExtent(bound(600, "unknown"))).toEqual({
      kind: "capped",
      shown: 600,
    });
    // Not complete, and not a full page either: nothing countable came back.
    expect(halfExtent(bound(0, "unknown"))).toEqual({ kind: "unknown" });
    expect(halfExtent(bound(31, "complete"))).toEqual({ kind: "complete" });
    expect(halfExtent(undefined)).toEqual({ kind: "unreported" });
  });

  it("names only the halves that reached a ceiling, each by its own ordering", () => {
    const both = sessionsCeiling({
      lifecycle_half: { read: "ok", bound: bound(500, "unknown") },
      agent_half: { read: "ok", bound: bound(500, "unknown") },
    });
    expect(ceilingDisclosure(both)).toBe(
      "Showing the 500 most recently started lifecycle sessions and the 500 most recently seen agent sessions; fleet totals may be higher."
    );
    const agentOnlyCapped = sessionsCeiling({
      lifecycle_half: { read: "ok", bound: bound(31, "complete") },
      agent_half: { read: "ok", bound: bound(500, "unknown") },
    });
    expect(isCapped(agentOnlyCapped)).toBe(true);
    expect(ceilingDisclosure(agentOnlyCapped)).toBe(
      "Showing the 500 most recently seen agent sessions; fleet totals may be higher."
    );
  });

  it("names a full half by the rows it SERVED, not by the limit it asked for", () => {
    expect(
      ceilingDisclosure(ceilingOf({ lifecycle: bound(600, "unknown") }))
    ).toBe(
      "Showing the 600 most recently started lifecycle sessions; fleet totals may be higher."
    );
  });

  it("a half that answered with nothing countable is of unknown size — never 'the 500 most recently …'", () => {
    expect(
      ceilingDisclosure(
        ceilingOf({
          lifecycle: bound(0, "unknown"),
          agent: bound(3, "complete"),
        })
      )
    ).toBe(
      "The lifecycle half's size is unknown: coord's answer for it carried nothing countable, so the fleet counts above are dashes, not zeros."
    );
    expect(
      ceilingDisclosure(
        ceilingOf({
          lifecycle: bound(0, "unknown"),
          agent: bound(0, "unknown"),
        })
      )
    ).toBe(
      "The lifecycle and agent halves' sizes are unknown: coord's answers for them carried nothing countable, so the fleet counts above are dashes, not zeros."
    );
    expect(
      ceilingDisclosure(
        ceilingOf({
          lifecycle: bound(500, "unknown"),
          agent: bound(0, "unknown"),
        })
      )
    ).toBe(
      "Showing the 500 most recently started lifecycle sessions. The agent half's size is unknown: coord's answer for it carried nothing countable, so the fleet counts above are dashes, not zeros."
    );
  });

  it("says nothing for complete halves, a failed agent half, or an older backend", () => {
    expect(
      ceilingDisclosure(
        sessionsCeiling({
          lifecycle_half: { read: "ok", bound: bound(31, "complete") },
          agent_half: { read: "ok", bound: bound(12, "complete") },
        })
      )
    ).toBeNull();
    expect(
      ceilingDisclosure(
        sessionsCeiling({
          lifecycle_half: { read: "ok", bound: bound(31, "complete") },
          agent_half: { read: "failed", detail: "502: coord is not reachable" },
        })
      )
    ).toBeNull();
    expect(
      ceilingDisclosure(sessionsCeiling({ agent_half: { read: "ok" } }))
    ).toBeNull();
  });

  it("narrows an agent_only explanation to the rows coord served while the lifecycle half is capped", () => {
    const qualified = rowClassExplanation(agentOnly(), {
      lifecycle: halfExtent(bound(500, "unknown")),
    });
    expect(qualified).toContain(
      "no coord.sessions row among the 500 most recently started that coord served — one may exist beyond its ceiling"
    );
    // The class is kept, never demoted to the unresolved reading.
    expect(qualified).toMatch(/^Agent only:/);
    // A lifecycle half of unknown size names no ceiling it never reached.
    const unsized = rowClassExplanation(agentOnly(), {
      lifecycle: halfExtent(bound(0, "unknown")),
    });
    expect(unsized).toContain(
      "no coord.sessions row among the lifecycle rows coord served — that half's size is unknown, so one may exist that it did not serve"
    );
    expect(unsized).not.toMatch(/500/);
    // Below the ceiling — or from a backend that reports none — the claim is
    // the established one.
    for (const lifecycle of [
      halfExtent(bound(31, "complete")),
      halfExtent(undefined),
    ]) {
      expect(rowClassExplanation(agentOnly(), { lifecycle })).toContain(
        "that no coord.sessions row bridges"
      );
    }
    expect(rowClassExplanation(agentOnly())).toContain(
      "that no coord.sessions row bridges"
    );
  });
});

// ---------------------------------------------------------------------------
// One numeric spelling per reading, and the agent-only set difference
// ---------------------------------------------------------------------------

describe("fleet counts", () => {
  it("are exact, a floor, or unstated — one spelling each", () => {
    expect(fleetCount(31, "exact").value).toBe(31);
    expect(fleetCount(0, "exact").value).toBe(0);
    expect(fleetCount(31, "floor").value).toBe("≥31");
    expect(fleetCount(31, "unknown").value).toBeNull();
    expect(fleetCount(0, "unknown").value).toBeNull();
    // An exact count needs no sentence beside it; a slot keeps its own.
    expect(fleetCount(31, "exact").title).toBeUndefined();
    expect(fleetCount(31, "exact", { title: "own" }).title).toBe("own");
  });

  it("a floor of zero is never ≥0 nor 'of those read': words where there is room, a bare 0 in a compact slot — titled either way", () => {
    const roomy = fleetCount(0, "floor");
    expect(roomy.value).toBe("0 among rows read");
    expect(roomy.title).toContain("counts only the rows read");
    // A tab's monospace count slot has no room for words.
    const compact = fleetCount(0, "floor", { compact: true });
    expect(compact.value).toBe(0);
    expect(compact.title).toContain("counts only the rows read");
    // A slot's own sentence is kept, the floor's added to it.
    const own = fleetCount(0, "floor", { title: "own sentence" });
    expect(own.title).toMatch(/^own sentence — /);
    expect(own.title).toContain("counts only the rows read");
    // Every floor says it is one in its title, not only the zero.
    expect(fleetCount(31, "floor").title).toContain(
      "counts only the rows read"
    );
  });

  it("read the basis off both halves: an unknown size outranks a ceiling", () => {
    expect(countBasis(ceilingOf({}))).toBe("exact");
    expect(
      countBasis(
        ceilingOf({
          lifecycle: bound(31, "complete"),
          agent: bound(12, "complete"),
        })
      )
    ).toBe("exact");
    expect(countBasis(ceilingOf({ agent: bound(500, "unknown") }))).toBe(
      "floor"
    );
    expect(
      countBasis(
        ceilingOf({
          lifecycle: bound(500, "unknown"),
          agent: bound(0, "unknown"),
        })
      )
    ).toBe("unknown");
  });
});

describe("the agent-only stat follows the direction of its set difference", () => {
  // `agent_only` = agent rows read, less those a lifecycle row READ bridges.
  const COMPLETE = bound(31, "complete");
  const FULL = bound(500, "unknown");
  const stat = (
    n: number,
    halves: { lifecycle?: BoundedReadMeta; agent?: BoundedReadMeta }
  ) => agentOnlyStat(n, ceilingOf(halves));

  it("is exact while both halves are complete — or reported no bound", () => {
    expect(stat(3, { lifecycle: COMPLETE, agent: COMPLETE }).value).toBe(3);
    expect(stat(3, {}).value).toBe(3);
  });

  it("is a FLOOR when only the agent half stopped: unread agent sessions may be unmatched too", () => {
    const s = stat(3, { lifecycle: COMPLETE, agent: FULL });
    expect(s.value).toBe("≥3");
    expect(s.title).toContain("at least");
    const zero = stat(0, { lifecycle: COMPLETE, agent: FULL });
    expect(zero.value).toBe("0 among rows read");
    expect(zero.title).toContain("counts only the rows read");
  });

  it("is a CEILING when only the lifecycle half stopped: a row's twin may lie past it", () => {
    const s = stat(3, { lifecycle: FULL, agent: COMPLETE });
    expect(s.value).toBe("≤3");
    expect(s.title).toContain("at most");
    expect(s.title).toContain(
      "no coord.sessions row among the 500 most recently started that coord served"
    );
    // At most none is none: every agent session was read and each matched.
    expect(stat(0, { lifecycle: FULL, agent: COMPLETE }).value).toBe(0);
  });

  it("is neither when both stopped — the count of rows read that went unmatched, never ≥", () => {
    const s = stat(3, { lifecycle: FULL, agent: FULL });
    expect(s.value).toBe("3 unmatched among rows read");
    expect(String(s.value)).not.toMatch(/[≥≤]/);
    expect(s.title).toContain("neither a floor nor a ceiling");
  });

  it("is unstated while either half's size is unknown", () => {
    expect(
      stat(3, { lifecycle: bound(0, "unknown"), agent: COMPLETE }).value
    ).toBeNull();
    expect(
      stat(3, { lifecycle: COMPLETE, agent: bound(0, "unknown") }).value
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A FAILED agent read is its own extent — never a complete one
// ---------------------------------------------------------------------------

describe("a FAILED agent read", () => {
  const FAILED = { read: "failed", detail: "502: coord is not reachable" };
  const withFailedAgent = (lifecycle: BoundedReadMeta) =>
    sessionsCeiling({
      lifecycle_half: { read: "ok", bound: lifecycle },
      agent_half: FAILED,
    });
  const DID_NOT_ANSWER = "the agent half did not answer — unknown, not zero";

  it("is its own extent — not an older backend's silence, which reads as complete", () => {
    expect(withFailedAgent(bound(3, "complete")).agent).toEqual({
      kind: "failed",
    });
    // An ANSWERED agent half with no bound is still the older backend.
    expect(sessionsCeiling({ agent_half: { read: "ok" } }).agent).toEqual({
      kind: "unreported",
    });
  });

  it("makes the fleet counts floors: sessions only the agent half holds were not read", () => {
    expect(countBasis(withFailedAgent(bound(3, "complete")))).toBe("floor");
    // A half of unknown size still outranks it.
    expect(countBasis(withFailedAgent(bound(0, "unknown")))).toBe("unknown");
  });

  it("leaves agent-only unknown beside a FULL lifecycle half — never 'every agent session was read'", () => {
    const s = agentOnlyStat(0, withFailedAgent(bound(500, "unknown")));
    expect(s.value).toBeNull();
    expect(s.title).toBe(DID_NOT_ANSWER);
    expect(agentOnlyStat(0, withFailedAgent(bound(3, "complete")))).toEqual({
      value: null,
      title: DID_NOT_ANSWER,
    });
  });

  it("leaves the join-class counts unknown: the route withholds every row's class", () => {
    for (const lifecycle of [bound(500, "unknown"), bound(3, "complete")]) {
      expect(linkedCount(0, withFailedAgent(lifecycle), "own", 0)).toEqual({
        value: null,
        title: DID_NOT_ANSWER,
      });
    }
    // While the agent half answered, a join class is a fleet count.
    expect(linkedCount(4, ceilingOf({}), "own", 0)).toEqual({
      value: 4,
      title: "own",
    });
  });

  it("states linked exactly unless a row could hide past a ceiling", () => {
    const lifecycleComplete = bound(31, "complete");
    const full = bound(500, "unknown");
    // Lifecycle complete, agent full, nothing unresolved: a bridged row whose
    // agent twin lay past the agent ceiling would read unresolved, and none
    // does, so the count is exact.
    expect(
      linkedCount(
        1,
        ceilingOf({ lifecycle: lifecycleComplete, agent: full }),
        "own",
        0
      )
    ).toEqual({ value: 1, title: "own" });
    // …but with rows unresolved, some may be linked past the agent ceiling.
    expect(
      linkedCount(
        1,
        ceilingOf({ lifecycle: lifecycleComplete, agent: full }),
        "own",
        2
      ).value
    ).toBe("≥1");
    // A full lifecycle half: bridged sessions may lie past its ceiling.
    expect(
      linkedCount(
        1,
        ceilingOf({ lifecycle: full, agent: bound(3, "complete") }),
        "own",
        0
      ).value
    ).toBe("≥1");
    // A half of unknown size establishes nothing.
    expect(
      linkedCount(
        1,
        ceilingOf({
          lifecycle: bound(0, "unknown"),
          agent: bound(3, "complete"),
        }),
        "own",
        0
      ).value
    ).toBeNull();
  });

  it("bases lifecycle-only on the lifecycle half alone: a full AGENT half does not make it a floor", () => {
    const meaning = "own";
    // Lifecycle complete, agent full: shells are read off the lifecycle half,
    // every lifecycle row was read, so the count is exact.
    expect(
      lifecycleOnlyCount(
        2,
        ceilingOf({
          lifecycle: bound(31, "complete"),
          agent: bound(500, "unknown"),
        }),
        meaning
      )
    ).toEqual({ value: 2, title: meaning });
    // Lifecycle full: a floor, whatever the agent half did.
    expect(
      lifecycleOnlyCount(
        2,
        ceilingOf({
          lifecycle: bound(500, "unknown"),
          agent: bound(3, "complete"),
        }),
        meaning
      ).value
    ).toBe("≥2");
    // Lifecycle of unknown size: nothing established.
    expect(
      lifecycleOnlyCount(
        0,
        ceilingOf({
          lifecycle: bound(0, "unknown"),
          agent: bound(3, "complete"),
        }),
        meaning
      ).value
    ).toBeNull();
    // A failed agent read withholds every row's class, shells included.
    expect(
      lifecycleOnlyCount(0, withFailedAgent(bound(31, "complete")), meaning)
    ).toEqual({ value: null, title: DID_NOT_ANSWER });
  });

  it("establishes no row's status, so the strip counts no one as needing a person or active", () => {
    const h = deriveSessionsHealth(
      [linked({ row_class: null, agent_session: null })],
      {
        readUnknown: false,
        loaded: true,
        agentHalfFailed: true,
        ceiling: withFailedAgent(bound(1, "complete")),
        options: { now: NOW },
      }
    );
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Lifecycle half only — the agent half did not answer"
    );
    expect(h.attention).toBeNull();
    expect(h.active).toBeNull();
    // Exact: rows of THIS read whose class was withheld.
    expect(h.unknownJoin).toBe(1);
    expect(h.machines).toBe(1);
  });
});
