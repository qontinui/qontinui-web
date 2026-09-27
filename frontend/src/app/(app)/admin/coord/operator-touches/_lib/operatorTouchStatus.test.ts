/**
 * operatorTouchStatus — the `/admin/coord/operator-touches` derivations and
 * R3 audit.
 *
 * The load-bearing cases are the ones where a wrong answer looks healthy: an
 * empty store (`not_yet_measured`) must never read as a zero, an `unknown`
 * verdict must never read as the likeliest one, and a `before` page
 * (`aggregate_included: false`) carries no numbers to show at all.
 */

import { describe, expect, it } from "vitest";
import { paletteDisagreements } from "@/components/console/attention";
import {
  TOUCH_ATTENTION_BY_KIND,
  TOUCH_STATUS_PALETTE,
  answerViaSentence,
  deriveTouchStatus,
  deriveTouchesHealth,
  failureSentence,
  parseTouchReadFailure,
  policySentence,
  reasonLabel,
  touchKindChip,
  touchRowKind,
  verdictHeadline,
  type ConstraintVerdict,
  type OperatorTouchesResponse,
} from "./operatorTouchStatus";

const NOW = Date.parse("2026-09-27T12:00:00Z");

const UNKNOWN_VERDICT: ConstraintVerdict = {
  verdict: "unknown",
  reason:
    "neither capacity input binds, and the operator-touch store is not yet measured",
  inputs: {},
  unknown_inputs: [
    "emission_gap: dropped_unacked is not published to coord (Plan B §2g)",
  ],
  computed_at: "2026-09-27T12:00:00Z",
};

const NOT_YET_MEASURED: OperatorTouchesResponse = {
  aggregate_included: true,
  measurement: "not_yet_measured",
  window_days: 7,
  measured_since: null,
  covered_days: null,
  totals: { touches: 0, operator_reaching: 0, agent_dispatchable: 0, unknown: 0 },
  agent_absorbed_rate: null,
  unknown_share: null,
  policy_authorized_split: { yes: 0, no: 0, unknown: 0 },
  reason_classes: [],
  touches: [],
  next_cursor: null,
  constraint_verdict: UNKNOWN_VERDICT,
};

function measured(
  verdict: ConstraintVerdict,
  overrides: Partial<OperatorTouchesResponse> = {}
): OperatorTouchesResponse {
  return {
    ...NOT_YET_MEASURED,
    measurement: "measured",
    measured_since: "2026-09-24T12:00:00Z",
    covered_days: 3,
    totals: { touches: 10, operator_reaching: 4, agent_dispatchable: 5, unknown: 1 },
    agent_absorbed_rate: 0.5,
    unknown_share: 0.1,
    constraint_verdict: verdict,
    ...overrides,
  };
}

function health(
  head: OperatorTouchesResponse | null,
  opts: Partial<{
    loaded: boolean;
    failed: boolean;
    failure: ReturnType<typeof parseTouchReadFailure> | null;
  }> = {}
) {
  return deriveTouchesHealth({
    head,
    loaded: opts.loaded ?? head !== null,
    failed: opts.failed ?? false,
    failure: opts.failure ?? null,
    windowDays: 7,
    now: NOW,
  });
}

function badgeText(h: ReturnType<typeof health>): string[] {
  return h.badges.map((b) => String(b.label));
}

