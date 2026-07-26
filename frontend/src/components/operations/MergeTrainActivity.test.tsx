/**
 * MergeTrainActivity — the pipeline's "Train" tab.
 *
 * The derivation is covered in `trainActivity.test.ts`; this file covers the
 * rendering contracts an operator depends on: the pause clock is visible
 * without expanding anything, a fleet-wide cause is stated ABOVE the per-repo
 * rows (so it is not mistaken for a per-repo problem), the per-repo phase and
 * its dwell are on the collapsed row, and credentials never reach the DOM.
 */

import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MergeTrainActivity } from "./MergeTrainActivity";
import {
  buildRepoTrainRows,
  buildTrainSummary,
  type RepoTrainRow,
  type TrainSummary,
} from "./trainActivity";
import type { PrRow, ProposalDetail, TrainHealth } from "./mergeTypes";

const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const ago = (secs: number) => new Date(NOW - secs * 1000).toISOString();

function proposal(overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    proposal_id: "p1",
    agent_id: "a1",
    status: "landing",
    requires_clean_ci: true,
    created_at: ago(600),
    updated_at: ago(240),
    repos: [{ repo: "qontinui/qontinui-web", branch: "feat/x", head_sha: "abc" }],
    ...overrides,
  };
}

function pr(overrides: Partial<PrRow> = {}): PrRow {
  return {
    repo: "qontinui/qontinui-web",
    pr_number: 1,
    branch: "feat/x",
    base_branch: "main",
    head_sha: "abc",
    pr_state: "open",
    mergeable: true,
    merge_state_status: "CLEAN",
    review_decision: null,
    required_checks_satisfied: true,
    last_refreshed_at: ago(300),
    last_predicate_eval_at: ago(300),
    ci_lifecycle: "complete",
    ci_conclusion: "success",
    correlation_id: null,
    ...overrides,
  };
}

function renderTab(opts: {
  proposals?: ProposalDetail[];
  prs?: PrRow[];
  health?: TrainHealth | null;
  loaded?: boolean;
  query?: string;
}) {
  const rows: RepoTrainRow[] = buildRepoTrainRows(
    opts.proposals ?? [],
    opts.prs ?? [],
    opts.health ?? null,
    NOW
  );
  const summary: TrainSummary = buildTrainSummary(
    opts.health ?? null,
    rows,
    NOW
  );
  return render(
    <MergeTrainActivity
      summary={summary}
      rows={rows}
      loaded={opts.loaded ?? true}
      query={opts.query ?? ""}
    />
  );
}

describe("MergeTrainActivity", () => {
  it("shows the pause clock without any interaction", () => {
    renderTab({ health: { last_merged_at: ago(2 * 3600 + 600) } });
    expect(screen.getByTestId("train-pause-clock")).toHaveTextContent("2h");
  });

  it("renders a skeleton until the queue and PR reads land", () => {
    renderTab({ loaded: false });
    expect(screen.getByTestId("train-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("train-header")).not.toBeInTheDocument();
  });

  it("states a fleet-wide cause above the per-repo rows", () => {
    renderTab({
      proposals: [proposal()],
      health: { leader: { lease_fresh: false, heartbeat_age_seconds: 900 } },
    });
    const banner = screen.getByTestId("train-banner-leader-lease-stale");
    expect(banner).toHaveAttribute("data-severity", "blocking");
    expect(banner).toHaveTextContent(/every per-repo reason below is a consequence/i);
  });

  it("says so plainly when coord's health read is unavailable", () => {
    // The proxy degrades a 404/outage to `{}` — the tab must admit the
    // fleet signals are missing rather than render "0s since last land".
    renderTab({ proposals: [proposal()], health: {} });
    expect(screen.getByTestId("train-health-missing")).toBeInTheDocument();
    expect(screen.getByTestId("train-pause-clock")).toHaveTextContent("—");
  });

  it("puts the phase and its dwell on the collapsed row", () => {
    renderTab({ proposals: [proposal({ status: "landing", updated_at: ago(240) })] });
    const row = screen.getByTestId("train-row-qontinui/qontinui-web");
    expect(row).toHaveAttribute("data-activity", "landing");
    expect(within(row).getByText(/Landing/)).toBeInTheDocument();
    expect(within(row).getByText("4m")).toBeInTheDocument();
  });

  it("marks an idle repo with a blocking reason chip", () => {
    renderTab({
      prs: [pr({ pr_number: 12, ci_conclusion: "failure", failing_contexts: ["build"] })],
    });
    const row = screen.getByTestId("train-row-qontinui/qontinui-web");
    expect(row).toHaveAttribute("data-activity", "idle");
    expect(row).toHaveAttribute("data-severity", "blocking");
    expect(within(row).getByTestId("reason-chip-ci-failed")).toBeInTheDocument();
  });

  it("expands to the full why, including the overlapping files", () => {
    renderTab({
      proposals: [
        proposal({
          status: "blocked-by-overlap",
          repos: [
            {
              repo: "qontinui/qontinui-web",
              branch: "feat/x",
              head_sha: "abc",
              overlap_paths: ["src/app/page.tsx", "src/lib/util.ts"],
            },
          ],
        }),
      ],
    });
    const row = screen.getByTestId("train-row-qontinui/qontinui-web");
    expect(
      screen.queryByTestId("train-detail-qontinui/qontinui-web")
    ).not.toBeInTheDocument();

    fireEvent.click(within(row).getByRole("button"));

    const detail = screen.getByTestId("train-detail-qontinui/qontinui-web");
    expect(detail).toHaveTextContent("src/app/page.tsx");
    expect(detail).toHaveTextContent("src/lib/util.ts");
  });

  it("never renders a credential from coord's error text", () => {
    // coord stores the failing clone command verbatim; the tab must redact.
    const token = "gho_0000EXAMPLEONLYNOTAREALTOKEN0000";
    renderTab({
      proposals: [
        proposal({
          status: "conflict",
          error: `git clone https://x-access-token:${token}@github.com/o/r.git failed`,
        }),
      ],
    });
    fireEvent.click(
      within(screen.getByTestId("train-row-qontinui/qontinui-web")).getByRole(
        "button"
      )
    );
    const detail = screen.getByTestId("train-detail-qontinui/qontinui-web");
    expect(detail).toHaveTextContent("***:***@github.com");
    expect(document.body.innerHTML).not.toContain(token);
  });

  it("filters rows by the shared search query", () => {
    renderTab({
      proposals: [
        proposal({ repos: [{ repo: "qontinui/qontinui-web", branch: "a", head_sha: "s" }] }),
        proposal({
          proposal_id: "p2",
          repos: [{ repo: "qontinui/qontinui-runner", branch: "b", head_sha: "t" }],
        }),
      ],
      query: "runner",
    });
    expect(
      screen.getByTestId("train-row-qontinui/qontinui-runner")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("train-row-qontinui/qontinui-web")
    ).not.toBeInTheDocument();
  });

  it("explains an empty board rather than showing a blank panel", () => {
    renderTab({});
    expect(screen.getByTestId("train-empty")).toHaveTextContent(
      /no repo has any merge-train activity/i
    );
  });
});
