// Arming tests for the BEHIND freshen reading (plan
// 2026-10-27-behind-main-no-action-needed-is-promised-without-reading-whether-coord-will-act).
//
// Each test enters ONLY through an export that existed before the change
// (`buildPipelineRows`, `derivePipelineHealth`) and feeds it a served row, so
// it is red when the freshen reading is removed rather than failing to import.
// The exhaustive tables live in prPipeline.test.ts.

import { describe, expect, it } from "vitest";
import type { PrRow } from "./mergeTypes";
import { buildPipelineRows, derivePipelineHealth } from "./prPipeline";

const NOW = new Date("2026-11-04T12:00:00Z").getTime();

function behindRow(n: number, extra: Record<string, unknown> = {}): PrRow {
  return {
    repo: "qontinui/qontinui-web",
    pr_number: n,
    branch: `b${n}`,
    base_branch: "main",
    head_sha: `h${n}`,
    pr_state: "open",
    mergeable: true,
    merge_state_status: "BEHIND",
    review_decision: null,
    required_checks_satisfied: true,
    last_refreshed_at: new Date(NOW - 60_000).toISOString(),
    last_predicate_eval_at: null,
    ci_lifecycle: "complete",
    ci_conclusion: "success",
    correlation_id: null,
    merge_status: "behind-base",
    ...extra,
  } as PrRow;
}

function freshen(state: string, extra: Record<string, unknown> = {}) {
  return {
    state,
    attempts: 2,
    max_attempts: 6,
    last_attempt_at: "2026-11-02T17:13:00Z",
    skip: null,
    reason: "served",
    ...extra,
  };
}

describe("arming: BEHIND rows read coord's served freshen state", () => {
  it("an exhausted freshen renders as needing an author, not as no action needed", () => {
    const status = buildPipelineRows(
      [
        behindRow(1, {
          freshen: freshen("exhausted", { attempts: 9, max_attempts: 9 }),
        }),
      ],
      []
    )[0].status;
    expect(status.attention).toBe("author");
    expect(status.reason).toContain("after 9 tries");
    expect(status.reason).not.toMatch(/no action needed/i);
  });

  it("the health summary counts BEHIND rows per freshen state", () => {
    const rows = buildPipelineRows(
      [
        behindRow(1, { freshen: freshen("eligible") }),
        behindRow(2, { freshen: freshen("exhausted") }),
        behindRow(3),
        behindRow(4, { merge_status: "review-required" }),
      ],
      []
    );
    const behind = (
      derivePipelineHealth(rows, NOW) as unknown as {
        behind?: Record<string, number>;
      }
    ).behind;
    expect(behind).toMatchObject({
      eligible: 1,
      exhausted: 1,
      unknown: 1,
      held: 1,
    });
  });
});