describe("deriveTouchesHealth — R1, derived from the payload on the page", () => {
  it("renders an empty store as NOT YET MEASURED, never a healthy zero", () => {
    const h = health(NOT_YET_MEASURED);
    expect(h.level).toBe("amber");
    expect(h.headline).toBe(
      "Not yet measured — the touch emitter has not run"
    );
    expect(h.measured).toBe(false);
    // Every count is a dash: `touches 0` would assert a measured absence.
    expect(badgeText(h)).toContain("touches –");
    expect(badgeText(h)).not.toContain("touches 0");
    expect(badgeText(h).join(" ")).not.toMatch(/\b0%/);
  });

  it("routes an unrecognised or missing measurement word to unknown, not 'Not yet measured'", () => {
    for (const measurement of ["estimated", null, undefined]) {
      const h = health({ ...NOT_YET_MEASURED, measurement });
      expect(h.level).toBe("amber");
      expect(h.headline).toBe(
        "Unknown — coord reported a measurement this page does not know"
      );
      expect(h.measured).toBe(false);
      expect(badgeText(h)).toContain("touches –");
    }
  });

  it("renders an UNKNOWN verdict as unknown — amber, never the likeliest verdict", () => {
    const h = health(measured(UNKNOWN_VERDICT));
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("The constraint is unknown");
    expect(h.headline).not.toMatch(/you are the constraint/i);
    // coord's own reason rides on the headline's tooltip.
    expect(h.headlineTitle).toBe(UNKNOWN_VERDICT.reason);
  });

  it("a page-1 payload with no verdict shows the dash, not 'unknown inputs 0'", () => {
    const h = health(measured(UNKNOWN_VERDICT, { constraint_verdict: null }));
    const badge = h.badges.find((b) => b.key === "unknown-inputs");
    expect(badge?.label).toBe("unknown inputs –");
    expect(badge?.title).toMatch(/no verdict was served/);
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("The constraint is unknown");
  });

  it("a verdict with no unknown_inputs list is unknown, not 'no verdict'", () => {
    const h = health(
      measured({ ...UNKNOWN_VERDICT, unknown_inputs: null })
    );
    const badge = h.badges.find((b) => b.key === "unknown-inputs");
    expect(badge?.label).toBe("unknown inputs –");
    expect(badge?.title).toMatch(/did not list what it could not see/);
  });

  it("an empty touch store does not hide a capacity verdict", () => {
    const h = health({
      ...NOT_YET_MEASURED,
      constraint_verdict: { ...UNKNOWN_VERDICT, verdict: "machines" },
    });
    expect(h.headline).toBe("Not yet measured — the touch emitter has not run");
    expect(h.detail).toContain("Machines are the constraint");
  });

  it("names every unknown input in the verdict badge", () => {
    const h = health(measured(UNKNOWN_VERDICT));
    const badge = h.badges.find((b) => b.key === "unknown-inputs");
    expect(badge?.label).toBe("unknown inputs 1");
    expect(badge?.title).toContain("emission_gap");
  });

  it("treats a page with aggregate_included:false as carrying no numbers", () => {
    const later: OperatorTouchesResponse = {
      aggregate_included: false,
      measurement: null,
      totals: null,
      agent_absorbed_rate: null,
      unknown_share: null,
      reason_classes: null,
      constraint_verdict: null,
      touches: [],
      next_cursor: null,
    };
    const h = health(later);
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("The constraint is unknown");
    expect(h.measured).toBe(false);
    expect(badgeText(h)).toContain("touches –");
  });

  it("states the operator verdict calmly, with the ask in words (R3's third case)", () => {
    const h = health(
      measured({ ...UNKNOWN_VERDICT, verdict: "operator", reason: "4 touches" })
    );
    expect(h.level).toBe("green");
    expect(h.headline).toBe("You are the constraint — 4 reached you in the last 7 days");
    expect(h.detail).toMatch(/where a policy would absorb them/);
    expect(h.measured).toBe(true);
    expect(badgeText(h)).toEqual(
      expect.arrayContaining([
        "touches 10",
        "reached you 4",
        "agent-absorbable 50.0%",
        "routing unknown 10.0%",
      ])
    );
    expect(h.detail).toContain("covers 3.0 of 7 days");
  });

  it("colours a capacity verdict amber — capacity frees itself", () => {
    for (const verdict of ["machines", "tokens"]) {
      const h = health(measured({ ...UNKNOWN_VERDICT, verdict }));
      expect(h.level).toBe("amber");
      expect(h.headline).toMatch(/are the constraint$/);
    }
  });

  it("never paints the strip red", () => {
    const heads: (OperatorTouchesResponse | null)[] = [
      null,
      NOT_YET_MEASURED,
      measured(UNKNOWN_VERDICT),
      measured({ ...UNKNOWN_VERDICT, verdict: "operator" }),
      measured({ ...UNKNOWN_VERDICT, verdict: "tokens" }),
    ];
    for (const head of heads) {
      expect(health(head).level).not.toBe("red");
    }
  });

  it("an unrecognised verdict word is unknown, not guessed", () => {
    const h = health(measured({ ...UNKNOWN_VERDICT, verdict: "network" }));
    expect(h.level).toBe("amber");
    expect(h.headline).toMatch(/^The constraint is unknown/);
  });

  it("is amber with dashes while nothing has answered", () => {
    const h = health(null, { loaded: false });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Reading operator touches…");
    expect(badgeText(h)).toContain("touches –");
  });

  it("names coord's 503 reason when the store is unreadable — unknown, not empty", () => {
    const failure = parseTouchReadFailure(
      new Error(
        'GET /api/v1/operations/coord/operator-touches?window_days=7 failed: 503 - {"error":"schema_migration_pending","detail":"42P01"}'
      )
    );
    const h = health(null, { loaded: false, failed: true, failure });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Operator touches could not be read");
    expect(h.detail).toContain("migration is pending");
    expect(h.detail).toContain("dash, not a zero");
    expect(badgeText(h)).toContain("touches –");
  });

  it("a failed refresh after a good read keeps the numbers and says they are stale", () => {
    const h = health(measured({ ...UNKNOWN_VERDICT, verdict: "operator" }), {
      failed: true,
    });
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("These numbers stopped updating");
    expect(h.detail).toMatch(/^Last refresh failed/);
    expect(h.measured).toBe(false);
  });
});

