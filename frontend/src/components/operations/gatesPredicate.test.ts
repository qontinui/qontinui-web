import { describe, it, expect } from "vitest";
import {
  gateAnchor,
  humanizeDurationSecs,
  humanizePredicate,
} from "./gatesPredicate";

/**
 * Unit tests for the gate-predicate humanizer (plan
 * 2026-06-05-plan-gate-web-surface-and-productization Phase 2). The
 * humanized string is the load-bearing cell of every gate row, so we pin
 * the shape per predicate kind and the defensive fallbacks (a partial /
 * unknown predicate must never render a blank cell or throw).
 */
describe("humanizePredicate", () => {
  it("renders pr_merged with repo + number", () => {
    expect(
      humanizePredicate({ kind: "pr_merged", repo: "org/repo", pr_number: 42 }),
    ).toBe("pr_merged: org/repo #42");
  });

  it("renders operator_approval with the prompt", () => {
    expect(
      humanizePredicate({ kind: "operator_approval", prompt: "deploy?" }),
    ).toBe('operator_approval: "deploy?"');
  });

  it("renders metric_threshold with labels + op + sustain window", () => {
    expect(
      humanizePredicate({
        kind: "metric_threshold",
        metric: "coord_ci_runner_count",
        labels: { status: "idle" },
        op: "gt",
        value: 0,
      }),
    ).toBe('metric_threshold: coord_ci_runner_count{status="idle"} > 0');
  });

  it("renders metric_threshold sustain window when window_secs is set", () => {
    expect(
      humanizePredicate({
        kind: "metric_threshold",
        metric: "error_rate",
        op: "lt",
        value: 5,
        window_secs: 3_600,
      }),
    ).toBe("metric_threshold: error_rate < 5 for 1h");
  });

  it("renders time_elapsed with a humanized duration", () => {
    const out = humanizePredicate({
      kind: "time_elapsed",
      duration_secs: 604_800,
      since: "2026-06-05T00:00:00Z",
    });
    expect(out.startsWith("time_elapsed: 7d from ")).toBe(true);
  });

  it("renders ci_green with a shortened sha", () => {
    expect(
      humanizePredicate({
        kind: "ci_green",
        repo: "org/repo",
        head_sha: "abcdef1234567890",
      }),
    ).toBe("ci_green: org/repo @ abcdef1");
  });

  it("falls back to the raw kind for an unknown predicate", () => {
    expect(humanizePredicate({ kind: "some_future_kind" })).toBe(
      "some_future_kind",
    );
  });

  it("falls back to the bare kind when variant fields are missing", () => {
    expect(humanizePredicate({ kind: "pr_merged" })).toBe("pr_merged");
  });

  it("never throws on null / malformed input", () => {
    expect(humanizePredicate(null)).toBe("unknown predicate");
    expect(humanizePredicate(undefined)).toBe("unknown predicate");
    // @ts-expect-error — deliberately malformed
    expect(humanizePredicate({})).toBe("unknown predicate");
  });
});

describe("humanizeDurationSecs", () => {
  it("renders whole-unit durations", () => {
    expect(humanizeDurationSecs(604_800)).toBe("7d");
    expect(humanizeDurationSecs(3_600)).toBe("1h");
    expect(humanizeDurationSecs(60)).toBe("1m");
    expect(humanizeDurationSecs(30)).toBe("30s");
  });

  it("handles edge cases", () => {
    expect(humanizeDurationSecs(0)).toBe("0s");
    expect(humanizeDurationSecs(undefined)).toBe("?");
  });
});

describe("gateAnchor", () => {
  it("groups plan-anchored gates under plan_id · phase", () => {
    const anchor = gateAnchor({
      plan_id: "plan-uuid",
      phase_name: "Phase 1",
      claim_kind: null,
      resource_key: null,
    });
    expect(anchor.kind).toBe("plan");
    expect(anchor.key).toBe("plan:plan-uuid:Phase 1");
    expect(anchor.label).toBe("plan-uuid · Phase 1");
  });

  it("groups claim-anchored gates under claim_kind · resource_key", () => {
    const anchor = gateAnchor({
      plan_id: null,
      phase_name: null,
      claim_kind: "ci_notify",
      resource_key: "ci-notify:org/repo",
    });
    expect(anchor.kind).toBe("claim");
    expect(anchor.key).toBe("claim:ci_notify:ci-notify:org/repo");
    expect(anchor.label).toBe("ci_notify · ci-notify:org/repo");
  });
});
