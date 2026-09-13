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
    sharedClaudeIdCount: 1,
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
    const safe = resolveReadiness(
      body(sampleRow({ readiness_safe: true, readiness_blocking: 0 })),
      DEVICE
    );
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

describe("resolveReadiness — which row carries the verdict (contract C1)", () => {
  const SAME_INSTANT = "2026-09-13T10:00:00Z";
  const wslNoReadiness = (overrides: Record<string, unknown> = {}) => ({
    device_id: DEVICE,
    lane: "wsl",
    sampled_at: SAME_INSTANT,
    readiness_age_secs: 20,
    readiness_state: "absent",
    ...overrides,
  });

  it("never lets a wsl row with no readiness win a tie at the same sampled_at", () => {
    const host = sampleRow({ sampled_at: SAME_INSTANT, readiness_reason: "host verdict" });
    // Listed FIRST, same instant, same age: only the ranking can separate them.
    const read = resolveReadiness(body(wslNoReadiness(), host), DEVICE);
    expect(read.kind).toBe("fresh");
    expect(read.kind === "fresh" && read.sample.reason).toBe("host verdict");
  });

  it("prefers the host lane even when both rows are marked fresh", () => {
    const read = resolveReadiness(
      body(
        wslNoReadiness({ readiness_state: "fresh" }),
        sampleRow({ sampled_at: SAME_INSTANT, readiness_reason: "host verdict" })
      ),
      DEVICE
    );
    expect(read.kind === "fresh" && read.sample.reason).toBe("host verdict");
  });

  it("picks the row carrying readiness when coord serves no lane field", () => {
    const { lane: _lane, ...hostless } = sampleRow({
      sampled_at: SAME_INSTANT,
      readiness_reason: "the one with data",
    });
    const bare = { device_id: DEVICE, sampled_at: SAME_INSTANT, readiness_age_secs: 20, readiness_state: "fresh" };
    const read = resolveReadiness(body(bare, hostless), DEVICE);
    expect(read.kind === "fresh" && read.sample.reason).toBe("the one with data");
  });

  it("does not read a verdict off a marked wsl row while the host lane is there", () => {
    const hostUnmarked = {
      device_id: DEVICE,
      lane: "host",
      sampled_at: SAME_INSTANT,
    };
    const read = resolveReadiness(body(wslNoReadiness({ readiness_state: "fresh" }), hostUnmarked), DEVICE);
    expect(read.kind).toBe("not_served");
  });
});

describe("deriveReadinessHealth — verdicts its own inputs cannot back", () => {
  it("renders amber when the runner says safe but reports blockers", () => {
    const read = resolveReadiness(
      body(sampleRow({ readiness_safe: true, readiness_blocking: 3 })),
      DEVICE
    );
    const health = deriveReadinessHealth(read, 0);
    expect(health.level).toBe("amber");
    expect(health.headline).not.toBe("Safe to restart");
    expect(health.detail).toMatch(/runner says safe but reports 3 blocking/);
  });

  it("names exit-stuck sessions in the same contradiction", () => {
    const read = resolveReadiness(
      body(sampleRow({ readiness_safe: true, readiness_blocking: 0, wind_down_exit_stuck: 1 })),
      DEVICE
    );
    expect(deriveReadinessHealth(read, 0).detail).toMatch(/1 exit-stuck/);
  });

  it("says blockers unknown when exit-stuck is null", () => {
    const read = resolveReadiness(body(sampleRow({ wind_down_exit_stuck: null })), DEVICE);
    const health = deriveReadinessHealth(read, 0);
    expect(health.level).toBe("amber");
    expect(health.detail).toMatch(/blockers unknown/);
  });

  it("says blockers unknown while the session census is not read", () => {
    const read = resolveReadiness(body(sampleRow()), DEVICE);
    expect(deriveReadinessHealth(read, null).detail).toMatch(/blockers unknown/);
    expect(deriveReadinessHealth(read, 0).detail).not.toMatch(/blockers unknown/);
  });

  it("stays red on a known author row even when other inputs are unknown", () => {
    const read = resolveReadiness(body(sampleRow({ wind_down_exit_stuck: 2 })), DEVICE);
    const health = deriveReadinessHealth(read, null);
    expect(health.level).toBe("red");
    expect(health.detail).not.toMatch(/blockers unknown/);
  });
});

