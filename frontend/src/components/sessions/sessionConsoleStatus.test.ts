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

import {
  SESSION_ATTENTION_BY_KIND,
  SESSION_WORK_ATTENTION_BY_KIND,
  agentSessionId,
  deriveSessionWorkStatus,
  isSessionFinished,
  compareSessionRows,
  deriveSessionStatus,
  deriveSessionsHealth,
  hasAgentHalf,
  hasLifecycleHalf,
  lastHeartbeatAt,
  lifecycleState,
  rowTimestamp,
  type ConsolidatedSessionRow,
} from "./sessionConsoleStatus";

/** A fixed clock, so the heartbeat bands are deterministic. */
const NOW = Date.parse("2026-08-26T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

function linked(over: Partial<ConsolidatedSessionRow> = {}): ConsolidatedSessionRow {
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
    expect(isSessionFinished(linked({ session_status: "finished" }))).toBe(true);
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
    expect(deriveSessionWorkStatus(linked({ session_status: null }))).toBeNull();
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
    const work = deriveSessionWorkStatus(linked({ session_status: "finished" }));
    expect(work?.kind).toBe("finished");
    expect(work?.label).toBe("finished");
    expect(work?.attention).toBe("none");
    expect(SESSION_WORK_ATTENTION_BY_KIND.finished).toBe("none");
  });

  it("says in words that it is the work axis, not liveness", () => {
    const work = deriveSessionWorkStatus(linked({ session_status: "finished" }));
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
    const sorted = [...rows].sort((a, b) => compareSessionRows(a, b, { now: NOW }));
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
    const h = deriveSessionsHealth([], { readUnknown: true });
    expect(h.attention).toBeNull();
    expect(h.active).toBeNull();
    expect(h.machines).toBeNull();
    expect(h.level).toBe("amber");
  });

  it("a landed read over an empty list gives real zeroes — we looked", () => {
    const h = deriveSessionsHealth([], { readUnknown: false });
    expect(h.attention).toBe(0);
    expect(h.machines).toBe(0);
    expect(h.level).toBe("green");
    expect(h.headline).toContain("No sessions match");
  });

  it("unresolved join halves make the page amber, never green", () => {
    // A page that quietly reports a partially-unknown fleet as healthy is the
    // failure this plan exists to prevent.
    const h = deriveSessionsHealth([linked(), unresolved()], {
      readUnknown: false,
      options: { now: NOW },
    });
    expect(h.unknownJoin).toBe(1);
    expect(h.level).toBe("amber");
  });

  it("a failed agent half says so in the headline rather than reading green", () => {
    const h = deriveSessionsHealth([linked()], {
      readUnknown: false,
      agentHalfFailed: true,
      options: { now: NOW },
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toContain("agent half did not answer");
    expect(h.detail).toContain("unknown, not absent");
  });

  it("a row needing a person turns the strip red", () => {
    const h = deriveSessionsHealth(
      [linked({ state: "pending_resolution" })],
      { readUnknown: false, options: { now: NOW } }
    );
    expect(h.level).toBe("red");
    expect(h.attention).toBe(1);
  });
});
