import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import {
  GateDecisionCounts,
  GateDecisionRow,
  MergeTrainRow,
  PrRowDisplay,
} from "./MergeTrain";
import type { BlastRadiusBlock, PrRow, ProposalDetail } from "./mergeTypes";

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

/**
 * GateDecisionRow — repetition, STATED not enumerated (plan
 * 2026-08-20-predicate-eval-surface-counts-evals-not-decisions Phase 2).
 *
 * Coord now returns the newest row per PR with `repeat_count` / `first_seen_at`
 * instead of one row per scheduler tick (measured 2026-08-20: all 50 rows in
 * the default window were the SAME PR, `qontinui-coord#1516`, 547 identical
 * evaluations over 82.7h). The row must say "×547 since <day>" rather than
 * appear 547 times — and must not claim a repeat that coord never reported.
 */
function gateBlock(
  overrides: Partial<BlastRadiusBlock> = {}
): BlastRadiusBlock {
  return {
    repo: "qontinui/qontinui-coord",
    pr_number: 1516,
    tenant_id: "t-1",
    removed_export_name: "SUBCLASS_ORPHAN",
    file: "crates/coord/src/worktree_observer.rs",
    referenced_by: [{ file: "crates/coord/src/worktree_metrics.rs", line: 68 }],
    evaluation_latency_secs: 0.2,
    at: new Date().toISOString(),
    block_reason_code: "removes-referenced-export",
    coverage: 1,
    graph_available: true,
    ...overrides,
  };
}

function renderGateBlock(overrides: Partial<BlastRadiusBlock> = {}) {
  const { container } = render(
    <GateDecisionRow block={gateBlock(overrides)} />
  );
  return container;
}

describe("GateDecisionRow repeat badge", () => {
  it("states the repetition with its first-seen day", () => {
    const container = renderGateBlock({
      repeat_count: 547,
      first_seen_at: "2026-08-15T04:31:00Z",
    });
    const badge = container.querySelector("[data-repeat-count]");
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-repeat-count")).toBe("547");
    expect(badge?.textContent).toContain("×547");
    expect(badge?.textContent).toContain("since 2026-08-15");
    // The count is explained, not just displayed (honesty).
    expect(badge?.getAttribute("title")).toContain("547");
    expect(badge?.getAttribute("title")).toContain("most recent occurrence");
  });

  it("states the count alone when coord sent no first_seen_at", () => {
    const container = renderGateBlock({
      repeat_count: 12,
      first_seen_at: null,
    });
    const badge = container.querySelector("[data-repeat-count]");
    expect(badge?.textContent).toContain("×12");
    expect(badge?.textContent).not.toContain("since");
    // "unknown", not "not reported" — the same null also covers a value coord
    // DID report but that will not parse, and only the weaker claim is true of
    // both causes.
    expect(badge?.getAttribute("title")).toContain("First occurrence unknown");
  });

  it("says 'unknown' — not 'not reported' — for a malformed first_seen_at", () => {
    const container = renderGateBlock({
      repeat_count: 12,
      first_seen_at: "not-a-timestamp",
    });
    const badge = container.querySelector("[data-repeat-count]");
    expect(badge?.textContent).toContain("×12");
    expect(badge?.textContent).not.toContain("since");
    expect(badge?.getAttribute("title")).toContain("First occurrence unknown");
    // Coord DID report it, so the copy must not claim otherwise.
    expect(badge?.getAttribute("title")).not.toContain("not reported");
    // …and no "Invalid Date" leaks into the chip.
    expect(container.textContent).not.toContain("Invalid");
  });

  it("renders no chip for a single, un-repeated decision", () => {
    const container = renderGateBlock({ repeat_count: 1 });
    expect(container.querySelector("[data-repeat-count]")).toBeNull();
  });

  it("renders no chip when repeat_count is absent (pre-Phase-2 coord)", () => {
    const container = renderGateBlock({ repeat_count: undefined });
    expect(container.querySelector("[data-repeat-count]")).toBeNull();
  });

  it("never renders ×0 — a nonsense count degrades to one evaluation", () => {
    const container = renderGateBlock({ repeat_count: 0 });
    expect(container.querySelector("[data-repeat-count]")).toBeNull();
    expect(container.textContent).not.toContain("×0");
  });

  it("still renders the removed-export evidence when coord populates it", () => {
    // The `{block.removed_export_name && (…)}` guard stays — coord's Phase 1
    // fix makes it populate, and a null must keep the block hidden rather than
    // rendering an empty "Removed export:" label.
    const withEvidence = renderGateBlock({ repeat_count: 547 });
    expect(withEvidence.textContent).toContain("SUBCLASS_ORPHAN");
    expect(withEvidence.textContent).toContain(
      "crates/coord/src/worktree_observer.rs"
    );

    const withoutEvidence = renderGateBlock({
      removed_export_name: null,
      file: null,
      referenced_by: [],
    });
    expect(withoutEvidence.textContent).not.toContain("Removed export:");
  });
});

