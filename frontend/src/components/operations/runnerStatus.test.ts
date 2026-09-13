/**
 * runnerStatus — the derivations behind `/admin/coord/runners`.
 *
 * Plan `2026-09-13-drained-runner-never-reaches-idle` Phase 8. Each block
 * pins one way the page could tell an operator a machine is safe to rebuild
 * when nothing said so:
 *
 * 1. only a FRESH readiness report is a verdict — stale, absent, and a coord
 *    that serves no readiness are three different UNKNOWNs, never "safe";
 * 2. a null count is UNKNOWN, never `0`;
 * 3. a session is only offered the actions its kind can take;
 * 4. a wind-down entry coord's census does not name is kept, not dropped;
 * 5. the palette agrees with its attention table.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  READINESS_STALE_SECS,
  RUNNER_SESSION_ATTENTION_BY_KIND,
  RUNNER_SESSION_PALETTE,
  blocksRestartLabel,
  countLabel,
  deriveReadinessHealth,
  deriveRunnerSessionStatus,
  describeControlError,
  drainBadgeLabel,
  idleEligibilityLabel,
  joinRunnerSessions,
  originLabel,
  parseFleetSessions,
  readinessCounts,
  resolveReadiness,
  sessionActionGates,
  sortRunnerSessions,
  type FleetSessionRow,
  type ReadinessRead,
  type RunnerSessionRecord,
  type WindDownSession,
} from "./runnerStatus";

const DEVICE = "3f4c1a52-9a1e-4b6f-9f0f-8c2f0f0a11bd";
const CLAUDE_A = "0f0e0d0c-0b0a-4908-8706-050403020100";
const CLAUDE_B = "1f1e1d1c-1b1a-4918-9716-151413121110";

function sampleRow(overrides: Record<string, unknown> = {}) {
  return {
    device_id: DEVICE,
    lane: "host",
    sampled_at: "2026-09-13T10:00:00Z",
    readiness_safe: false,
    readiness_reason: "2 sessions block a restart",
    readiness_blocking: 2,
    readiness_finished: 1,
    wind_down_candidates: 1,
    wind_down_exit_stuck: 0,
    wind_down_sessions: [],
    readiness_age_secs: 20,
    readiness_state: "fresh",
    ...overrides,
  };
}

function body(...rows: Record<string, unknown>[]) {
  return { latest: rows, count: rows.length, schema_pending: false };
}

function windDown(overrides: Partial<WindDownSession> = {}): WindDownSession {
  return {
    claude_code_session_id: CLAUDE_A,
    blocks_restart: true,
    idle_state: "idle",
    eligibility: "ineligible",
    close_eligible_at: null,
    exit_stuck: false,
    spawn_origin: null,
    ...overrides,
  };
}

function session(overrides: Partial<FleetSessionRow> = {}): FleetSessionRow {
  return {
    sessionId: "8d0f5a2e-1c3b-4e5f-9a7b-6c5d4e3f2a1b",
    claudeCodeSessionId: CLAUDE_A,
    sessionStatus: "working",
    startedAt: "2026-09-13T09:00:00Z",
    spawnOrigin: "operator_terminal",
    ...overrides,
  };
}

function record(overrides: Partial<RunnerSessionRecord> = {}): RunnerSessionRecord {
  return {
    key: "session:x",
    session: session(),
    windDown: windDown(),
    windDownKnown: true,
    windDownTruncated: false,
    ...overrides,
  };
}

describe("resolveReadiness", () => {
  it("reads a fresh verdict, its counts and its sessions", () => {
    const read = resolveReadiness(
      body(sampleRow({ wind_down_sessions: [windDown()] })),
      DEVICE.toUpperCase()
    );
    expect(read.kind).toBe("fresh");
    if (read.kind !== "fresh") return;
    expect(read.sample.safe).toBe(false);
    expect(read.sample.blocking).toBe(2);
    expect(read.sample.sessions).toHaveLength(1);
  });

  it("withholds a stale verdict — even one that said safe", () => {
    const read = resolveReadiness(
      body(sampleRow({ readiness_safe: true, readiness_state: "stale", readiness_age_secs: 900 })),
      DEVICE
    );
    expect(read).toEqual({ kind: "stale", ageSecs: 900 });
    expect(deriveReadinessHealth(read, 0).headline).toBe("Readiness UNKNOWN");
    expect(deriveReadinessHealth(read, 0).level).toBe("amber");
  });

  it("does not trust a `fresh` mark whose age is past the bound or missing", () => {
    expect(
      resolveReadiness(
        body(sampleRow({ readiness_age_secs: READINESS_STALE_SECS + 1 })),
        DEVICE
      ).kind
    ).toBe("stale");
    expect(
      resolveReadiness(body(sampleRow({ readiness_age_secs: null })), DEVICE).kind
    ).toBe("stale");
  });

  it("names an absent report as a runner build that predates the surface", () => {
    const read = resolveReadiness(
      body(sampleRow({ readiness_state: "absent", readiness_safe: null })),
      DEVICE
    );
    expect(read.kind).toBe("absent");
    expect(deriveReadinessHealth(read, 0).detail).toBe(
      "readiness never reported — runner build predates this surface"
    );
  });

  it("tells a coord that serves no readiness apart from a runner that sends none", () => {
    const { readiness_state: _s, readiness_age_secs: _a, ...legacy } = sampleRow();
    expect(resolveReadiness(body(legacy), DEVICE).kind).toBe("not_served");
    expect(resolveReadiness({ schema_pending: true, latest: [] }, DEVICE).kind).toBe(
      "not_served"
    );
    expect(resolveReadiness({}, DEVICE).kind).toBe("not_served");
  });

  it("reports no sample for a device coord has no row for", () => {
    expect(resolveReadiness(body(sampleRow({ device_id: "other" })), DEVICE)).toEqual({
      kind: "no_sample",
    });
  });

  it("is green only for an explicit fresh `safe: true`", () => {
    const safe = resolveReadiness(body(sampleRow({ readiness_safe: true })), DEVICE);
    expect(deriveReadinessHealth(safe, 0)).toMatchObject({
      level: "green",
      headline: "Safe to restart",
    });
    const undecided = resolveReadiness(body(sampleRow({ readiness_safe: null })), DEVICE);
    expect(deriveReadinessHealth(undecided, 0).headline).toBe("Readiness UNKNOWN");
  });

  it("is red when a human must act, amber when the blockers clear themselves", () => {
    const unsafe = resolveReadiness(body(sampleRow()), DEVICE);
    expect(deriveReadinessHealth(unsafe, 0).level).toBe("amber");
    expect(deriveReadinessHealth(unsafe, 1).level).toBe("red");
    const stuck = resolveReadiness(body(sampleRow({ wind_down_exit_stuck: 1 })), DEVICE);
    expect(deriveReadinessHealth(stuck, 0).level).toBe("red");
  });

  it("drops a wind-down entry with no session id and says how many", () => {
    const read = resolveReadiness(
      body(sampleRow({ wind_down_sessions: [windDown(), { blocks_restart: true }] })),
      DEVICE
    );
    expect(read.kind === "fresh" && read.sample.unreadableSessions).toBe(1);
  });
});

describe("readinessCounts", () => {
  it("renders a null count as UNKNOWN and a zero as 0", () => {
    const read = resolveReadiness(
      body(sampleRow({ readiness_blocking: null, readiness_finished: 0 })),
      DEVICE
    );
    const counts = readinessCounts(read);
    expect(countLabel(counts.blocking)).toBe("UNKNOWN");
    expect(countLabel(counts.finished)).toBe("0");
  });

  it("is UNKNOWN across the board unless readiness is fresh", () => {
    for (const read of [
      { kind: "loading" },
      { kind: "stale", ageSecs: 400 },
      { kind: "absent", ageSecs: 10 },
      { kind: "read_failed", reason: "x" },
    ] as ReadinessRead[]) {
      expect(readinessCounts(read)).toEqual({
        blocking: null,
        finished: null,
        closeEligible: null,
        exitStuck: null,
      });
    }
  });
});

describe("drainBadgeLabel", () => {
  it("never renders an unknown drain as not drained", () => {
    expect(drainBadgeLabel({ state: "unknown", reason: "x" })).toBe("drain UNKNOWN");
    expect(drainBadgeLabel({ state: "not_drained" })).toBe("not drained");
  });
});

describe("deriveRunnerSessionStatus", () => {
  it.each([
    [record({ windDown: windDown({ exit_stuck: true }) }), "exit_stuck"],
    [record({ windDown: windDown({ eligibility: "eligible" }) }), "close_eligible"],
    [record({ windDown: windDown({ blocks_restart: false }) }), "not_blocking"],
    [record({ windDown: windDown({ eligibility: "not_yet" }) }), "closing"],
    [record({ windDown: windDown({ idle_state: "busy" }) }), "working"],
    [record(), "idle_blocking"],
    [record({ windDown: windDown({ blocks_restart: null }) }), "unknown"],
    [record({ windDown: null }), "unknown"],
    [record({ windDownKnown: false }), "unknown"],
  ] as const)("classifies %#", (rec, kind) => {
    expect(deriveRunnerSessionStatus(rec).kind).toBe(kind);
  });

  it("renders every unknown-state label as UNKNOWN", () => {
    const rec = record({ windDownKnown: false });
    expect(idleEligibilityLabel(rec)).toBe("UNKNOWN · UNKNOWN");
    expect(blocksRestartLabel(rec)).toBe("UNKNOWN");
  });

  it("leads with the rows a human must act on", () => {
    const calm = record({ key: "calm", windDown: windDown({ blocks_restart: false }) });
    const idle = record({ key: "idle" });
    expect(sortRunnerSessions([calm, idle]).map((r) => r.key)).toEqual(["idle", "calm"]);
  });
});

describe("the runner wind-down palette", () => {
  it("agrees with its attention table", () => {
    expect(
      paletteDisagreements(RUNNER_SESSION_ATTENTION_BY_KIND, RUNNER_SESSION_PALETTE)
    ).toEqual([]);
  });
});

describe("sessionActionGates", () => {
  it("offers finish & close on an idle session only", () => {
    expect(sessionActionGates(record()).finish_and_close.allowed).toBe(true);
    const busy = sessionActionGates(record({ windDown: windDown({ idle_state: "busy" }) }));
    expect(busy.finish_and_close.allowed).toBe(false);
    expect(busy.finish_and_close.reason).toMatch(/working/);
    expect(
      sessionActionGates(record({ windDownKnown: false })).finish_and_close.allowed
    ).toBe(false);
  });

  it("offers stop at boundary on steward and looping-agent sessions only", () => {
    expect(sessionActionGates(record()).stop_at_boundary.allowed).toBe(false);
    for (const origin of ["steward", "looping_agent"]) {
      expect(
        sessionActionGates(record({ session: session({ spawnOrigin: origin }) }))
          .stop_at_boundary.allowed
      ).toBe(true);
    }
  });

  it("falls back to the runner's origin when coord predates D7", () => {
    const rec = record({
      session: session({ spawnOrigin: undefined }),
      windDown: windDown({ spawn_origin: "steward" }),
    });
    expect(originLabel(rec)).toBe("steward");
    expect(sessionActionGates(rec).stop_at_boundary.allowed).toBe(true);
    expect(originLabel(record({ session: session({ spawnOrigin: undefined }) }))).toBe(
      "origin unknown"
    );
  });

  it("offers nothing on a row coord's census does not name", () => {
    const gates = sessionActionGates(record({ session: null }));
    expect(gates.finish_and_close.allowed).toBe(false);
    expect(gates.stop_at_boundary.allowed).toBe(false);
  });
});

describe("joinRunnerSessions", () => {
  it("joins by harness id and keeps a runner-only entry as its own row", () => {
    const read = resolveReadiness(
      body(
        sampleRow({
          wind_down_sessions: [
            windDown({ claude_code_session_id: CLAUDE_A.toUpperCase() }),
            windDown({ claude_code_session_id: CLAUDE_B }),
          ],
        })
      ),
      DEVICE
    );
    const rows = joinRunnerSessions([session()], read);
    expect(rows).toHaveLength(2);
    expect(rows[0].windDown?.claude_code_session_id).toBe(CLAUDE_A.toUpperCase());
    expect(rows[1].session).toBeNull();
    expect(rows[1].windDown?.claude_code_session_id).toBe(CLAUDE_B);
  });

  it("marks every row unknown when readiness is not fresh", () => {
    const rows = joinRunnerSessions([session()], { kind: "stale", ageSecs: 999 });
    expect(rows[0].windDownKnown).toBe(false);
  });

  it("leaves out a closed session", () => {
    expect(
      joinRunnerSessions([session({ closedAt: "2026-09-13T11:00:00Z" })], {
        kind: "loading",
      })
    ).toEqual([]);
  });
});

describe("parseFleetSessions", () => {
  it("reads rows and coord's more-rows signal", () => {
    const parsed = parseFleetSessions({
      sessions: [session(), { nope: true }],
      nextCursor: "abc",
      workAxisColumnsPresent: true,
    });
    expect(parsed).toMatchObject({ ok: true, hasMore: true, workAxisColumnsPresent: true });
    expect(parsed.ok && parsed.rows).toHaveLength(1);
  });

  it("refuses a body with no sessions array rather than reading it as empty", () => {
    expect(parseFleetSessions({ count: 0 }).ok).toBe(false);
  });
});

describe("describeControlError", () => {
  it("reads coord's code from the envelope and from a nested detail", () => {
    expect(describeControlError(409, JSON.stringify({ error: "session_closed" }))).toMatchObject({
      code: "session_closed",
    });
    expect(
      describeControlError(404, JSON.stringify({ detail: { error: "session_not_found" } }))
        .message
    ).toMatch(/no session with this id/);
  });

  it("tells a missing route apart from a missing session", () => {
    expect(describeControlError(404, "Not Found").message).toMatch(
      /does not serve the session control route/
    );
  });

  it("names a 422 as an action this coord does not know", () => {
    expect(describeControlError(422, "{}").message).toMatch(/does not\s+know this action/);
  });
});
