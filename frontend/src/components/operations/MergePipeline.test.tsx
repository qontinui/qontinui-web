/**
 * MergePipeline — the unified PR pipeline hero.
 *
 * Verifies the redesign's core contracts at the component level (the
 * derivation itself is covered in prPipeline.test.ts): one row per PR with
 * a plain-language status, the traffic-light health strip, the
 * needs-attention filter, and the expandable detail with the
 * merge-candidate CI link.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { MergePipelineData } from "./useMergePipelineData";
import type { PrRow, ProposalDetail } from "./mergeTypes";

const hookData: { current: MergePipelineData } = {
  current: {
    proposals: [],
    prs: [],
    suggestions: [],
    gateBlocks: [],
    gateTotalBlocks: 0,
    error: null,
    suggestionBusy: null,
    onSuggestionAction: () => {},
  },
};

// The hook is stubbed, but the module also exports the merged-tab lookback
// constant the component renders — keep the real value so the empty-state
// copy under test is the one operators see. (Literal, not a reference:
// `vi.mock` factories are hoisted above const declarations.)
vi.mock("./useMergePipelineData", () => ({
  useMergePipelineData: () => hookData.current,
  MERGED_LOOKBACK_HOURS: 48,
}));
const MERGED_LOOKBACK_HOURS = 48;

// usePrCheckDetails (the on-expand per-check fetch) goes through httpClient.
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { MergePipeline, STATUS_BADGE_CLASS } from "./MergePipeline";
import { ATTENTION_BY_KIND, type UnifiedStatusKind } from "./prPipeline";

function pr(overrides: Partial<PrRow> = {}): PrRow {
  return {
    repo: "qontinui/qontinui-web",
    pr_number: 761,
    branch: "feat/thing",
    base_branch: "main",
    head_sha: "abc123",
    pr_state: "open",
    mergeable: true,
    merge_state_status: "CLEAN",
    review_decision: null,
    required_checks_satisfied: true,
    last_refreshed_at: new Date().toISOString(),
    last_predicate_eval_at: null,
    ci_lifecycle: "complete",
    ci_conclusion: "success",
    correlation_id: null,
    ...overrides,
  };
}

function proposal(overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    proposal_id: "p-1",
    agent_id: "agent-0123456789",
    status: "awaiting-ci",
    requires_clean_ci: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    repos: [
      {
        repo: "qontinui/qontinui-web",
        branch: "feat/thing",
        head_sha: "abc123",
        ci_run_url: "https://github.com/qontinui/qontinui-web/actions/runs/9",
      },
    ],
    ...overrides,
  };
}

describe("MergePipeline", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    hookData.current = {
      ...hookData.current,
      proposals: [],
      prs: [],
      error: null,
    };
  });

  it("renders one unified row per PR — proposal state wins, no jargon", () => {
    hookData.current.prs = [pr()];
    hookData.current.proposals = [proposal({ status: "dry-rebasing" })];

    render(<MergePipeline />);

    const rows = screen.getAllByTestId("pipeline-row");
    expect(rows).toHaveLength(1);
    // The unified label, not the scheduler enum.
    expect(screen.getByText("Testing merge")).toBeInTheDocument();
    expect(screen.queryByText("dry-rebasing")).not.toBeInTheDocument();
    expect(screen.getByText("qontinui-web#761")).toBeInTheDocument();
  });

  it("shows a green health strip when merging normally and red when stuck", () => {
    hookData.current.prs = [pr()];
    hookData.current.proposals = [proposal()];
    const { unmount } = render(<MergePipeline />);
    expect(screen.getByTestId("pipeline-health").dataset.healthLevel).toBe(
      "green"
    );
    unmount();

    hookData.current.prs = [
      pr({ branch: "b1", pr_number: 1 }),
      pr({ branch: "b2", pr_number: 2 }),
    ];
    hookData.current.proposals = [
      proposal({
        proposal_id: "c1",
        status: "conflict",
        repos: [
          { repo: "qontinui/qontinui-web", branch: "b1", head_sha: "a" },
        ],
      }),
      proposal({
        proposal_id: "c2",
        status: "conflict",
        repos: [
          { repo: "qontinui/qontinui-web", branch: "b2", head_sha: "b" },
        ],
      }),
    ];
    render(<MergePipeline />);
    expect(screen.getByTestId("pipeline-health").dataset.healthLevel).toBe(
      "red"
    );
    expect(screen.getByText("Pipeline stuck")).toBeInTheDocument();
  });

  it("filters to needs-attention rows", () => {
    hookData.current.prs = [
      pr({ branch: "b-ok", pr_number: 1 }),
      pr({ branch: "b-bad", pr_number: 2 }),
    ];
    hookData.current.proposals = [
      proposal({
        proposal_id: "c",
        status: "conflict",
        error: "merge conflict in src/a.rs",
        repos: [
          { repo: "qontinui/qontinui-web", branch: "b-bad", head_sha: "x" },
        ],
      }),
    ];

    render(<MergePipeline />);
    expect(screen.getAllByTestId("pipeline-row")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("pipeline-filter-attention"));
    const rows = screen.getAllByTestId("pipeline-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("qontinui-web#2");
  });

  it("expands a row into detail with the merge-candidate CI link", () => {
    hookData.current.prs = [pr()];
    hookData.current.proposals = [proposal({ status: "awaiting-ci" })];

    render(<MergePipeline />);
    fireEvent.click(screen.getByText("Awaiting CI"));

    const ciLink = screen.getByText("Candidate CI run").closest("a");
    expect(ciLink).toHaveAttribute(
      "href",
      "https://github.com/qontinui/qontinui-web/actions/runs/9"
    );
    // The recurring confusion gets addressed in-place.
    expect(
      screen.getByText(/not on your branch/i)
    ).toBeInTheDocument();
    // Raw ids stay available for support, in the debug footer only.
    expect(screen.getByText(/proposal p-1/)).toBeInTheDocument();
  });

  it("renders the empty state once loaded with nothing to show", () => {
    render(<MergePipeline />);
    expect(screen.getByTestId("pipeline-empty")).toHaveTextContent(
      "No open PRs or merge activity."
    );
  });

  // --------------------------------------------------------------------------
  // Failing-check details (plan 2026-07-16-pr-failing-check-details-expandable)
  // --------------------------------------------------------------------------

  const failingPr = () =>
    pr({
      merge_state_status: "UNSTABLE",
      ci_conclusion: "failure",
      failing_contexts: ["security", "docs"],
    });

  it("expanded failing row fetches and shows named checks with run links", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        lifecycle: "complete",
        conclusion: "failure",
        checks: [
          {
            name: "security",
            status: "completed",
            conclusion: "failure",
            completed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
            details_url:
              "https://github.com/qontinui/qontinui-web/actions/runs/42",
          },
          {
            name: "lint",
            status: "completed",
            conclusion: "success",
            completed_at: new Date().toISOString(),
            details_url:
              "https://github.com/qontinui/qontinui-web/actions/runs/43",
          },
          {
            name: "docs",
            status: "completed",
            conclusion: "cancelled",
            completed_at: null,
            details_url: null,
          },
        ],
      }),
    });
    hookData.current.prs = [failingPr()];

    render(<MergePipeline />);
    fireEvent.click(screen.getByText("Checks failing"));

    await waitFor(() =>
      expect(screen.getAllByTestId("failing-check-row")).toHaveLength(2)
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/pr-merge/prs/qontinui%2Fqontinui-web/761/checks"
    );

    const rows = screen.getAllByTestId("failing-check-row");
    const securityRow = rows.find((r) => r.textContent?.includes("security"));
    const docsRow = rows.find((r) => r.textContent?.includes("docs"));
    expect(securityRow).toBeDefined();
    expect(docsRow).toBeDefined();
    // Failed check links to its run and shows when it completed.
    expect(within(securityRow!).getByText("View run").closest("a")).toHaveAttribute(
      "href",
      "https://github.com/qontinui/qontinui-web/actions/runs/42"
    );
    expect(securityRow!).toHaveTextContent("5m ago");
    // Passing checks never render in the failing list.
    expect(screen.queryByText("lint")).not.toBeInTheDocument();
    // No details_url + no completed_at -> name-only row, never a dead button.
    expect(docsRow!.querySelector("a")).toBeNull();
  });

  it("falls back to failing_contexts chips when the fetch fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    hookData.current.prs = [failingPr()];

    render(<MergePipeline />);
    fireEvent.click(screen.getByText("Checks failing"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // The block still names the checks from the row's own data...
    const block = await screen.findByTestId("failing-checks");
    expect(within(block).getByText("security")).toBeInTheDocument();
    expect(within(block).getByText("docs")).toBeInTheDocument();
    // ...but never renders detail rows or dead links it doesn't have.
    await waitFor(() => {
      expect(screen.queryAllByTestId("failing-check-row")).toHaveLength(0);
      expect(within(block).queryByText("View run")).not.toBeInTheDocument();
    });
  });

  it("does not fetch check details for a non-failing expanded row", () => {
    hookData.current.prs = [pr()];
    hookData.current.proposals = [proposal({ status: "awaiting-ci" })];

    render(<MergePipeline />);
    fireEvent.click(screen.getByText("Awaiting CI"));

    // Detail is open (the candidate CI link renders) yet no checks fetch.
    expect(screen.getByText("Candidate CI run")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("failing-checks")).not.toBeInTheDocument();
  });

  // --------------------------------------------------------------------------
  // Color encodes WHO MUST ACT, and every badge explains itself
  // --------------------------------------------------------------------------

  it("keys the badge palette off attention — red only for author-action", () => {
    // The contract in one assertion: red iff someone must act, amber iff the
    // row waits on something else, neither otherwise. A future badge that
    // paints "CI still running" red (the original bug) fails here.
    for (const [kind, attention] of Object.entries(ATTENTION_BY_KIND)) {
      const cls = STATUS_BADGE_CLASS[kind as UnifiedStatusKind];
      expect(cls, `${kind} has no badge class`).toBeTruthy();
      expect(/\bbg-red-/.test(cls), `${kind} red?`).toBe(attention === "author");
      expect(/\bbg-amber-/.test(cls), `${kind} amber?`).toBe(
        attention === "waiting"
      );
    }
  });

  it("in-progress checks are yellow and NOT counted as needing attention", () => {
    hookData.current.prs = [
      pr({
        merge_state_status: "BLOCKED",
        required_checks_satisfied: false,
        ci_lifecycle: "pending",
        ci_conclusion: null,
        pending_contexts: ["test (windows)"],
      }),
    ];

    render(<MergePipeline />);

    const badge = screen.getByText("Checks in progress");
    expect(badge.className).toContain("bg-yellow-");
    expect(badge.className).not.toContain("bg-red-");
    // The health strip's attention counter must ignore it entirely.
    expect(screen.queryByText(/needs attention/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("pipeline-filter-attention"));
    expect(screen.queryAllByTestId("pipeline-row")).toHaveLength(0);
  });

  it("every badge carries its reason as a hover title, plus inline text", () => {
    hookData.current.prs = [pr({ mergeable: false })];

    render(<MergePipeline />);

    // The badge prefixes an "✕ " glyph, so query it by its status kind.
    const badge = document.querySelector('[data-status-kind="not-mergeable"]');
    expect(badge?.getAttribute("title")).toContain("Not mergeable — conflict");
    expect(screen.getByTestId("row-reason")).toHaveTextContent(/conflict/);
  });

  // --------------------------------------------------------------------------
  // Merged tab
  // --------------------------------------------------------------------------

  const mergedPr = (n: number, minutesAgo: number, sha: string) =>
    pr({
      pr_number: n,
      branch: `b-${n}`,
      pr_state: "closed", // coord ff-land shape
      merge_commit_sha: sha,
      merged_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    });

  it("lists merged PRs newest-first with their merge time", () => {
    hookData.current.prs = [
      mergedPr(1, 600, "aaaaaaa1111"),
      mergedPr(2, 5, "bbbbbbb2222"),
      pr({ pr_number: 3, branch: "b-open" }),
    ];

    render(<MergePipeline />);

    // Merged rows are history — the live list does not carry them.
    expect(screen.getAllByTestId("pipeline-row")).toHaveLength(1);

    fireEvent.click(screen.getByTestId("pipeline-filter-merged"));
    const rows = screen.getAllByTestId("pipeline-row");
    expect(rows).toHaveLength(2);
    // Most recent merge on top.
    expect(rows[0]).toHaveTextContent("qontinui-web#2");
    expect(rows[1]).toHaveTextContent("qontinui-web#1");
    // Merge time, relative in the row and absolute on hover.
    expect(within(rows[0]).getByTestId("row-time")).toHaveTextContent(
      "merged 5m ago"
    );
    expect(
      within(rows[1]).getByTestId("row-time").getAttribute("title")
    ).toMatch(/^Merged /);
  });

  it("says so instead of inventing a time when coord reports no merged_at", () => {
    hookData.current.prs = [pr({ pr_state: "merged" })];

    render(<MergePipeline />);
    fireEvent.click(screen.getByTestId("pipeline-filter-merged"));

    const time = screen.getByTestId("row-time");
    expect(time).toHaveTextContent("merged");
    expect(time).not.toHaveTextContent(/ago/);
    expect(time.getAttribute("title")).toContain("did not report a merge time");
  });

  it("has its own empty state naming the lookback window", () => {
    hookData.current.prs = [pr()];

    render(<MergePipeline />);
    fireEvent.click(screen.getByTestId("pipeline-filter-merged"));

    expect(screen.getByTestId("pipeline-empty")).toHaveTextContent(
      `Nothing merged in the last ${MERGED_LOOKBACK_HOURS} hours.`
    );
  });
});
