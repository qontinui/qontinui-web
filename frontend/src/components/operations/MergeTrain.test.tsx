import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MergeTrainRow, PrRowDisplay } from "./MergeTrain";
import type { PrRow, ProposalDetail } from "./mergeTypes";

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

/**
 * PrRowDisplay — UNSTABLE tint split (plan
 * 2026-07-15-merge-train-block-reason-ux Phase 3). UNSTABLE has two honest
 * meanings: a non-required check actually FAILED (red — worth a look) vs
 * checks merely still running (muted yellow — just wait). The split uses the
 * shared `unstableHasFailure` predicate, preferring coord's named
 * `failing_contexts` and falling back to the aggregate `ci_conclusion` when
 * the arrays are absent (older coord deploys).
 */

function prRow(overrides: Partial<PrRow> = {}): PrRow {
  return {
    repo: "qontinui/qontinui-web",
    pr_number: 761,
    branch: "feat/thing",
    base_branch: "main",
    head_sha: "abc123",
    pr_state: "open",
    mergeable: true,
    merge_state_status: "UNSTABLE",
    review_decision: null,
    required_checks_satisfied: true,
    last_refreshed_at: new Date().toISOString(),
    last_predicate_eval_at: null,
    ci_lifecycle: "pending",
    ci_conclusion: null,
    correlation_id: null,
    ...overrides,
  };
}

function renderedRow(overrides: Partial<PrRow> = {}) {
  const { container } = render(<PrRowDisplay pr={prRow(overrides)} />);
  const row = container.querySelector(
    '[data-pr-merge-state-status="UNSTABLE"]'
  );
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

describe("PrRowDisplay UNSTABLE tint split", () => {
  it("tints red when a named non-required check failed", () => {
    const row = renderedRow({ failing_contexts: ["security"] });
    expect(row.className).toContain("bg-red-500/15");
  });

  it("tints red on aggregate ci failure with arrays absent (old coord)", () => {
    const row = renderedRow({
      ci_lifecycle: "complete",
      ci_conclusion: "failure",
    });
    expect(row.className).toContain("bg-red-500/15");
  });

  it("tints muted (not red) while non-required checks only run", () => {
    const row = renderedRow({ pending_contexts: ["test (windows)"] });
    expect(row.className).not.toContain("bg-red-500/15");
    expect(row.className).toContain("bg-yellow-500/10");
  });

  it("tints muted when the context arrays are absent and CI is pending", () => {
    const row = renderedRow();
    expect(row.className).not.toContain("bg-red-500/15");
    expect(row.className).toContain("bg-yellow-500/10");
  });
});
