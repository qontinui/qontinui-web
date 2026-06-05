import { describe, it, expect } from "vitest";
import {
  gateAnchor,
  humanizeDurationSecs,
  humanizePredicate,
  summarizeContinuation,
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

  it("renders plan_ready as 'Plan ready to implement' with the slug", () => {
    expect(
      humanizePredicate({
        kind: "plan_ready",
        plan_slug: "2026-06-05-visible-gate-continuations",
      }),
    ).toBe("Plan ready to implement: 2026-06-05-visible-gate-continuations");
  });

  it("renders plan_ready without a slug as the bare label", () => {
    expect(humanizePredicate({ kind: "plan_ready" })).toBe(
      "Plan ready to implement",
    );
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

  it("prefers plan_slug over plan_id in the label when present", () => {
    const anchor = gateAnchor({
      plan_id: "plan-uuid",
      phase_name: "Phase 2",
      plan_slug: "2026-06-05-plan-gate-web-surface",
      claim_kind: null,
      resource_key: null,
    });
    expect(anchor.kind).toBe("plan");
    // Key stays anchored on plan_id so slug-bearing and slug-less rows of the
    // same plan still collapse into one group.
    expect(anchor.key).toBe("plan:plan-uuid:Phase 2");
    expect(anchor.label).toBe(
      "2026-06-05-plan-gate-web-surface · Phase 2",
    );
  });

  it("falls back to plan_id in the label when plan_slug is absent/empty", () => {
    expect(
      gateAnchor({
        plan_id: "plan-uuid",
        phase_name: "Phase 1",
        claim_kind: null,
        resource_key: null,
      }).label,
    ).toBe("plan-uuid · Phase 1");
    // An empty-string slug (lagging coord) also falls back, never a blank cell.
    expect(
      gateAnchor({
        plan_id: "plan-uuid",
        phase_name: "Phase 1",
        plan_slug: "",
        claim_kind: null,
        resource_key: null,
      }).label,
    ).toBe("plan-uuid · Phase 1");
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

/**
 * Continuation summary — the predictability affordance on a gate row (plan
 * 2026-06-05-visible-gate-continuations-and-plan-ready-predicate P3). Pins:
 * absent presentation == terminal (default), headless wording, prompt
 * first-line + truncation, device shortening, and the graceful-degrade nulls
 * (no continuation → no summary, never a crash) so the panel stays honest
 * while coord PR #356 is unmerged.
 */
describe("summarizeContinuation", () => {
  it("treats an ABSENT presentation as a visible terminal session", () => {
    expect(
      summarizeContinuation({
        target_device_id: "abcdef1234567890",
        initial_prompt: "Implement P3 of the plan",
      }),
    ).toBe(
      'Clearing opens a visible terminal session on abcdef12 · prompt: "Implement P3 of the plan"',
    );
  });

  it("treats an explicit terminal presentation the same as absent", () => {
    expect(
      summarizeContinuation({
        target_device_id: "abcdef1234567890",
        presentation: "terminal",
        initial_prompt: "go",
      }),
    ).toBe(
      'Clearing opens a visible terminal session on abcdef12 · prompt: "go"',
    );
  });

  it("says 'headless agent session' for presentation: headless", () => {
    expect(
      summarizeContinuation({
        target_device_id: "abcdef1234567890",
        presentation: "headless",
        initial_prompt: "run the fleet job",
      }),
    ).toBe(
      'Clearing spawns a headless agent session on abcdef12 · prompt: "run the fleet job"',
    );
  });

  it("uses only the first line of a multi-line prompt", () => {
    const out = summarizeContinuation({
      target_device_id: "abcdef1234567890",
      initial_prompt: "First line of the prompt\nSecond line\nThird line",
    });
    expect(out).toContain('prompt: "First line of the prompt"');
    expect(out).not.toContain("Second line");
  });

  it("truncates a long prompt first line to ~80 chars with an ellipsis", () => {
    const longLine = "x".repeat(200);
    const out = summarizeContinuation({
      target_device_id: "abcdef1234567890",
      initial_prompt: longLine,
    })!;
    // 80 chars of prompt + the U+2026 ellipsis inside the quotes.
    expect(out).toContain(`prompt: "${"x".repeat(80)}…"`);
  });

  it("prefers a resolved hostname over the short device id", () => {
    expect(
      summarizeContinuation(
        {
          target_device_id: "abcdef1234567890",
          initial_prompt: "go",
        },
        () => "spaceship",
      ),
    ).toBe('Clearing opens a visible terminal session on spaceship · prompt: "go"');
  });

  it("falls back to the short device id when the resolver returns null", () => {
    const out = summarizeContinuation(
      { target_device_id: "abcdef1234567890", initial_prompt: "go" },
      () => null,
    );
    expect(out).toContain("on abcdef12");
  });

  it("omits the prompt clause when there is no prompt", () => {
    expect(
      summarizeContinuation({ target_device_id: "abcdef1234567890" }),
    ).toBe("Clearing opens a visible terminal session on abcdef12");
  });

  it("says 'an unknown device' when no device id is present", () => {
    expect(summarizeContinuation({ initial_prompt: "go" })).toBe(
      'Clearing opens a visible terminal session on an unknown device · prompt: "go"',
    );
  });

  it("returns null for no / empty continuation (degrades to no summary)", () => {
    expect(summarizeContinuation(null)).toBeNull();
    expect(summarizeContinuation(undefined)).toBeNull();
  });
});
