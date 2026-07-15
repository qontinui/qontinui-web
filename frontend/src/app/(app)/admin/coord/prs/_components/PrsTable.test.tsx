import { describe, it, expect } from "vitest";
import { render, within } from "@testing-library/react";
import { PrsTable, MERGE_STATE_LEGEND } from "./PrsTable";
import type { PrRow } from "@/services/admin-dev-service";

/**
 * PrsTable — merge-state badge/tooltip honesty (plan
 * 2026-07-15-merge-train-block-reason-ux Phase 3).
 *
 * UNSTABLE has two honest meanings and its meta is DERIVED per row: a
 * non-required check actually FAILED (warning) vs non-required checks merely
 * still running (muted info). BLOCKED attributes rulesets and names the
 * failing required checks when coord provides `failing_contexts`; coord's
 * `blocking_summary` rides in the same tooltip so GitHub's and coord's
 * lenses appear together. Both UNSTABLE variants appear in the header
 * legend — the operator's contract.
 */

function pr(overrides: Partial<PrRow> = {}): PrRow {
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
    merge_status: "ci-pending",
    blocking_summary: "",
    escalation_alert_id: null,
    proposal_status: null,
    proposal_age_secs: null,
    ...overrides,
  };
}

/** Render one row and return the merge-state badge (text = the state). */
function mergeStateBadge(row: PrRow, badgeText: string): HTMLElement {
  const { getByTestId } = render(<PrsTable prs={[row]} />);
  const tr = getByTestId(`pr-row-${row.repo}-${row.pr_number}`);
  return within(tr).getByText(badgeText);
}

describe("PrsTable derived UNSTABLE meta", () => {
  it("reads 'failed' when coord names a failing non-required check", () => {
    const badge = mergeStateBadge(
      pr({ failing_contexts: ["security"] }),
      "UNSTABLE"
    );
    expect(badge.getAttribute("title")).toContain(
      "non-required check failed"
    );
    expect(badge.getAttribute("title")).toContain("failing checks: security");
  });

  it("reads 'failed' on aggregate ci failure with arrays absent (old coord)", () => {
    const badge = mergeStateBadge(
      pr({ ci_lifecycle: "complete", ci_conclusion: "failure" }),
      "UNSTABLE"
    );
    expect(badge.getAttribute("title")).toContain(
      "non-required check failed"
    );
  });

  it("reads 'still running' when nothing failed — never claims failure", () => {
    const badge = mergeStateBadge(
      pr({ pending_contexts: ["test (windows)"] }),
      "UNSTABLE"
    );
    expect(badge.getAttribute("title")).toContain(
      "non-required checks still running"
    );
    expect(badge.getAttribute("title")).not.toContain("failed");
  });
});

describe("PrsTable BLOCKED tooltip", () => {
  it("attributes rulesets and names the failing required checks", () => {
    const badge = mergeStateBadge(
      pr({
        merge_state_status: "BLOCKED",
        failing_contexts: ["security", "test (windows)"],
        merge_status: "ci-failed",
      }),
      "BLOCKED"
    );
    const title = badge.getAttribute("title") ?? "";
    expect(title).toContain("ruleset/branch-protection");
    expect(title).toContain("failing checks: security, test (windows)");
    // The existing mergeable line survives.
    expect(title).toContain("mergeable: true");
  });

  it("shows coord's blocking_summary next to GitHub's lens", () => {
    const badge = mergeStateBadge(
      pr({
        merge_state_status: "BLOCKED",
        blocking_summary: "required check security failing on head sha",
        merge_status: "ci-failed",
      }),
      "BLOCKED"
    );
    expect(badge.getAttribute("title")).toContain(
      "coord: required check security failing on head sha"
    );
  });
});

describe("merge-state legend (the operator's contract)", () => {
  it("lists BOTH derived UNSTABLE variants with distinct hints", () => {
    const unstable = MERGE_STATE_LEGEND.filter((e) => e.badge === "UNSTABLE");
    expect(unstable).toHaveLength(2);
    const hints = unstable.map((e) => e.hint).join(" | ");
    expect(hints).toContain("non-required check failed");
    expect(hints).toContain("non-required checks still running");
    // The two variants must not share a tone — the color IS the signal.
    expect(new Set(unstable.map((e) => e.tone)).size).toBe(2);
  });

  it("BLOCKED legend hint names rulesets", () => {
    const blocked = MERGE_STATE_LEGEND.find((e) => e.key === "BLOCKED");
    expect(blocked?.hint).toContain("ruleset/branch-protection");
  });
});
