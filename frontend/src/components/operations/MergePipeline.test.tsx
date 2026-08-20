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
import type { BlastRadiusBlock, PrRow, ProposalDetail } from "./mergeTypes";

const hookData: { current: MergePipelineData } = {
  current: {
    proposals: [],
    prs: [],
    mergedPrs: null,
    mergedCount: null,
    suggestions: [],
    gateBlocks: [],
    gateTotalBlocks: 0,
    gateTotalEvals: null,
    error: null,
    suggestionBusy: null,
    onSuggestionAction: () => {},
    refetch: () => {},
  },
};

// The hook is stubbed, but the module also exports the merged-tab lookback
// constant the component renders — keep the real value so the empty-state
// copy under test is the one operators see. (Literal, not a reference:
// `vi.mock` factories are hoisted above const declarations.)
// Records the options the component passes, so a test can assert that the
// expensive merged-rows read is requested ONLY while its tab is open.
const hookCalls: Array<{ includeMerged?: boolean }> = [];
vi.mock("./useMergePipelineData", () => ({
  useMergePipelineData: (opts: { includeMerged?: boolean } = {}) => {
    hookCalls.push(opts);
    return hookData.current;
  },
  MERGED_LOOKBACK_HOURS: 48,
}));
const MERGED_LOOKBACK_HOURS = 48;

// usePrCheckDetails (the on-expand per-check fetch) goes through httpClient.
const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

// The draft-state toggle surfaces success/error via sonner; stub it so the
// gating tests never render real toasts and can assert what was signalled.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  }),
}));