/**
 * GateDecisionCounts — the shared "Gate decisions" header counts, used by BOTH
 * the MergeTrain panel and the MergePipeline hero.
 *
 * The honesty rule under test: `total_evals` is the ONLY signal that coord has
 * split evaluations from decisions. Without it, `total_blocks` is still coord's
 * raw `COUNT(*)` over `coord.pr_events` (1899 rows for 8 PRs, measured
 * 2026-08-20), so the surface must not call it a decision count.
 */
describe("GateDecisionCounts provenance honesty", () => {
  it("names the number a decision count only when total_evals is reported", () => {
    const { container } = render(
      <GateDecisionCounts totalBlocks={8} totalEvals={1899} />
    );
    const badge = container.querySelector("[data-gate-total-blocks]");
    expect(badge?.getAttribute("data-gate-count-provenance")).toBe("decisions");
    expect(badge?.textContent).toBe("8 decisions");
    expect(badge?.getAttribute("title")).toContain("Distinct PRs");
    const evals = container.querySelector("[data-gate-total-evals]");
    expect(evals?.textContent).toBe("1899 evals");
  });

  it("shows the bare number and says so when total_evals is absent", () => {
    const { container } = render(
      <GateDecisionCounts totalBlocks={1899} totalEvals={null} />
    );
    const badge = container.querySelector("[data-gate-total-blocks]");
    expect(badge?.getAttribute("data-gate-count-provenance")).toBe("unknown");
    // No noun — the 1899 is very possibly an audit-row count.
    expect(badge?.textContent).toBe("1899");
    expect(badge?.getAttribute("title")).toContain("has not reported whether");
    expect(badge?.getAttribute("title")).not.toContain("Distinct PRs");
    expect(container.querySelector("[data-gate-total-evals]")).toBeNull();
  });

  it("singularises a lone decision", () => {
    const { container } = render(
      <GateDecisionCounts totalBlocks={1} totalEvals={547} />
    );
    expect(
      container.querySelector("[data-gate-total-blocks]")?.textContent
    ).toBe("1 decision");
  });

  it("suppresses the evals chip when it would add nothing", () => {
    const { container } = render(
      <GateDecisionCounts totalBlocks={8} totalEvals={8} />
    );
    expect(container.querySelector("[data-gate-total-evals]")).toBeNull();
    // The decisions noun still holds — coord DID split the counts.
    expect(
      container
        .querySelector("[data-gate-total-blocks]")
        ?.getAttribute("data-gate-count-provenance")
    ).toBe("decisions");
  });

  it("renders nothing at all before the count has loaded", () => {
    const { container } = render(
      <GateDecisionCounts totalBlocks={null} totalEvals={null} />
    );
    expect(container.querySelector("[data-gate-total-blocks]")).toBeNull();
  });
});