describe("parseTouchReadFailure / failureSentence", () => {
  it("recovers coord's typed code from the proxied body", () => {
    const f = parseTouchReadFailure(
      new Error('GET /x failed: 503 - {"error":"db_unavailable","detail":"pool"}')
    );
    expect(f).toEqual({ status: 503, code: "db_unavailable", detail: "pool" });
    expect(failureSentence(f)).toMatch(/database did not answer/);
  });

  it("keeps the status for a non-JSON body and says nothing it cannot know", () => {
    const f = parseTouchReadFailure(new Error("GET /x failed: 502 - <html>"));
    expect(f).toEqual({ status: 502, code: null, detail: null });
    expect(failureSentence(f)).toBe("coord answered HTTP 502");
  });

  it("an error with no status is 'could not be reached'", () => {
    const f = parseTouchReadFailure(new Error("network down"));
    expect(f.status).toBeNull();
    expect(failureSentence(f)).toBe("coord could not be reached");
  });

  it("names the refusal of a bad query with coord's detail", () => {
    const f = parseTouchReadFailure(
      new Error(
        'GET /x failed: 400 - {"error":"bad_request","detail":"window_days must be one of [7, 30], got 14"}'
      )
    );
    expect(failureSentence(f)).toBe(
      "coord refused the query: window_days must be one of [7, 30], got 14"
    );
  });
});

describe("row status and the R3 table", () => {
  it("agrees with its palette (red iff author, amber iff waiting)", () => {
    expect(
      paletteDisagreements(TOUCH_ATTENTION_BY_KIND, TOUCH_STATUS_PALETTE)
    ).toEqual([]);
  });

  it("has no red kind — nothing on this page is a demand", () => {
    expect(Object.values(TOUCH_ATTENTION_BY_KIND)).not.toContain("author");
  });

  it("maps each disposition to a human badge", () => {
    expect(deriveTouchStatus({ disposition: "operator_reaching" }).label).toBe(
      "Reached you"
    );
    expect(deriveTouchStatus({ disposition: "agent_dispatchable" }).label).toBe(
      "Agent can handle"
    );
    const unknown = deriveTouchStatus({ disposition: "unknown" });
    expect(unknown.label).toBe("Routing unknown");
    expect(unknown.attention).toBe("waiting");
  });

  it("floors an unrecognised disposition at amber, including a prototype key", () => {
    expect(touchRowKind("escalated")).toBe("unrecognised");
    expect(touchRowKind("constructor")).toBe("unrecognised");
    expect(touchRowKind(null)).toBe("unrecognised");
    expect(deriveTouchStatus({ disposition: "escalated" }).attention).toBe(
      "waiting"
    );
  });

  it("never puts a wire word in a row label (R8)", () => {
    for (const status of [
      deriveTouchStatus({ disposition: "operator_reaching" }),
      deriveTouchStatus({ disposition: "agent_dispatchable" }),
      deriveTouchStatus({ disposition: "unknown" }),
    ]) {
      expect(status.label).not.toMatch(/_/);
      expect(status.reason ?? "").not.toMatch(/operator_reaching|agent_dispatchable/);
    }
  });
});

describe("human labels (R8)", () => {
  it("labels every starter reason code in words", () => {
    for (const code of [
      "unclassified",
      "operator_held_resource",
      "closed_list_escalation",
      "design_fork",
      "question_policy_already_answers",
      "handback_incomplete",
      "self_narrowed_scope",
      "permission_prompt_on_granted_ground",
    ]) {
      const label = reasonLabel(code);
      expect(label).not.toMatch(/_/);
      expect(label.toLowerCase()).not.toContain("unclassified");
    }
  });

  it("names an unknown code without showing it", () => {
    expect(reasonLabel("brand_new_code")).toBe(
      "A reason this page does not know yet"
    );
    expect(reasonLabel("toString")).toBe("A reason this page does not know yet");
  });

  it("chips the touch kind and reads policy in words", () => {
    expect(touchKindChip("permission_prompt")).toBe("permission");
    expect(touchKindChip("hasOwnProperty")).toBe("touch");
    expect(policySentence("no")).toBe("policy did not call for stopping here");
    expect(policySentence("maybe")).toBe("not yet judged against policy");
  });

  it("says where the named item stands", () => {
    expect(answerViaSentence(null)).toBe("Names no item that could be answered");
    expect(
      answerViaSentence({ kind: "question", id: "q1", state: "pending" })
    ).toBe("The question is still waiting for an answer");
    expect(answerViaSentence({ kind: "gate", id: "g1", state: "cleared" })).toBe(
      "The gate cleared"
    );
    expect(answerViaSentence({ kind: "gate", id: null, state: "missing" })).toBe(
      "The gate it names is gone or belongs elsewhere"
    );
  });

  it("verdictHeadline of an absent verdict is unknown", () => {
    expect(verdictHeadline(null)).toBe("The constraint is unknown");
  });
});