import {
  AUTHOR_GLYPH_KINDS,
  MergePipeline,
  STATUS_BADGE_CLASS,
} from "./MergePipeline";
import {
  ATTENTION_BY_KIND,
  UNKNOWN_DWELL_NOTE,
  type UnifiedStatusKind,
} from "./prPipeline";

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
      mergedPrs: null,
      mergedCount: null,
      gateBlocks: [],
      gateTotalBlocks: 0,
      gateTotalEvals: null,
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

  it("green when merging normally; conflicts alone never turn the strip red", () => {
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
        repos: [{ repo: "qontinui/qontinui-web", branch: "b1", head_sha: "a" }],
      }),
      proposal({
        proposal_id: "c2",
        status: "conflict",
        repos: [{ repo: "qontinui/qontinui-web", branch: "b2", head_sha: "b" }],
      }),
    ];
    render(<MergePipeline />);
    // CONTRACT (2026-07-20): conflicted PRs are author backlog. They never
    // enter the train, so they cannot make it stuck — they are reported, not
    // escalated. There IS one amber reason here (both PRs conflicted means
    // nothing is in the train), but the strip must never read "Pipeline stuck".
    expect(screen.getByTestId("pipeline-health").dataset.healthLevel).toBe(
      "amber"
    );
    expect(screen.queryByText("Pipeline stuck")).not.toBeInTheDocument();
    expect(screen.getByText(/2 PRs need an author rebase/)).toBeInTheDocument();
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
    expect(screen.getByText(/not on your branch/i)).toBeInTheDocument();
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
    // The badge now prefixes the ✕ glyph (checks-failing is an author kind),
    // so match on the label substring rather than the exact text node.
    fireEvent.click(screen.getByText(/Checks failing/));

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
    expect(
      within(securityRow!).getByText("View run").closest("a")
    ).toHaveAttribute(
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
    // The badge now prefixes the ✕ glyph (checks-failing is an author kind),
    // so match on the label substring rather than the exact text node.
    fireEvent.click(screen.getByText(/Checks failing/));

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
      expect(/\bbg-red-/.test(cls), `${kind} red?`).toBe(
        attention === "author"
      );
      expect(/\bbg-amber-/.test(cls), `${kind} amber?`).toBe(
        attention === "waiting"
      );
    }
  });

  it("every author-attention kind carries the colourblind-safe ✕ glyph — and only those", () => {
    // The glyph list is a hand-maintained string set TypeScript cannot check
    // (web#813 missed it on the first pass). The invariant: red ⇔ ✕, exactly —
    // every `author` kind is marked, and no non-author kind is.
    const authorKinds = (
      Object.keys(ATTENTION_BY_KIND) as UnifiedStatusKind[]
    ).filter((k) => ATTENTION_BY_KIND[k] === "author");
    for (const kind of authorKinds) {
      expect(AUTHOR_GLYPH_KINDS.has(kind), `${kind} is red but has no ✕`).toBe(
        true
      );
    }
    for (const kind of AUTHOR_GLYPH_KINDS) {
      expect(
        ATTENTION_BY_KIND[kind],
        `${kind} carries ✕ but is not an author-action kind`
      ).toBe("author");
    }
    expect(AUTHOR_GLYPH_KINDS.size).toBe(authorKinds.length);
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
  // "No evidence" is drawn differently from "measured and fine" (plan
  // 2026-07-27-coord-conflict-bookkeeping-is-proposal-scoped-four-blind-spots,
  // F3). Nine runner PRs sat conflicted for up to a month rendering as an
  // ordinary amber "resolve at merge" row, because coord never reported an age
  // for them and the page drew the absence exactly like a young PR.
  // --------------------------------------------------------------------------

  /** A DIRTY long-CI PR (amber `conflict-deferred`) with/without a clock. */
  const deferredPr = (conflictAgeSecs: number | null) =>
    pr({
      repo: "qontinui/qontinui-runner",
      merge_state_status: "DIRTY",
      mergeable: null,
      conflict_age_secs: conflictAgeSecs,
    });

  it("marks an unmeasurable amber row with the ? glyph and explains it on hover", () => {
    hookData.current.prs = [deferredPr(null)];

    render(<MergePipeline />);

    const badge = document.querySelector(
      '[data-status-kind="conflict-deferred"]'
    );
    expect(badge).toBeInTheDocument();
    expect(badge?.getAttribute("data-dwell-evidence")).toBe("unknown");
    // Visible at SCAN distance — a hover-only signal is what failed before.
    expect(badge?.textContent).toContain("?");
    expect(badge?.getAttribute("title")).toContain(UNKNOWN_DWELL_NOTE);
    // Same amber, same kind: absence is not evidence of a problem either.
    expect(badge?.className).toContain("bg-amber-");
    expect(badge?.className).not.toContain("bg-red-");
    expect(badge?.className).toContain("border-dashed");
  });

  it("leaves a MEASURED amber row exactly as it renders today", () => {
    // 1h old, cap is 6h → coord looked and this PR really is young. Every
    // rendered surface must be what shipped before F3 — badge text, badge
    // title, inline reason — so only the unknown case moved.
    hookData.current.prs = [deferredPr(60 * 60)];

    render(<MergePipeline />);

    const badge = document.querySelector(
      '[data-status-kind="conflict-deferred"]'
    );
    expect(badge?.getAttribute("data-dwell-evidence")).toBe("measured");
    expect(badge?.textContent).toBe("Conflict (resolve at merge)");
    expect(badge?.className).not.toContain("border-dashed");
    expect(badge?.getAttribute("title")).toBe(
      "Conflict (resolve at merge) — conflict — resolve at merge " +
        "(repo CI ~2h, deep in queue)"
    );
    // Expand it — `RowDetail` renders only when open, so asserting the note's
    // absence on a collapsed row would pass even if it were unconditional.
    fireEvent.click(screen.getByText(/Conflict \(resolve at merge\)/));
    expect(screen.queryByTestId("unknown-dwell-note")).not.toBeInTheDocument();
  });

  it("the two rows differ ONLY by the marker — same label, same inline reason", () => {
    hookData.current.prs = [
      deferredPr(null),
      pr({
        pr_number: 762,
        branch: "feat/other",
        repo: "qontinui/qontinui-runner",
        merge_state_status: "DIRTY",
        mergeable: null,
        conflict_age_secs: 60 * 60,
      }),
    ];

    render(<MergePipeline />);

    const reasons = screen
      .getAllByTestId("row-reason")
      .map((n) => n.textContent);
    expect(new Set(reasons).size).toBe(1); // identical copy...
    const evidence = Array.from(
      document.querySelectorAll("[data-dwell-evidence]")
    ).map((n) => n.getAttribute("data-dwell-evidence"));
    expect(evidence.sort()).toEqual(["measured", "unknown"]); // ...one bit apart
  });

  it("spells the marker out in the expanded detail, muted rather than alarming", () => {
    hookData.current.prs = [deferredPr(null)];

    render(<MergePipeline />);
    fireEvent.click(screen.getByText(/Conflict \(resolve at merge\)/));

    const note = screen.getByTestId("unknown-dwell-note");
    expect(note).toHaveTextContent(UNKNOWN_DWELL_NOTE);
    expect(note.className).toContain("text-muted-foreground");
    expect(note.className).not.toContain("text-red-");
  });

  it("does not promote an unmeasurable row into the needs-attention tab", () => {
    hookData.current.prs = [deferredPr(null)];

    render(<MergePipeline />);

    // The health strip's author counter ignores it entirely...
    expect(screen.queryByText(/needs attention/)).not.toBeInTheDocument();
    // ...but the operator IS told how much of the amber is unmeasured.
    expect(screen.getByTestId("pipeline-health")).toHaveTextContent(
      "1 waiting PR of unknown age"
    );
    expect(screen.getByTestId("pipeline-health")).toHaveAttribute(
      "data-health-level",
      "green"
    );
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

  // --------------------------------------------------------------------------
  // "How it landed" — the ff-land explainer in the expanded detail
  // --------------------------------------------------------------------------

  it("explains the closed-not-merged mechanic for a coord ff-land", () => {
    hookData.current.prs = [
      pr({
        pr_number: 7,
        branch: "b-7",
        pr_state: "closed", // coord ff-land closes with merged=false
        merge_commit_sha: "deadbeef1234",
        merged_at: new Date(Date.now() - 60_000).toISOString(),
        close_cause: "commits_landed_via_other_pr",
      }),
    ];

    render(<MergePipeline />);
    fireEvent.click(screen.getByTestId("pipeline-filter-merged"));
    fireEvent.click(screen.getByText("qontinui-web#7"));

    const detail = screen.getByTestId("landed-detail");
    expect(detail).toHaveTextContent("How it landed");
    expect(detail).toHaveTextContent(/Landed on main by coord/);
    const link = screen.getByTestId("landed-commit-link");
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/qontinui/qontinui-web/commit/deadbeef1234"
    );
    expect(link).toHaveTextContent("deadbee");
    expect(screen.getByTestId("ff-land-note")).toHaveTextContent(
      /GitHub shows this PR/
    );
  });

  it("omits the closed-not-merged caveat for a normal GitHub merge", () => {
    hookData.current.prs = [
      pr({
        pr_number: 8,
        branch: "b-8",
        pr_state: "merged",
        merge_commit_sha: "cafe00011122",
        merged_at: new Date(Date.now() - 60_000).toISOString(),
        close_cause: "merged",
      }),
    ];

    render(<MergePipeline />);
    fireEvent.click(screen.getByTestId("pipeline-filter-merged"));
    fireEvent.click(screen.getByText("qontinui-web#8"));

    expect(screen.getByTestId("landed-detail")).toHaveTextContent(
      /Merged into main/
    );
    expect(screen.queryByTestId("ff-land-note")).toBeNull();
  });

  it("shows the landed commit without a caveat when coord omits close_cause", () => {
    hookData.current.prs = [
      pr({
        pr_number: 9,
        branch: "b-9",
        pr_state: "closed",
        merge_commit_sha: "0ff1ce123456",
        merged_at: new Date(Date.now() - 60_000).toISOString(),
        // close_cause absent — a coord deploy predating the projection
      }),
    ];

    render(<MergePipeline />);
    fireEvent.click(screen.getByTestId("pipeline-filter-merged"));
    fireEvent.click(screen.getByText("qontinui-web#9"));

    expect(screen.getByTestId("landed-commit-link")).toHaveTextContent(
      "0ff1ce1"
    );
    expect(screen.queryByTestId("ff-land-note")).toBeNull();
  });

  // --------------------------------------------------------------------------
  // The merged read is expensive — it must stay off the 2s hot poll
  // --------------------------------------------------------------------------

  it("asks for merged rows ONLY while the Merged tab is open", () => {
    hookData.current.prs = [pr()];
    hookCalls.length = 0;

    render(<MergePipeline />);
    // Default tab: every render so far must have opted OUT of the expensive
    // `?include_merged=` read.
    expect(hookCalls.length).toBeGreaterThan(0);
    expect(hookCalls.every((c) => c.includeMerged === false)).toBe(true);

    fireEvent.click(screen.getByTestId("pipeline-filter-merged"));
    expect(hookCalls.at(-1)?.includeMerged).toBe(true);

    // Leaving the tab must switch it back off — otherwise the costly read
    // keeps running for the rest of the session.
    fireEvent.click(screen.getByTestId("pipeline-filter-all"));
    expect(hookCalls.at(-1)?.includeMerged).toBe(false);
  });

  it("labels the Merged tab from coord's cheap count before the tab is opened", () => {
    hookData.current.prs = [pr()];
    // The expensive rows read has not run — but the hot poll's cheap count has.
    hookData.current.mergedPrs = null;
    hookData.current.mergedCount = 7;

    render(<MergePipeline />);

    expect(screen.getByTestId("pipeline-filter-merged")).toHaveTextContent(
      /Merged\s*7/
    );
    expect(screen.getByTestId("pipeline-filter-merged")).not.toHaveTextContent(
      "–"
    );
  });

  it("shows a dash, not '0', when coord cannot answer the merged count", () => {
    hookData.current.prs = [pr()];
    hookData.current.mergedPrs = null;
    hookData.current.mergedCount = null;

    render(<MergePipeline />);

    // "0" here would assert an unknown as a fact — nothing has been counted.
    expect(screen.getByTestId("pipeline-filter-merged")).toHaveTextContent("–");
    expect(screen.getByTestId("pipeline-filter-merged")).not.toHaveTextContent(
      /Merged\s*0/
    );
  });

  it("prefers the fetched rows over the count once the tab is open", () => {
    hookData.current.prs = [pr()];
    hookData.current.mergedPrs = [mergedPr(1, 5, "aaaaaaa1111")];
    // A stale count from an earlier poll must not outrank what we now hold.
    hookData.current.mergedCount = 7;

    render(<MergePipeline />);

    expect(screen.getByTestId("pipeline-filter-merged")).toHaveTextContent(
      /Merged\s*1/
    );
  });

  // --------------------------------------------------------------------------
  // Phantom-open ff-lands: in BOTH lists at once
  // --------------------------------------------------------------------------

  it("renders a landed PR once, as merged, when the open poll still has it", () => {
    // coord's ff-land pushes a rebased sha, so GitHub never auto-closes the
    // PR: the open poll still reports it `open` while the merged read reports
    // it landed. The merged row is the truthful one.
    const phantom = {
      pr_number: 55,
      branch: "feat/phantom",
      repo: "qontinui/qontinui-web",
    };
    hookData.current.prs = [pr({ ...phantom, pr_state: "open" })];
    hookData.current.mergedPrs = [
      pr({
        ...phantom,
        pr_state: "open",
        merge_commit_sha: "ccccccc3333",
        merged_at: new Date(Date.now() - 60_000).toISOString(),
      }),
    ];

    render(<MergePipeline />);

    // Not in the live list, and counted exactly once in the merged tab.
    expect(screen.queryAllByTestId("pipeline-row")).toHaveLength(0);
    expect(screen.getByTestId("pipeline-filter-merged")).toHaveTextContent(
      /Merged\s*1/
    );

    fireEvent.click(screen.getByTestId("pipeline-filter-merged"));
    const rows = screen.getAllByTestId("pipeline-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("qontinui-web#55");
  });

  // --------------------------------------------------------------------------
  // The Train tab. Unlike every other tab it is NOT a filter over the PR rows
  // — it swaps in a row-per-REPO view of the merge train itself. These cover
  // the integration seam (tab order, the swap, the health read's gating);
  // the derivation is covered in trainActivity.test.ts and the presentation in
  // MergeTrainActivity.test.tsx.
  // --------------------------------------------------------------------------

  it("offers the Train tab immediately after Merged", () => {
    render(<MergePipeline />);
    const tabs = screen
      .getAllByTestId(/^pipeline-filter-/)
      .map((el) => el.dataset.testid ?? el.getAttribute("data-testid"));
    expect(tabs).toEqual([
      "pipeline-filter-all",
      "pipeline-filter-attention",
      "pipeline-filter-in-flight",
      "pipeline-filter-merged",
      "pipeline-filter-train",
    ]);
  });

  it("swaps the PR list for the per-repo train view", () => {
    hookData.current.prs = [pr()];
    hookData.current.proposals = [proposal({ status: "landing" })];

    render(<MergePipeline />);
    expect(screen.getAllByTestId("pipeline-row").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("pipeline-filter-train"));

    expect(screen.getByTestId("merge-train-activity")).toBeInTheDocument();
    // The per-PR rows are gone — this tab is a different question.
    expect(screen.queryByTestId("pipeline-row")).not.toBeInTheDocument();
    const row = screen.getByTestId("train-row-qontinui/qontinui-web");
    expect(row).toHaveAttribute("data-activity", "landing");
  });

  it("counts repos the train is working, not PRs", () => {
    // Two PRs, one repo, one in-flight proposal ⇒ the Train tab reads 1.
    hookData.current.prs = [pr({ pr_number: 1 }), pr({ pr_number: 2 })];
    hookData.current.proposals = [proposal({ status: "landing" })];

    render(<MergePipeline />);
    expect(screen.getByTestId("pipeline-filter-train")).toHaveTextContent(
      /Train\s*1/
    );
  });

  it("only reads coord health while the Train tab is open", () => {
    // The health read scales with the ready-unmerged backlog and every
    // dashboard request pins a backend DB connection, so it must not ride
    // along on the other tabs.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ last_merged_at: new Date().toISOString() }),
    });

    render(<MergePipeline />);
    const healthCalls = () =>
      fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("/pr-merge/health")
      ).length;
    expect(healthCalls()).toBe(0);

    fireEvent.click(screen.getByTestId("pipeline-filter-train"));
    expect(healthCalls()).toBeGreaterThan(0);
  });

  it("still renders the train view when the health read is unavailable", async () => {
    // coord deploy predating /pr-merge/health, or a transient outage.
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    hookData.current.proposals = [proposal({ status: "awaiting-ci" })];

    render(<MergePipeline />);
    fireEvent.click(screen.getByTestId("pipeline-filter-train"));

    await waitFor(() =>
      expect(screen.getByTestId("train-health-missing")).toBeInTheDocument()
    );
    // Per-repo activity is still derived from the queue.
    expect(
      screen.getByTestId("train-row-qontinui/qontinui-web")
    ).toHaveAttribute("data-activity", "awaiting-ci");
  });

  // Draft-state toggle (plan 2026-07-23-operator-set-pr-draft-state). The
  // control is gated on the row's pr_state and lives in the expanded detail.
  describe("draft-state toggle", () => {
    it("offers 'Ready for review' (not 'Convert to draft') on a draft PR", () => {
      hookData.current.prs = [
        pr({ pr_number: 900, pr_state: "draft", merge_state_status: "DRAFT" }),
      ];

      render(<MergePipeline />);
      fireEvent.click(screen.getByText("qontinui-web#900"));

      expect(screen.getByTestId("pr-ready-for-review")).toBeInTheDocument();
      expect(
        screen.queryByTestId("pr-convert-to-draft")
      ).not.toBeInTheDocument();
    });

    it("offers 'Convert to draft' (not 'Ready for review') on an open PR", () => {
      hookData.current.prs = [pr({ pr_number: 901 })]; // default pr_state "open"

      render(<MergePipeline />);
      fireEvent.click(screen.getByText("qontinui-web#901"));

      expect(screen.getByTestId("pr-convert-to-draft")).toBeInTheDocument();
      expect(
        screen.queryByTestId("pr-ready-for-review")
      ).not.toBeInTheDocument();
    });

    it("confirms the release-to-train consequence before undrafting", async () => {
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
      hookData.current.prs = [
        pr({ pr_number: 900, pr_state: "draft", merge_state_status: "DRAFT" }),
      ];

      render(<MergePipeline />);
      fireEvent.click(screen.getByText("qontinui-web#900"));

      // Clicking the button must NOT fire the mutation directly — it opens a
      // confirm whose copy names the auto-land consequence.
      fireEvent.click(screen.getByTestId("pr-ready-for-review"));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(
        screen.getByText(/Release #900 to the merge train\?/)
      ).toBeInTheDocument();
      expect(
        screen.getByText(/coord will land it automatically/i)
      ).toBeInTheDocument();

      // Confirming POSTs draft:false to the draft-state proxy.
      fireEvent.click(screen.getByText("Release to merge train"));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as [
        string,
        { method: string; body: string },
      ];
      expect(url).toContain("/prs/qontinui/qontinui-web/900/draft-state");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({ draft: false });
    });
  });
});

