import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MergeTrainRow } from "./MergeTrain";
import type { ProposalDetail } from "./mergeTypes";

/**
 * MergeTrainRow — requeue_count starvation badge.
 *
 * The badge surfaces coord's `requeue_count` (PR #423, plan
 * `2026-06-07-merge-scheduler-takeover-requeue-starvation`): the number of
 * times the leader-takeover recovery sweep blind-requeued the proposal. Per
 * the UX priority discoverability-without-clutter, the badge is rendered ONLY
 * when the count is > 0 — a never-churned (0) or older-coord (undefined)
 * proposal shows no chip.
 */

function proposal(overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    proposal_id: "p1",
    agent_id: "agent-0123456789",
    status: "queued",
    requires_clean_ci: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    repos: [{ repo: "qontinui-web", branch: "feat/x", head_sha: "abc123" }],
    ...overrides,
  };
}

describe("MergeTrainRow requeue badge", () => {
  it("renders the requeue badge when requeue_count > 0", () => {
    const { container, getByText } = render(
      <MergeTrainRow proposal={proposal({ requeue_count: 3 })} />
    );
    const badge = container.querySelector("[data-requeue-count]");
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-requeue-count")).toBe("3");
    // Count is visible in the chip text…
    expect(getByText(/×3/)).toBeTruthy();
    // …and explained in the tooltip (honesty).
    expect(badge?.getAttribute("title")).toContain("starvation signal");
    expect(badge?.getAttribute("title")).toContain("3");
  });

  it("does NOT render the badge when requeue_count is 0 (no clutter)", () => {
    const { container } = render(
      <MergeTrainRow proposal={proposal({ requeue_count: 0 })} />
    );
    expect(container.querySelector("[data-requeue-count]")).toBeNull();
  });

  it("does NOT render the badge when requeue_count is absent (older coord)", () => {
    const { container } = render(
      <MergeTrainRow proposal={proposal({ requeue_count: undefined })} />
    );
    expect(container.querySelector("[data-requeue-count]")).toBeNull();
  });
});
