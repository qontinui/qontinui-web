/**
 * MergeTrainActivity — the pipeline's "Train" tab.
 *
 * The derivation is covered in `trainActivity.test.ts`; this file covers the
 * rendering contracts an operator depends on: the pause clock is visible
 * without expanding anything, a fleet-wide cause is stated ABOVE the per-repo
 * rows (so it is not mistaken for a per-repo problem), the per-repo phase and
 * its dwell are on the collapsed row, and credentials never reach the DOM.
 *
 * Plus the emergency stop this tab now owns (plan
 * `2026-07-29-retire-merge-rollout-tristate-and-fix-the-dead-kill-switch`,
 * Phase 4): it moved off the calibration page, it defaults to the ONE repo
 * whose row is open, and tenant-wide is an explicit opt-in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const fetchMock = vi.fn();
vi.mock("@/services/service-factory", () => ({
  httpClient: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

// The emergency stop is CoordAdminOnly-gated. Mutable rather than a constant
// `true`, so one test can prove the gate is actually wired — a hard-coded
// admin mock would let an accidental unwrap ship undetected.
const authState = vi.hoisted(() => ({ isCoordAdmin: true }));
vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ isCoordAdmin: authState.isCoordAdmin }),
}));

import { MergeTrainActivity } from "./MergeTrainActivity";
import {
  buildRepoTrainRows,
  buildTrainSummary,
  type RepoTrainRow,
  type TrainSummary,
} from "./trainActivity";
import type {
  MergeEconomics,
  PrRow,
  ProposalDetail,
  TrainHealth,
} from "./mergeTypes";

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
    repos: [
      { repo: "qontinui/qontinui-web", branch: "feat/x", head_sha: "abc" },
    ],
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
  economics?: Record<string, MergeEconomics>;
  loaded?: boolean;
  query?: string;
  onActed?: () => void;
}) {
  const rows: RepoTrainRow[] = buildRepoTrainRows(
    opts.proposals ?? [],
    opts.prs ?? [],
    opts.health ?? null,
    NOW,
    opts.economics
  );
  const summary: TrainSummary = buildTrainSummary(
    opts.health ?? null,
    rows,
    NOW,
    opts.economics
  );
  return render(
    <MergeTrainActivity
      summary={summary}
      rows={rows}
      loaded={opts.loaded ?? true}
      query={opts.query ?? ""}
      onActed={opts.onActed}
    />
  );
}

/** Expand the (only) repo row and return its detail element. */
function expandRow(repo = "qontinui/qontinui-web"): HTMLElement {
  fireEvent.click(
    within(screen.getByTestId(`train-row-${repo}`)).getByRole("button")
  );
  return screen.getByTestId(`train-detail-${repo}`);
}