/**
 * Gate decisions header — decisions vs evaluations (plan
 * 2026-08-20-predicate-eval-surface-counts-evals-not-decisions Phase 2).
 *
 * Coord's engine appends one `predicate_eval` audit row per scheduler tick, so
 * the raw row count is an EVALUATION count. The badge used to render it as the
 * decision count (measured 2026-08-20: it read 1899 where the true answer was
 * 8). `total_blocks` is now distinct PRs; `total_evals` carries the raw volume
 * and must stay VISIBLE rather than being silently dropped.
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
    ...overrides,
  };
}

describe("MergePipeline gate-decisions counting", () => {
  beforeEach(() => {
    window.localStorage.clear();
    fetchMock.mockReset();
    hookData.current = {
      ...hookData.current,
      proposals: [],
      prs: [],
      mergedPrs: null,
      mergedCount: null,
      gateBlocks: [gateBlock()],
      gateTotalBlocks: 8,
      gateTotalEvals: 1899,
      error: null,
    };
  });

  it("labels the total as DECISIONS and shows the eval count alongside it", () => {
    render(<MergePipeline />);
    const section = screen.getByTestId("gate-decisions");
    const decisions = section.querySelector("[data-gate-total-blocks]");
    expect(decisions).not.toBeNull();
    expect(decisions?.getAttribute("data-gate-total-blocks")).toBe("8");
    expect(decisions?.textContent).toContain("8");
    expect(decisions?.textContent).toContain("decisions");

    // The raw audit volume is NOT dropped — it rides as its own chip.
    const evals = section.querySelector("[data-gate-total-evals]");
    expect(evals).not.toBeNull();
    expect(evals?.getAttribute("data-gate-total-evals")).toBe("1899");
    expect(evals?.textContent).toContain("1899 evals");
    // …and it is never mistaken for the decision count.
    expect(evals).not.toBe(decisions);
  });

  it("singularises a lone decision", () => {
    hookData.current.gateTotalBlocks = 1;
    hookData.current.gateTotalEvals = 547;
    render(<MergePipeline />);
    const decisions = screen
      .getByTestId("gate-decisions")
      .querySelector("[data-gate-total-blocks]");
    expect(decisions?.textContent).toContain("1 decision");
    expect(decisions?.textContent).not.toContain("decisions");
  });

  it("omits the evals chip when coord did not report it (older deploy)", () => {
    hookData.current.gateTotalEvals = null;
    render(<MergePipeline />);
    const section = screen.getByTestId("gate-decisions");
    expect(section.querySelector("[data-gate-total-evals]")).toBeNull();
    // The decision count still renders — silence about evals is not silence
    // about decisions.
    expect(section.querySelector("[data-gate-total-blocks]")).not.toBeNull();
  });

  it("omits the evals chip when it adds nothing (evals === decisions)", () => {
    hookData.current.gateTotalBlocks = 8;
    hookData.current.gateTotalEvals = 8;
    render(<MergePipeline />);
    expect(
      screen
        .getByTestId("gate-decisions")
        .querySelector("[data-gate-total-evals]")
    ).toBeNull();
  });
});
