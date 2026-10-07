/**
 * `custody.ts` — Phase 6's mapping, arm by arm, and the rule that no arm
 * collapses into another (plan
 * `2026-09-19-plan-library-cannot-answer-what-to-work-on-next`, Design
 * decision 1).
 */

import { describe, expect, it } from "vitest";
import type {
  ReconciliationAxisA,
  ReconciliationLiveSession,
} from "@/components/admin/coord/planReconciliationStatus";
import { clockTime, describeClaim, describeCustody } from "./custody";

const NOW = Date.parse("2026-10-06T12:00:00Z");

function axis(over: Partial<ReconciliationAxisA> = {}): ReconciliationAxisA {
  return {
    readable: true,
    present: true,
    status: "in_progress",
    custody_resolved: true,
    live_sessions: [],
    ...over,
  };
}

function session(
  over: Partial<ReconciliationLiveSession> = {}
): ReconciliationLiveSession {
  return {
    device_id: "dev-1",
    updated_at: "2026-10-06T11:55:00Z",
    expires_at: "2026-10-06T12:30:00Z",
    custody: { state: "sole", session_name: "planlib-phase-6" },
    ...over,
  };
}

describe("describeCustody", () => {
  it("sole + name → claimed by <name>, last seen <Xm> ago, expires <HH:MM>", () => {
    const r = describeCustody(axis({ live_sessions: [session()] }), NOW);
    expect(r.kind).toBe("claims");
    expect(r.claims).toHaveLength(1);
    expect(r.claims[0].kind).toBe("sole_named");
    expect(r.claims[0].label).toBe(
      `claimed by planlib-phase-6, last seen 5m ago, expires ${clockTime("2026-10-06T12:30:00Z")}`
    );
  });

  it("sole + null name → claimed by an unnamed session", () => {
    const r = describeCustody(
      axis({
        live_sessions: [
          session({ custody: { state: "sole", session_name: null } }),
        ],
      }),
      NOW
    );
    expect(r.claims[0].kind).toBe("sole_unnamed");
    expect(r.claims[0].label).toBe("claimed by an unnamed session");
  });

  it("ambiguous → N sessions active on this device, never a guessed name", () => {
    const r = describeCustody(
      axis({
        live_sessions: [
          session({
            custody: {
              state: "ambiguous",
              session_name: null,
              live_session_count: 3,
            },
          }),
        ],
      }),
      NOW
    );
    expect(r.claims[0].label).toBe("3 sessions active on this device");
    expect(r.claims[0].title).toContain("coord_who_is_working_on");
    expect(r.label).not.toContain("claimed by");
  });

  it("unresolved → custody UNKNOWN, never no sessions", () => {
    const r = describeCustody(
      axis({ live_sessions: [session({ custody: { state: "unresolved" } })] }),
      NOW
    );
    expect(r.claims[0].label).toBe("custody UNKNOWN");
    expect(r.unknown).toBe(true);
  });

  it("a session row with custody null is UNKNOWN", () => {
    const r = describeCustody(
      axis({ live_sessions: [session({ custody: null })] }),
      NOW
    );
    expect(r.claims[0].label).toBe("custody UNKNOWN");
  });

  it("says no live claim ONLY for an empty live_sessions list", () => {
    expect(describeCustody(axis({ live_sessions: [] }), NOW).label).toBe(
      "no live claim"
    );
    // Absent list, resolved: UNKNOWN, not "no live claim".
    const absent = describeCustody(axis({ live_sessions: null }), NOW);
    expect(absent.kind).toBe("sessions_unknown");
    expect(absent.label).not.toBe("no live claim");
  });

  it("custody_resolved false → custody not resolved (coord did not resolve names)", () => {
    const r = describeCustody(
      axis({ custody_resolved: false, live_sessions: [session()] }),
      NOW
    );
    expect(r.kind).toBe("not_resolved");
    expect(r.label).toBe("custody not resolved (coord did not resolve names)");
    expect(r.unknown).toBe(true);
    expect(r.label).not.toContain("planlib-phase-6");
  });

  it("custody_resolved ABSENT → custody not reported (a distinct UNKNOWN)", () => {
    const r = describeCustody(
      {
        readable: true,
        present: true,
        status: "in_progress",
      },
      NOW
    );
    expect(r.kind).toBe("not_reported");
    expect(r.label).toBe("custody not reported");
    expect(r.unknown).toBe(true);
  });

  it("an unreadable axis A is custody UNKNOWN", () => {
    const r = describeCustody(axis({ readable: false, present: false }), NOW);
    expect(r.kind).toBe("axis_unknown");
    expect(r.label).toBe("custody UNKNOWN");
  });

  it("a stem with no coord unit has no custody to show", () => {
    expect(describeCustody(axis({ present: false }), NOW).kind).toBe(
      "not_applicable"
    );
  });

  it("renders every live session, one claim each", () => {
    const r = describeCustody(
      axis({
        live_sessions: [
          session(),
          session({
            device_id: "dev-2",
            custody: { state: "ambiguous", live_session_count: 2 },
          }),
        ],
      }),
      NOW
    );
    expect(r.claims.map((c) => c.kind)).toEqual(["sole_named", "ambiguous"]);
  });

  it("states an unknown last-seen and expiry rather than inventing them", () => {
    const c = describeClaim(
      session({ updated_at: null, expires_at: null }),
      NOW
    );
    expect(c.label).toBe(
      "claimed by planlib-phase-6, last seen at an unknown time, expiry unknown"
    );
  });
});

describe("clockTime", () => {
  it("formats HH:MM and refuses garbage", () => {
    expect(clockTime("not a time")).toBeNull();
    expect(clockTime(null)).toBeNull();
    expect(clockTime("2026-10-06T12:30:00Z")).toMatch(/^\d{2}:\d{2}$/);
  });
});