describe("joinRunnerSessions — an ambiguous Claude session id", () => {
  const read = resolveReadiness(
    body(sampleRow({ wind_down_sessions: [windDown({ spawn_origin: "steward" })] })),
    DEVICE
  );
  const twins = [
    session({ sessionId: "11111111-0000-4000-8000-000000000001", spawnOrigin: "steward" }),
    session({ sessionId: "22222222-0000-4000-8000-000000000002", spawnOrigin: "steward" }),
  ];

  it("withholds the runner's entry, the status and the actions from every twin", () => {
    const rows = joinRunnerSessions(twins, read);
    // Two coord rows, and no extra runner-only row for the consumed entry.
    expect(rows).toHaveLength(2);
    for (const rec of rows) {
      expect(rec.sharedClaudeIdCount).toBe(2);
      expect(rec.windDown).toBeNull();
      const status = deriveRunnerSessionStatus(rec);
      expect(status.kind).toBe("unknown");
      expect(status.reason).toMatch(/2 open coord sessions share/);
      expect(blocksRestartLabel(rec)).toBe("UNKNOWN");
      const gates = sessionActionGates(rec);
      expect(gates.finish_and_close.allowed).toBe(false);
      expect(gates.stop_at_boundary.allowed).toBe(false);
    }
  });

  it("does not count a closed twin", () => {
    const rows = joinRunnerSessions(
      [twins[0], { ...twins[1], closedAt: "2026-09-13T11:00:00Z" }],
      read
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].sharedClaudeIdCount).toBe(1);
    expect(rows[0].windDown).not.toBeNull();
    expect(sessionActionGates(rows[0]).finish_and_close.allowed).toBe(true);
  });
});

describe("describeControlError — who refused a 422", () => {
  it("names the web backend's own validation, through the app envelope", () => {
    const envelope = {
      error: "VALIDATION_ERROR",
      message: "Invalid request data",
      details: [{ field: "body.reason", message: "String should have at most 2000 characters", type: "string_too_long" }],
    };
    const described = describeControlError(422, JSON.stringify(envelope));
    expect(described.message).toMatch(/web backend rejected the request before asking coord/);
    expect(described.message).toMatch(/body\.reason: String should have at most 2000/);
  });

  it("names the web backend's validation from a bare FastAPI body too", () => {
    const bare = { detail: [{ loc: ["body", "action"], msg: "Input should be 'finish_and_close' or 'stop_at_boundary'" }] };
    expect(describeControlError(422, JSON.stringify(bare)).message).toMatch(
      /before asking coord — body\.action: Input should be/
    );
  });

  it("blames coord, not the web, for coord's plain-text 422 the envelope labelled VALIDATION_ERROR", () => {
    // What the app envelope makes of `HTTPException(422, detail=<coord text>)`:
    // the default code for 422, coord's text as the message, and NO `details`.
    const envelope = {
      error: "VALIDATION_ERROR",
      message: "unknown variant `stop_at_boundary`, expected `finish_and_close`",
      timestamp: 1789400000,
      path: "http://testserver/api/v1/operations/sessions/x/control",
    };
    const described = describeControlError(422, JSON.stringify(envelope));
    expect(described.message).toMatch(/^Coord refused the request/);
    expect(described.message).toMatch(/unknown variant `stop_at_boundary`/);
    expect(described.message).not.toMatch(/web backend/);
    // The envelope's default label is not presented as a code coord sent.
    expect(described.code).toBeNull();
  });

  it("names coord's typed 422 as coord's refusal", () => {
    const described = describeControlError(422, JSON.stringify({ error: "unknown_action", message: "x" }));
    expect(described.code).toBe("unknown_action");
    expect(described.message).toMatch(/Coord refused the request \(unknown_action\)/);
    expect(described.message).not.toMatch(/web backend/);
  });
});
