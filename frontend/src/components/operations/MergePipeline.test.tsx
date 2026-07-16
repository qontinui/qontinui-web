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

vi.mock("./useMergePipelineData", () => ({
  useMergePipelineData: () => hookData.current,
}));

// usePrCheckDetails (the on-expand per-check fetch) goes through httpClient.
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import { MergePipeline } from "./MergePipeline";

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
});