describe("MergeTrainActivity", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

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
    expect(banner).toHaveTextContent(
      /every per-repo reason below is a consequence/i
    );
  });

  it("says so plainly when coord's health read is unavailable", () => {
    // The proxy degrades a 404/outage to `{}` — the tab must admit the
    // fleet signals are missing rather than render "0s since last land".
    renderTab({ proposals: [proposal()], health: {} });
    expect(screen.getByTestId("train-health-missing")).toBeInTheDocument();
    expect(screen.getByTestId("train-pause-clock")).toHaveTextContent("—");
  });

  it("puts the phase and its dwell on the collapsed row", () => {
    renderTab({
      proposals: [proposal({ status: "landing", updated_at: ago(240) })],
    });
    const row = screen.getByTestId("train-row-qontinui/qontinui-web");
    expect(row).toHaveAttribute("data-activity", "landing");
    expect(within(row).getByText(/Landing/)).toBeInTheDocument();
    expect(within(row).getByText("4m")).toBeInTheDocument();
  });

  it("marks an idle repo with a blocking reason chip", () => {
    renderTab({
      prs: [
        pr({
          pr_number: 12,
          ci_conclusion: "failure",
          failing_contexts: ["build"],
        }),
      ],
    });
    const row = screen.getByTestId("train-row-qontinui/qontinui-web");
    expect(row).toHaveAttribute("data-activity", "idle");
    expect(row).toHaveAttribute("data-severity", "blocking");
    expect(
      within(row).getByTestId("reason-chip-ci-failed")
    ).toBeInTheDocument();
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
        proposal({
          repos: [
            { repo: "qontinui/qontinui-web", branch: "a", head_sha: "s" },
          ],
        }),
        proposal({
          proposal_id: "p2",
          repos: [
            { repo: "qontinui/qontinui-runner", branch: "b", head_sha: "t" },
          ],
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

// ---------------------------------------------------------------------------
// Emergency stop
// ---------------------------------------------------------------------------

describe("MergeTrainActivity emergency stop", () => {
  const REPO = "qontinui/qontinui-web";
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock.mockReset();
    confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          scope: `repo:${REPO}`,
          previous_merge_enabled: true,
          merge_enabled: false,
          affected_repos: [REPO],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
  });

  afterEach(() => {
    confirmSpy.mockRestore();
    authState.isCoordAdmin = true;
  });

  // The brake is a mutation control: a Developer-tier member may read this
  // incident view but must not be handed the fleet's stop button.
  it("is hidden entirely from a non-admin", () => {
    authState.isCoordAdmin = false;
    renderTab({ proposals: [proposal()] });
    expandRow();
    expect(screen.queryByTestId(`emergency-stop-${REPO}`)).toBeNull();
    expect(screen.queryByTestId(`emergency-stop-fire-${REPO}`)).toBeNull();
    // ...while the diagnosis it sits under still renders.
    expect(screen.getByTestId(`train-detail-${REPO}`)).toBeInTheDocument();
  });

  it("restates the blast radius when the tenant-wide box is ticked", () => {
    renderTab({ proposals: [proposal()] });
    expandRow();
    const blurb = screen.getByTestId(`emergency-stop-blurb-${REPO}`);
    expect(blurb).toHaveTextContent(new RegExp(`${REPO} only`));

    fireEvent.click(screen.getByTestId(`emergency-stop-tenant-wide-${REPO}`));
    expect(blurb).toHaveTextContent(/every repo this tenant owns/i);
    expect(blurb).not.toHaveTextContent(/only/i);
  });

  it("is not on the collapsed row — only inside the opened one", () => {
    renderTab({ proposals: [proposal()] });
    expect(screen.queryByTestId(`emergency-stop-${REPO}`)).toBeNull();
    expandRow();
    expect(screen.getByTestId(`emergency-stop-${REPO}`)).toBeInTheDocument();
  });

  it("refuses to fire without a reason, and makes no request", async () => {
    renderTab({ proposals: [proposal()] });
    expandRow();

    fireEvent.click(screen.getByTestId(`emergency-stop-fire-${REPO}`));

    await waitFor(() =>
      expect(screen.getByTestId(`emergency-stop-${REPO}`)).toHaveTextContent(
        /reason is required/i
      )
    );
    expect(fetchMock).not.toHaveBeenCalled();
    // A blank reason must not even reach the confirm dialog.
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("defaults to THIS repo, not the whole tenant", async () => {
    renderTab({ proposals: [proposal()] });
    expandRow();

    fireEvent.change(screen.getByTestId(`emergency-stop-reason-${REPO}`), {
      target: { value: "bad rebase landing on main" },
    });
    fireEvent.click(screen.getByTestId(`emergency-stop-fire-${REPO}`));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/pr-merge/kill-switch");
    const body = JSON.parse(init.body as string);
    expect(body.scope).toBe(`repo:${REPO}`);
    expect(body.reason).toBe("bad rebase landing on main");
    // The confirm names the repo, not the fleet.
    expect(confirmSpy.mock.calls[0]?.[0]).toContain(REPO);
  });

  it("only goes tenant-wide when the operator opts in", async () => {
    renderTab({ proposals: [proposal()] });
    expandRow();

    fireEvent.change(screen.getByTestId(`emergency-stop-reason-${REPO}`), {
      target: { value: "calibration regression firing fleet-wide" },
    });
    fireEvent.click(screen.getByTestId(`emergency-stop-tenant-wide-${REPO}`));
    fireEvent.click(screen.getByTestId(`emergency-stop-fire-${REPO}`));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).scope).toBe("tenant");
    // ...and the confirm states the widened blast radius.
    expect(confirmSpy.mock.calls[0]?.[0]).toMatch(
      /every repo this tenant owns/i
    );
  });

  it("cancelling the confirm sends nothing", async () => {
    confirmSpy.mockReturnValue(false);
    renderTab({ proposals: [proposal()] });
    expandRow();

    fireEvent.change(screen.getByTestId(`emergency-stop-reason-${REPO}`), {
      target: { value: "changed my mind" },
    });
    fireEvent.click(screen.getByTestId(`emergency-stop-fire-${REPO}`));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports the boolean coord actually wrote", async () => {
    const onActed = vi.fn();
    renderTab({ proposals: [proposal()], onActed });
    expandRow();

    fireEvent.change(screen.getByTestId(`emergency-stop-reason-${REPO}`), {
      target: { value: "stop it" },
    });
    fireEvent.click(screen.getByTestId(`emergency-stop-fire-${REPO}`));

    const result = await screen.findByTestId(`emergency-stop-result-${REPO}`);
    expect(result).toHaveTextContent("true");
    expect(result).toHaveTextContent("false");
    expect(result).toHaveTextContent("1 repo(s) affected");
    expect(onActed).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Candidate-CI churn (plan
// 2026-07-27-coord-green-candidates-discarded-always-zero, F3): three per-repo
// readings on the collapsed row, two fleet totals in the header. `—` is
// UNKNOWN and carries coord's basis / coverage note as its title; it is never
// a 0.
// ---------------------------------------------------------------------------
describe("MergeTrainActivity candidate-CI churn", () => {
  const WEB = "qontinui/qontinui-web";
  const CORE = "qontinui/qontinui-core";
  const measured: MergeEconomics = {
    green_candidates_discarded: 15,
    base_mismatch_discards: 13,
    candidate_ci_minutes_per_land: 47.4,
    green_candidates_discarded_basis: "green candidates discarded in 24h",
    base_mismatch_discards_basis: "base moved under the candidate",
    coverage_note: "24h window",
  };
  const unknown: MergeEconomics = {
    green_candidates_discarded: null,
    base_mismatch_discards: null,
    candidate_ci_minutes_per_land: null,
    coverage_note: "no candidate CI observed in window",
  };

  it("measured: the three values sit on the collapsed row with coord's basis on hover", () => {
    renderTab({ prs: [pr()], economics: { [WEB]: measured } });
    const cluster = screen.getByTestId(`train-churn-${WEB}`);
    const green = within(cluster).getByTestId("churn-green-discarded");
    expect(green).toHaveTextContent(/^green discarded 15$/);
    expect(green).toHaveAttribute("title", "green candidates discarded in 24h");
    expect(green).not.toHaveAttribute("data-unknown");
    const base = within(cluster).getByTestId("churn-base-move-discards");
    expect(base).toHaveTextContent(/^base-move discards 13$/);
    expect(base).toHaveAttribute("title", "base moved under the candidate");
    const rate = within(cluster).getByTestId("churn-ci-minutes-per-land");
    expect(rate).toHaveTextContent(/^CI min \/ land 47\.4$/);
    expect(rate).toHaveAttribute("title", "24h window");
    // No raw field names reach the surface (R8).
    expect(cluster).not.toHaveTextContent("green_candidates_discarded");

    expect(screen.getByTestId("train-green-discarded")).toHaveTextContent("15");
    expect(screen.getByTestId("train-green-discarded")).toHaveAttribute(
      "title",
      "green candidates discarded in 24h"
    );
    expect(screen.getByTestId("train-base-move-discards")).toHaveTextContent(
      "13"
    );
  });

  it("partially unknown: the null repo reads — with its coverage note; the total names it", () => {
    renderTab({
      prs: [pr(), pr({ repo: CORE, pr_number: 2 })],
      economics: { [WEB]: measured, [CORE]: unknown },
    });
    const core = screen.getByTestId(`train-churn-${CORE}`);
    for (const id of [
      "churn-green-discarded",
      "churn-base-move-discards",
      "churn-ci-minutes-per-land",
    ]) {
      const cell = within(core).getByTestId(id);
      expect(cell).toHaveTextContent(/—$/);
      expect(cell).not.toHaveTextContent("0");
      expect(cell).toHaveAttribute("data-unknown", "true");
      expect(cell).toHaveAttribute(
        "title",
        "no candidate CI observed in window"
      );
    }
    expect(
      within(screen.getByTestId(`train-churn-${WEB}`)).getByTestId(
        "churn-green-discarded"
      )
    ).toHaveTextContent(/^green discarded 15$/);

    expect(screen.getByTestId("train-green-discarded")).toHaveTextContent(
      "15 (1 repo unknown)"
    );
    expect(screen.getByTestId("train-base-move-discards")).toHaveTextContent(
      "13 (1 repo unknown)"
    );
  });

  it("all unknown / no economics: every reading and both totals read —, never 0", () => {
    renderTab({ prs: [pr()] });
    const cluster = screen.getByTestId(`train-churn-${WEB}`);
    for (const id of [
      "churn-green-discarded",
      "churn-base-move-discards",
      "churn-ci-minutes-per-land",
    ]) {
      const cell = within(cluster).getByTestId(id);
      expect(cell).toHaveTextContent(/—$/);
      expect(cell).toHaveAttribute(
        "title",
        "coord served no merge economics for this repo"
      );
    }
    expect(screen.getByTestId("train-green-discarded")).toHaveTextContent(
      /^Green CI discarded—$/
    );
    expect(screen.getByTestId("train-green-discarded")).toHaveAttribute(
      "title",
      expect.stringContaining("Unknown: coord did not measure it")
    );
    expect(screen.getByTestId("train-base-move-discards")).toHaveTextContent(
      /^Base-move discards—$/
    );
  });
});
