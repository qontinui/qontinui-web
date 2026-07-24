// Unit tests for the unified PR pipeline derivation (prPipeline.ts).
//
// The join + status table is the load-bearing contract of the fleet-page
// redesign: one row per PR, the active proposal's state wins, GitHub's view
// decides otherwise, and internal terminology never leaks into labels.

import { describe, expect, it } from "vitest";
import type {
  MergeEconomics,
  PrRow,
  ProposalDetail,
  RepoDetail,
} from "./mergeTypes";
import {
  ATTENTION_BY_KIND,
  buildPipelineRows,
  derivePipelineHealth,
  escalateStaleWaiting,
  formatDurationShort,
  isMergedPr,
  lastActivityForMs,
  matchesFilter,
  matchesQuery,
  pickActiveProposal,
  type PipelineRow,
  type UnifiedStatus,
  type UnifiedStatusKind,
  CI_WAIT_AMBER_MS,
  CI_WAIT_RED_MS,
  STALL_RED_MS,
  CONFLICT_DEFERRAL_MAX_MS,
  conflictStrandedForMs,
  GITHUB_CONFLICT_KINDS,
  LAND_RECENCY_MS,
  STALE_ESCALATION,
  WAITING_STALE_MAX_MS,
  waitingDwellCapMs,
} from "./prPipeline";

const NOW = new Date("2026-07-15T12:00:00Z").getTime();

/** ISO timestamp `minutes` before NOW. */
function ago(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

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
    last_refreshed_at: ago(1),
    last_predicate_eval_at: null,
    ci_lifecycle: "complete",
    ci_conclusion: "success",
    correlation_id: null,
    ...overrides,
  };
}

function repoDetail(overrides: Partial<RepoDetail> = {}): RepoDetail {
  return {
    repo: "qontinui/qontinui-web",
    branch: "feat/thing",
    head_sha: "abc123",
    ...overrides,
  };
}

function proposal(overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    proposal_id: "p-1",
    agent_id: "agent-12345678",
    status: "queued",
    requires_clean_ci: true,
    created_at: ago(10),
    updated_at: ago(5),
    repos: [repoDetail()],
    ...overrides,
  };
}

describe("derivePipelineHealth — conflicts are backlog, not pipeline state", () => {
  // Reproduces the 2026-07-20 banner: "Pipeline stuck · 7 conflicts
  // accumulating" while all three trains were landing and every conflict was
  // days old. A conflicted PR never enters the train (coord cannot rebase past
  // a conflict, so no candidate is cut) and therefore cannot make it stuck.
  function conflictedRows(n: number) {
    return Array.from({ length: n }, (_, i) =>
      buildPipelineRows(
        [
          pr({
            pr_number: 900 + i,
            branch: `feat/c${i}`,
            mergeable: false,
            merge_state_status: "DIRTY",
          }),
        ],
        []
      )
    ).flat();
  }

  /** A row whose ACTIVE proposal has been silent past the red stall threshold. */
  function stalledRow() {
    return buildPipelineRows(
      [pr({ pr_number: 950, branch: "feat/stall" })],
      [
        proposal({
          proposal_id: "p-stall",
          status: "awaiting-ci",
          updated_at: ago(STALL_RED_MS / 60000 + 60),
          repos: [repoDetail({ branch: "feat/stall" })],
        }),
      ]
    );
  }

  /** A separate landed row, `minsAgo` old — the land-cadence evidence. */
  function landedRow(minsAgo: number) {
    return buildPipelineRows(
      [pr({ pr_number: 951, branch: "feat/landed" })],
      [
        proposal({
          proposal_id: "p-landed",
          status: "merged",
          updated_at: ago(minsAgo),
          merged_at: ago(minsAgo),
          repos: [repoDetail({ branch: "feat/landed" })],
        }),
      ]
    );
  }

  it("many conflicts alone NEVER read as stuck or red", () => {
    const h = derivePipelineHealth(conflictedRows(7), NOW);
    // Amber, not green: with every open PR conflicted there is nothing in the
    // train at all, and green-by-absence-of-evidence would render "Merging
    // normally" beside a "last merged never" badge. But never RED, and never
    // "stuck" — the conflicts themselves are backlog, not a stopped pipeline.
    expect(h.level).toBe("amber");
    expect(h.headline).toBe("Pipeline slow");
    expect(h.headline).not.toBe("Pipeline stuck");
    expect(h.detail).toContain("nothing in the train");
  });

  it("conflicts alongside a LIVE train stay green — backlog is not slowness", () => {
    // The distinguishing case for the amber floor above: the train has work,
    // so conflicted PRs beside it change nothing about pipeline health.
    const h = derivePipelineHealth(
      [
        ...conflictedRows(7),
        ...buildPipelineRows(
          [pr({ pr_number: 960, branch: "feat/live" })],
          [
            proposal({
              proposal_id: "p-live",
              status: "awaiting-ci",
              updated_at: ago(1),
              repos: [repoDetail({ branch: "feat/live" })],
            }),
          ]
        ),
      ],
      NOW
    );
    expect(h.level).toBe("green");
    expect(h.headline).toBe("Merging normally");
    expect(h.conflicted).toBe(7);
  });

  it("but they stay VISIBLE, phrased as the action they need", () => {
    const h = derivePipelineHealth(conflictedRows(7), NOW);
    expect(h.conflicted).toBe(7);
    expect(h.detail).toContain("7 PRs need an author rebase");
    // Never the old severity-implying phrasing.
    expect(h.detail).not.toContain("accumulating");
  });

  it("singular/plural is not mangled at one conflict", () => {
    const h = derivePipelineHealth(conflictedRows(1), NOW);
    expect(h.conflicted).toBe(1);
    expect(h.detail).toContain("1 PR needs an author rebase");
  });

  it("zero conflicts adds no author clause at all", () => {
    const h = derivePipelineHealth(buildPipelineRows([pr()], []), NOW);
    expect(h.conflicted).toBe(0);
    expect(h.detail).not.toContain("author rebase");
  });

  it("a genuine pipeline red is UNAFFECTED — conflicts neither cause nor mask it", () => {
    // Stalled active proposal => real red, independent of conflict count.
    const stalled = buildPipelineRows(
      [pr()],
      [
        proposal({
          status: "awaiting-ci",
          updated_at: ago(STALL_RED_MS / 60000 + 60),
        }),
      ]
    );
    const h = derivePipelineHealth([...stalled, ...conflictedRows(7)], NOW);
    expect(h.level).toBe("red");
    // ...and the conflicts are still reported beside it, not swallowed.
    expect(h.detail).toContain("author rebase");
  });

  it("RED + a recent land is DEGRADED, not stuck — a land falsifies 'stuck'", () => {
    const h = derivePipelineHealth([...stalledRow(), ...landedRow(30)], NOW);
    expect(h.level).toBe("red");
    expect(h.headline).toBe("Pipeline degraded");
  });

  it("RED with the last land beyond the window IS stuck", () => {
    const h = derivePipelineHealth(
      [...stalledRow(), ...landedRow(LAND_RECENCY_MS / 60000 + 60)],
      NOW
    );
    expect(h.level).toBe("red");
    expect(h.headline).toBe("Pipeline stuck");
  });
});

describe("buildPipelineRows — join + unified status", () => {
  it("fuses a PR and its active proposal into one row (proposal state wins)", () => {
    const rows = buildPipelineRows(
      [pr()],
      [proposal({ status: "awaiting-ci" })]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prNumber).toBe(761);
    expect(rows[0].status.label).toBe("Awaiting CI");
    expect(rows[0].activeProposal?.proposal_id).toBe("p-1");
  });

  it("collapses repeated proposals into one row with attempt history", () => {
    const older = proposal({
      proposal_id: "p-old",
      status: "conflict",
      updated_at: ago(60),
      error: "merge conflict in src/a.rs",
    });
    const newer = proposal({
      proposal_id: "p-new",
      status: "dry-rebasing",
      updated_at: ago(1),
    });
    const rows = buildPipelineRows([pr()], [older, newer]);
    expect(rows).toHaveLength(1);
    expect(rows[0].attempts.map((a) => a.proposal_id)).toEqual([
      "p-new",
      "p-old",
    ]);
    // No internal jargon: dry-rebasing renders as "Testing merge".
    expect(rows[0].status.label).toBe("Testing merge");
  });

  it("skips cancelled attempts when picking the active proposal", () => {
    const cancelled = proposal({
      proposal_id: "p-c",
      status: "cancelled",
      updated_at: ago(1),
    });
    const merged = proposal({
      proposal_id: "p-m",
      status: "merged",
      updated_at: ago(30),
      merged_at: ago(30),
    });
    expect(pickActiveProposal([cancelled, merged])?.proposal_id).toBe("p-m");
    expect(pickActiveProposal([cancelled])).toBeNull();
  });

  it("falls back to GitHub's view when every attempt was cancelled", () => {
    const rows = buildPipelineRows(
      [pr({ merge_state_status: "BEHIND" })],
      [proposal({ status: "cancelled" })]
    );
    expect(rows[0].status.label).toBe("Needs rebase");
    expect(rows[0].status.attention).toBe("waiting");
    expect(rows[0].attempts).toHaveLength(1); // history retained
  });

  it("derives each GitHub-only status per the report's table", () => {
    const cases: Array<[Partial<PrRow>, string]> = [
      [{ merge_state_status: "CLEAN" }, "Ready"],
      [{ merge_state_status: "BEHIND" }, "Needs rebase"],
      [{ mergeable: false }, "Not mergeable"],
      [{ merge_state_status: "DIRTY", mergeable: null }, "Not mergeable"],
      [
        { merge_state_status: "BLOCKED", review_decision: "REVIEW_REQUIRED" },
        "Review required",
      ],
      [
        {
          merge_state_status: "BLOCKED",
          review_decision: "CHANGES_REQUESTED" as const,
        },
        "Changes requested",
      ],
      [
        { merge_state_status: "BLOCKED", failing_contexts: ["security"] },
        "Checks failing",
      ],
      // The common case: BLOCKED only because required checks haven't
      // reported yet. Nobody needs to act.
      [
        { merge_state_status: "BLOCKED", ci_lifecycle: "pending" },
        "Checks in progress",
      ],
      [
        { merge_state_status: "BLOCKED", pending_contexts: ["test (windows)"] },
        "Checks in progress",
      ],
      [{ merge_state_status: "BLOCKED" }, "Blocked by requirements"],
      // UNSTABLE with no failure signal (default fixture: aggregate success)
      // is honest about being in-flight, not failing.
      [{ merge_state_status: "UNSTABLE" }, "Checks in progress"],
      [
        { merge_state_status: "UNSTABLE", ci_conclusion: "failure" },
        "Checks failing",
      ],
      [
        {
          merge_state_status: "UNSTABLE",
          failing_contexts: ["security"],
          ci_conclusion: null,
        },
        "Checks failing",
      ],
      [{ pr_state: "draft", merge_state_status: "DRAFT" }, "Draft"],
      [{ merge_state_status: "UNKNOWN" }, "Syncing"],
      [{ merge_state_status: null }, "Syncing"],
    ];
    for (const [overrides, label] of cases) {
      const rows = buildPipelineRows([pr(overrides)], []);
      expect(rows[0].status.label, JSON.stringify(overrides)).toBe(label);
    }
  });

  it("BEHIND outranks a failing branch check (rebase is the actionable fix)", () => {
    const rows = buildPipelineRows(
      [pr({ merge_state_status: "BEHIND", ci_conclusion: "failure" })],
      []
    );
    expect(rows[0].status.label).toBe("Needs rebase");
  });

  it("renders a multi-repo proposal as one group row with per-repo members", () => {
    const multi = proposal({
      proposal_id: "p-multi",
      status: "awaiting-ci",
      repos: [
        repoDetail({ repo: "qontinui/qontinui-schemas", branch: "feat/ids" }),
        repoDetail({ repo: "qontinui/qontinui-web", branch: "feat/ids" }),
      ],
    });
    const webPr = pr({ branch: "feat/ids", pr_number: 762 });
    const rows = buildPipelineRows([webPr], [multi]);
    const group = rows.find((r) => r.members !== null);
    expect(group).toBeDefined();
    expect(group!.members).toHaveLength(2);
    // The member with an open PR is joined to it; the other has none.
    const webMember = group!.members!.find(
      (m) => m.repo.repo === "qontinui/qontinui-web"
    );
    expect(webMember?.pr?.pr_number).toBe(762);
    // The web PR must not ALSO render as its own top-level row.
    expect(rows.filter((r) => r.prNumber === 762 && !r.members)).toHaveLength(
      1
    );
  });

  it("renders a proposal with no matching PR as a branch-only row", () => {
    const rows = buildPipelineRows(
      [],
      [
        proposal({
          status: "landing",
          repos: [repoDetail({ branch: "agent/x" })],
        }),
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].prNumber).toBeNull();
    expect(rows[0].branch).toBe("agent/x");
    expect(rows[0].status.label).toBe("Landing");
  });

  it("hides coord's own merge-candidate refs", () => {
    const rows = buildPipelineRows(
      [pr({ branch: "merge-candidate/8f3a" })],
      [
        proposal({
          repos: [repoDetail({ branch: "merge-candidate/8f3a" })],
        }),
      ]
    );
    expect(rows).toHaveLength(0);
  });

  it("sorts author-attention rows first and merged rows last", () => {
    const rows = buildPipelineRows(
      [
        pr({ pr_number: 1, branch: "b-ready" }),
        pr({ pr_number: 2, branch: "b-conflict" }),
        pr({ pr_number: 3, branch: "b-merged", pr_state: "merged" }),
      ],
      [
        proposal({
          proposal_id: "p-conf",
          status: "conflict",
          repos: [repoDetail({ branch: "b-conflict" })],
        }),
      ]
    );
    expect(rows.map((r) => r.prNumber)).toEqual([2, 1, 3]);
  });

  it("numbers queued rows by queue position", () => {
    const rows = buildPipelineRows(
      [pr({ pr_number: 1, branch: "b1" }), pr({ pr_number: 2, branch: "b2" })],
      [
        proposal({
          proposal_id: "q2",
          created_at: ago(5),
          repos: [repoDetail({ branch: "b2" })],
        }),
        proposal({
          proposal_id: "q1",
          created_at: ago(20),
          repos: [repoDetail({ branch: "b1" })],
        }),
      ]
    );
    const byNumber = new Map(rows.map((r) => [r.prNumber, r]));
    expect(byNumber.get(1)!.status.reason).toMatch(/^1st in line/);
    expect(byNumber.get(2)!.status.reason).toMatch(/^2nd in line/);
  });

  it("surfaces the merge-candidate CI link from the active proposal", () => {
    const rows = buildPipelineRows(
      [pr()],
      [
        proposal({
          status: "awaiting-ci",
          repos: [
            repoDetail({ ci_run_url: "https://github.com/x/y/actions/runs/1" }),
          ],
        }),
      ]
    );
    expect(rows[0].ciRunUrl).toBe("https://github.com/x/y/actions/runs/1");
  });
});

// ---------------------------------------------------------------------------
// Block-reason UX truth table (plan 2026-07-15-merge-train-block-reason-ux):
// "needs attention" must mean EXACTLY "agent/author action required". A
// still-running non-required check is not an author problem; BEHIND is
// coord's problem (auto-rebase); a named or aggregate failure IS the
// author's problem.
// ---------------------------------------------------------------------------
describe("statusFromGitHub — attention truth table", () => {
  function rowFor(overrides: Partial<PrRow>) {
    return buildPipelineRows([pr(overrides)], [])[0];
  }
  function needsAttention(overrides: Partial<PrRow>): number {
    return derivePipelineHealth(buildPipelineRows([pr(overrides)], []), NOW)
      .needsAttention;
  }

  it("UNSTABLE with only pending contexts → checks-pending, NOT counted", () => {
    const row = rowFor({
      merge_state_status: "UNSTABLE",
      ci_lifecycle: "pending",
      ci_conclusion: null,
      pending_contexts: ["test (windows)"],
    });
    expect(row.status.kind).toBe("checks-pending");
    expect(row.status.attention).toBe("none");
    expect(row.status.reason).toBe("still running: test (windows)");
    expect(
      needsAttention({
        merge_state_status: "UNSTABLE",
        ci_lifecycle: "pending",
        ci_conclusion: null,
        pending_contexts: ["test (windows)"],
      })
    ).toBe(0);
  });

  it("UNSTABLE with failing_contexts → checks-failing, counted, names checks", () => {
    const overrides: Partial<PrRow> = {
      merge_state_status: "UNSTABLE",
      ci_conclusion: null,
      failing_contexts: ["security", "test (windows)"],
    };
    const row = rowFor(overrides);
    expect(row.status.kind).toBe("checks-failing");
    expect(row.status.attention).toBe("author");
    expect(row.status.reason).toBe(
      "failing: security, test (windows) — push a fix"
    );
    expect(needsAttention(overrides)).toBe(1);
  });

  it("names at most 3 failing checks and appends +N more", () => {
    const row = rowFor({
      merge_state_status: "UNSTABLE",
      failing_contexts: ["a", "b", "c", "d", "e"],
    });
    expect(row.status.reason).toContain("failing: a, b, c +2 more");
  });

  it("UNSTABLE + aggregate ci failure (arrays absent) → counted — old-coord fallback", () => {
    const overrides: Partial<PrRow> = {
      merge_state_status: "UNSTABLE",
      ci_lifecycle: "complete",
      ci_conclusion: "failure",
    };
    const row = rowFor(overrides);
    expect(row.status.kind).toBe("checks-failing");
    expect(row.status.attention).toBe("author");
    expect(needsAttention(overrides)).toBe(1);
  });

  it("arrays absent + ci_lifecycle pending → checks-pending (old-coord tolerance)", () => {
    const row = rowFor({
      merge_state_status: "UNSTABLE",
      ci_lifecycle: "pending",
      ci_conclusion: null,
    });
    expect(row.status.kind).toBe("checks-pending");
    expect(row.status.attention).toBe("none");
  });

  it("BEHIND → attention 'waiting' (coord auto-rebases), NOT counted", () => {
    const row = rowFor({ merge_state_status: "BEHIND" });
    expect(row.status.kind).toBe("needs-rebase");
    expect(row.status.attention).toBe("waiting");
    expect(row.status.reason).toBe(
      "behind main — coord auto-rebases it in the train, no action needed"
    );
    expect(needsAttention({ merge_state_status: "BEHIND" })).toBe(0);
  });

  it("BLOCKED (no pending checks) and DIRTY still count as needing the author", () => {
    expect(needsAttention({ merge_state_status: "BLOCKED" })).toBe(1);
    expect(
      needsAttention({ merge_state_status: "DIRTY", mergeable: null })
    ).toBe(1);
  });

  it("BLOCKED only because required checks are running is NOT attention", () => {
    // The reported bug: GitHub says BLOCKED for the whole pre-verdict window,
    // so "CI hasn't finished" was rendering red and inflating the count.
    const overrides: Partial<PrRow> = {
      merge_state_status: "BLOCKED",
      required_checks_satisfied: false,
      ci_lifecycle: "pending",
      ci_conclusion: null,
      pending_contexts: ["test (windows)"],
    };
    const row = rowFor(overrides);
    expect(row.status.kind).toBe("checks-pending");
    expect(row.status.label).toBe("Checks in progress");
    expect(row.status.attention).toBe("none");
    expect(row.status.reason).toBe(
      "required checks still running: test (windows)"
    );
    expect(needsAttention(overrides)).toBe(0);
  });

  it("BLOCKED names the failing required checks when coord provides them", () => {
    const row = rowFor({
      merge_state_status: "BLOCKED",
      failing_contexts: ["security"],
    });
    expect(row.status.kind).toBe("checks-failing");
    expect(row.status.reason).toBe(
      "required checks failing: security — push a fix"
    );
    expect(row.status.attention).toBe("author");
  });

  it("BLOCKED failing checks outrank still-pending ones", () => {
    const row = rowFor({
      merge_state_status: "BLOCKED",
      ci_lifecycle: "pending",
      failing_contexts: ["security"],
      pending_contexts: ["test (windows)"],
    });
    expect(row.status.kind).toBe("checks-failing");
  });

  it("BLOCKED review-decision reasons outrank named failing checks", () => {
    const row = rowFor({
      merge_state_status: "BLOCKED",
      review_decision: "CHANGES_REQUESTED",
      failing_contexts: ["security"],
    });
    expect(row.status.label).toBe("Changes requested");
    expect(row.status.reason).toContain("reviewer requested changes");
  });

  it("BLOCKED fallback attributes rulesets, not just branch protection", () => {
    const row = rowFor({ merge_state_status: "BLOCKED" });
    expect(row.status.reason).toContain("ruleset");
    // Names where to look — a bare "requirements not met" left the operator
    // with nowhere to go, which is what prompted the reason rewrite.
    expect(row.status.reason).toContain("merge box on GitHub");
  });
});

// ---------------------------------------------------------------------------
// CI-duration-aware conflict severity (plan
// 2026-07-17-fleet-ci-duration-aware-severity). A TRUE conflict
// (DIRTY / mergeable===false) is RED ("act now") only when the repo's
// candidate CI is short OR the PR is near the front of the land queue;
// on a long-CI repo that is NOT near front it de-escalates to AMBER
// ("resolve just-before-merge"). Core rule: long CI DAMPENS, front-of-queue
// AMPLIFIES.
// ---------------------------------------------------------------------------
describe("statusFromGitHub — CI-duration-aware conflict severity", () => {
  const HALF_HOUR_SECS = 30 * 60;
  const TWO_HOURS_SECS = 2 * 60 * 60;
  const RUNNER = "qontinui/qontinui-runner";
  const WEB = "qontinui/qontinui-web";

  function conflictRow(
    repo: string,
    economics?: Record<string, MergeEconomics>
  ) {
    const p = pr({ repo, merge_state_status: "DIRTY", mergeable: null });
    return buildPipelineRows([p], [], economics ?? {})[0];
  }

  /** A DIRTY row that coord reports as conflicting for `secs`. */
  function strandedRow(
    repo: string,
    secs: number | null | undefined,
    economics?: Record<string, MergeEconomics>
  ) {
    const p = pr({
      repo,
      merge_state_status: "DIRTY",
      mergeable: null,
      conflict_age_secs: secs,
    });
    return buildPipelineRows([p], [], economics ?? {})[0];
  }

  it("{DIRTY, short-CI} → RED (act now) — measured p90 below threshold", () => {
    const econ: Record<string, MergeEconomics> = {
      [WEB]: { candidate_ci_p90_secs: 5 * 60, queue_depth: 20 },
    };
    const row = conflictRow(WEB, econ);
    expect(row.status.kind).toBe("not-mergeable");
    expect(row.status.attention).toBe("author");
    expect(row.status.reason).toBe("conflict — blocks now");
  });

  it("{DIRTY, long-CI, not-front} → AMBER (resolve at merge) — measured p90", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 12 },
    };
    const row = conflictRow(RUNNER, econ);
    // KEY de-escalation assertion (mutation target): long CI + not near front
    // MUST NOT be red. Flipping the de-escalation off makes this "not-mergeable"
    // and this test fails.
    expect(row.status.kind).toBe("conflict-deferred");
    expect(row.status.attention).toBe("waiting");
    expect(row.status.reason).toBe(
      "conflict — resolve at merge (repo CI ~2h, 12 in queue)"
    );
  });

  // -------------------------------------------------------------------------
  // The staleness escape hatch. `conflict-deferred` says "resolve this at
  // merge", which holds ONLY while "coord reaches this PR soon" holds. coord
  // lands by rebase and cannot rebase past a true conflict, so a deferred PR
  // never advances to the front where the label says to fix it — it sits
  // amber, excluded from needs-attention, indefinitely. Measured 2026-07-20:
  // 17 PRs stranded fleet-wide, oldest 752h. These tests are the mutation
  // target: delete the hatch and they fail.
  // -------------------------------------------------------------------------
  it("long-CI + not-front + WITHIN the deferral window → still AMBER", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 12 },
    };
    // 3h stranded, window is max(6h, 2 x 2h) = 6h → not yet expired.
    const row = strandedRow(RUNNER, 3 * 60 * 60, econ);
    expect(row.status.kind).toBe("conflict-deferred");
    expect(row.status.attention).toBe("waiting");
  });

  it("long-CI + not-front + PAST the deferral window → RED (stranded)", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 12 },
    };
    // 31 days — the qontinui-schemas#85 case.
    const row = strandedRow(RUNNER, 31 * 24 * 60 * 60, econ);
    expect(row.status.kind).toBe("conflict-stranded");
    expect(row.status.attention).toBe("author");
    expect(row.status.reason).toContain("needs an author rebase");
  });

  it("counts toward needsAttention once stranded (the whole point)", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 12 },
    };
    const deferred = derivePipelineHealth(
      [strandedRow(RUNNER, 3 * 60 * 60, econ)],
      NOW,
      econ
    );
    const stranded = derivePipelineHealth(
      [strandedRow(RUNNER, 31 * 24 * 60 * 60, econ)],
      NOW,
      econ
    );
    expect(deferred.needsAttention).toBe(0);
    expect(stranded.needsAttention).toBe(1);
  });

  it("a strand reaches the HEALTH HEADLINE, not just the row badge", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 12 },
    };
    // A stranded PR has NO active proposal (terminal conflicts are excluded
    // from the in-flight feed), so a headline counting only active proposals
    // reports a healthy fleet while 17 PRs rot.
    const health = derivePipelineHealth(
      [strandedRow(RUNNER, 31 * 24 * 60 * 60, econ)],
      NOW,
      econ
    );
    // Surfaces in the detail line and the count — visibility was the point.
    // It must NOT move the level: a strand is author backlog, and the train
    // can be landing perfectly beside it.
    expect(health.conflicted).toBe(1);
    expect(health.detail).toContain("author rebase");
  });

  it("ABSENT conflict_age_secs is 'no evidence', never 'not stranded'", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 12 },
    };
    // An older coord deploy omits the field: behaviour must be unchanged
    // (amber), NOT escalated on missing data.
    expect(strandedRow(RUNNER, undefined, econ).status.kind).toBe(
      "conflict-deferred"
    );
    expect(strandedRow(RUNNER, null, econ).status.kind).toBe(
      "conflict-deferred"
    );
    expect(conflictStrandedForMs({ conflict_age_secs: undefined })).toBeNull();
    expect(conflictStrandedForMs({ conflict_age_secs: null })).toBeNull();
    // Nonsense values are evidence of nothing, not of a strand.
    expect(conflictStrandedForMs({ conflict_age_secs: -5 })).toBeNull();
    expect(conflictStrandedForMs({ conflict_age_secs: NaN })).toBeNull();
  });

  it("a strand cannot downgrade an already-RED conflict", () => {
    // Short-CI repo: already "blocks now". A stale clock must not turn a red
    // row amber, so precedence is red-before-deferral in both directions.
    const econ: Record<string, MergeEconomics> = {
      [WEB]: { candidate_ci_p90_secs: 5 * 60, queue_depth: 20 },
    };
    const row = strandedRow(WEB, 31 * 24 * 60 * 60, econ);
    expect(row.status.attention).toBe("author");
  });

  it("deferral window is per-repo: max(floor, 2 x candidate p90)", () => {
    // (Mechanically relocated from `conflictDeferralMaxMs`, which the shared
    // `waitingDwellCapMs` absorbed — same kind, same caps, same behavior.)
    // No economics → the floor.
    expect(waitingDwellCapMs("conflict-deferred", RUNNER)).toBe(
      CONFLICT_DEFERRAL_MAX_MS
    );
    // Fast repo → floor still wins (a grace window, not an instant flip).
    expect(
      waitingDwellCapMs("conflict-deferred", WEB, {
        [WEB]: { candidate_ci_p90_secs: 5 * 60 },
      })
    ).toBe(CONFLICT_DEFERRAL_MAX_MS);
    // Slow repo → two full worst-case runs.
    expect(
      waitingDwellCapMs("conflict-deferred", RUNNER, {
        [RUNNER]: { candidate_ci_p90_secs: 5 * 60 * 60 },
      })
    ).toBe(10 * 60 * 60 * 1000);
  });

  it("{DIRTY, long-CI, front-of-queue} → RED — shallow queue amplifies", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 1 },
    };
    const row = conflictRow(RUNNER, econ);
    expect(row.status.kind).toBe("not-mergeable");
    expect(row.status.attention).toBe("author");
    expect(row.status.reason).toBe(
      "conflict — blocks now (near front of land queue)"
    );
  });

  it("p90 exactly at the 30m threshold reads as long-CI (>=) → AMBER when not front", () => {
    const econ: Record<string, MergeEconomics> = {
      [WEB]: { candidate_ci_p90_secs: HALF_HOUR_SECS },
    };
    const row = conflictRow(WEB, econ);
    expect(row.status.kind).toBe("conflict-deferred");
    // No queue_depth → "deep in queue" phrasing.
    expect(row.status.reason).toBe(
      "conflict — resolve at merge (repo CI ~30m, deep in queue)"
    );
  });

  it("economics-absent + long-CI repo hint (qontinui-runner) → AMBER (fallback)", () => {
    const row = conflictRow(RUNNER); // no economics at all
    expect(row.status.kind).toBe("conflict-deferred");
    expect(row.status.attention).toBe("waiting");
    // Fallback CI phrase uses CI_WAIT_RED_MS (~2h); no queue depth known.
    expect(row.status.reason).toBe(
      "conflict — resolve at merge (repo CI ~2h, deep in queue)"
    );
  });

  it("economics-absent + non-hint repo (short-CI by default) → RED (fallback)", () => {
    const row = conflictRow(WEB); // qontinui-web is not a long-CI hint
    expect(row.status.kind).toBe("not-mergeable");
    expect(row.status.attention).toBe("author");
    expect(row.status.reason).toBe("conflict — blocks now");
  });

  it("mergeable===false is treated identically to DIRTY", () => {
    const p = pr({
      repo: RUNNER,
      merge_state_status: "UNKNOWN",
      mergeable: false,
    });
    const row = buildPipelineRows([p], [], {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 9 },
    })[0];
    expect(row.status.kind).toBe("conflict-deferred");
  });

  it("de-escalated (amber) conflicts are NOT counted as needs-attention", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 12 },
    };
    const rows = buildPipelineRows(
      [pr({ repo: RUNNER, merge_state_status: "DIRTY", mergeable: null })],
      [],
      econ
    );
    expect(derivePipelineHealth(rows, NOW, econ).needsAttention).toBe(0);
  });

  it("BEHIND stays amber and CLEAN stays neutral regardless of economics", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 12 },
    };
    const behind = buildPipelineRows(
      [pr({ repo: RUNNER, merge_state_status: "BEHIND" })],
      [],
      econ
    )[0];
    expect(behind.status.label).toBe("Needs rebase");
    expect(behind.status.attention).toBe("waiting");
    const clean = buildPipelineRows(
      [pr({ repo: RUNNER, merge_state_status: "CLEAN" })],
      [],
      econ
    )[0];
    expect(clean.status.attention).toBe("none");
  });

  it("UNSTABLE + failure stays RED even on a long-CI repo", () => {
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: TWO_HOURS_SECS, queue_depth: 12 },
    };
    const row = buildPipelineRows(
      [
        pr({
          repo: RUNNER,
          merge_state_status: "UNSTABLE",
          ci_conclusion: "failure",
        }),
      ],
      [],
      econ
    )[0];
    expect(row.status.kind).toBe("checks-failing");
    expect(row.status.attention).toBe("author");
  });
});

// ---------------------------------------------------------------------------
// Stale-waiting dwell caps (plan 2026-07-20-fleet-waiting-state-dwell-caps).
// Every `waiting` kind is a promise about the near future with no expiry —
// past its per-repo dwell cap, with a live clock, it escalates to a stale
// sibling carrying `attention: "author"`. Absence of a clock is never
// evidence, in either direction.
// ---------------------------------------------------------------------------
describe("escalateStaleWaiting — dwell caps expire every waiting promise", () => {
  const ESCALATABLE = Object.keys(STALE_ESCALATION) as UnifiedStatusKind[];

  const STALE_LABEL: Record<string, string> = {
    "needs-rebase-stale": "Behind (stalled)",
    "blocked-stale": "Blocked (stalled)",
    "conflict-stranded": "Conflict (stranded)",
  };

  /** A hand-built waiting status of the given kind (unit-level fixture). */
  function waiting(kind: UnifiedStatusKind): UnifiedStatus {
    return { kind, label: "x", reason: "y", attention: "waiting" };
  }

  it("covers exactly the three waiting kinds", () => {
    expect(ESCALATABLE.sort()).toEqual([
      "blocked",
      "conflict-deferred",
      "needs-rebase",
    ]);
    // ...and every base kind actually IS a waiting kind, every target an
    // author kind — the map cannot escalate a running check or de-escalate.
    for (const base of ESCALATABLE) {
      expect(ATTENTION_BY_KIND[base]).toBe("waiting");
      expect(ATTENTION_BY_KIND[STALE_ESCALATION[base]!]).toBe("author");
    }
  });

  it("per kind: within cap → unchanged; past cap → stale kind + author", () => {
    for (const base of ESCALATABLE) {
      const s = waiting(base);
      const cap = waitingDwellCapMs(base, "qontinui/qontinui-web");
      // At or under the cap the promise is still live — identity, unchanged.
      expect(escalateStaleWaiting(s, cap - 60_000, cap)).toBe(s);
      expect(escalateStaleWaiting(s, cap, cap)).toBe(s);
      // Past the cap: escalated kind, author attention, honest duration.
      const dwell = cap + 3 * 24 * 60 * 60 * 1000;
      const out = escalateStaleWaiting(s, dwell, cap);
      expect(out.kind, base).toBe(STALE_ESCALATION[base]);
      expect(out.attention, base).toBe("author");
      expect(out.label, base).toBe(STALE_LABEL[out.kind]);
      expect(out.reason, base).toContain(formatDurationShort(dwell));
    }
  });

  it("absence: null / undefined / NaN / negative dwell → unchanged, every kind", () => {
    for (const base of ESCALATABLE) {
      const s = waiting(base);
      expect(escalateStaleWaiting(s, null, 1000)).toBe(s);
      expect(escalateStaleWaiting(s, Number.NaN, 1000)).toBe(s);
      expect(escalateStaleWaiting(s, -5, 1000)).toBe(s);
      expect(escalateStaleWaiting(s, Number.POSITIVE_INFINITY, 1000)).toBe(s);
    }
    // The activity-clock reader turns undefined/null/nonsense into null ("no
    // evidence") — same hygiene as its sibling `conflictStrandedForMs`.
    expect(lastActivityForMs({ last_activity_secs: undefined })).toBeNull();
    expect(lastActivityForMs({ last_activity_secs: null })).toBeNull();
    expect(lastActivityForMs({ last_activity_secs: Number.NaN })).toBeNull();
    expect(lastActivityForMs({ last_activity_secs: -5 })).toBeNull();
    expect(lastActivityForMs({ last_activity_secs: 90 })).toBe(90_000);
  });

  it("never touches a non-waiting status — no downgrade, never from 'none'", () => {
    const huge = 400 * 24 * 60 * 60 * 1000;
    // attention "none": a running check is not a stale promise. Hand-built
    // with an escalatable kind to isolate the attention gate from the map.
    const none: UnifiedStatus = {
      kind: "needs-rebase",
      label: "x",
      reason: "y",
      attention: "none",
    };
    expect(escalateStaleWaiting(none, huge, 1000)).toBe(none);
    // Already-author: escalation only ever moves waiting → author.
    const author: UnifiedStatus = {
      kind: "conflict-deferred",
      label: "x",
      reason: "y",
      attention: "author",
    };
    expect(escalateStaleWaiting(author, huge, 1000)).toBe(author);
    // Kinds outside the map never change regardless of dwell.
    const ready: UnifiedStatus = {
      kind: "ready",
      label: "Ready",
      reason: "r",
      attention: "none",
    };
    expect(escalateStaleWaiting(ready, huge, 1000)).toBe(ready);
  });

  it("caps: max(24h, 4 × p90) for the non-conflict kinds, per-repo", () => {
    const RUNNER = "qontinui/qontinui-runner";
    // No economics → the 24h floor.
    expect(waitingDwellCapMs("needs-rebase", RUNNER)).toBe(
      WAITING_STALE_MAX_MS
    );
    expect(waitingDwellCapMs("blocked", RUNNER)).toBe(WAITING_STALE_MAX_MS);
    // Fast repo → the floor still wins.
    expect(
      waitingDwellCapMs("needs-rebase", RUNNER, {
        [RUNNER]: { candidate_ci_p90_secs: 5 * 60 },
      })
    ).toBe(WAITING_STALE_MAX_MS);
    // Slow repo → four full worst-case candidate runs.
    expect(
      waitingDwellCapMs("blocked", RUNNER, {
        [RUNNER]: { candidate_ci_p90_secs: 10 * 60 * 60 },
      })
    ).toBe(40 * 60 * 60 * 1000);
  });
});

describe("buildPipelineRows — dwell escalation covers both derivation paths", () => {
  const THREE_DAYS_SECS = 3 * 24 * 60 * 60;
  const ONE_HOUR_SECS = 60 * 60;

  it("needs-rebase from statusFromGitHub (BEHIND, no proposal) escalates — the 6-of-16 guard", () => {
    const row = buildPipelineRows(
      [
        pr({
          merge_state_status: "BEHIND",
          last_activity_secs: THREE_DAYS_SECS,
        }),
      ],
      []
    )[0];
    expect(row.status.kind).toBe("needs-rebase-stale");
    expect(row.status.label).toBe("Behind (stalled)");
    expect(row.status.attention).toBe("author");
    expect(row.status.reason).toContain("3d");
    expect(row.status.reason).toContain("author");
  });

  it("blocked from statusFromProposal (active blocked-by-overlap) escalates the same way", () => {
    const row = buildPipelineRows(
      [pr({ last_activity_secs: THREE_DAYS_SECS })],
      [proposal({ status: "blocked-by-overlap" })]
    )[0];
    expect(row.activeProposal).not.toBeNull();
    expect(row.status.kind).toBe("blocked-stale");
    expect(row.status.label).toBe("Blocked (stalled)");
    expect(row.status.attention).toBe("author");
    expect(row.status.reason).toContain("3d");
  });

  it("within the cap both stay waiting, unescalated", () => {
    const behind = buildPipelineRows(
      [pr({ merge_state_status: "BEHIND", last_activity_secs: ONE_HOUR_SECS })],
      []
    )[0];
    expect(behind.status.kind).toBe("needs-rebase");
    expect(behind.status.attention).toBe("waiting");
    const blocked = buildPipelineRows(
      [pr({ last_activity_secs: ONE_HOUR_SECS })],
      [proposal({ status: "blocked-by-overlap" })]
    )[0];
    expect(blocked.status.kind).toBe("blocked");
    expect(blocked.status.attention).toBe("waiting");
  });

  it("absent clock → rendered exactly as today, for both kinds", () => {
    // No `last_activity_secs` at all (older coord deploy / no events): the
    // rows must not escalate — absence is never evidence of staleness.
    const behind = buildPipelineRows(
      [pr({ merge_state_status: "BEHIND" })],
      []
    )[0];
    expect(behind.status.kind).toBe("needs-rebase");
    const blocked = buildPipelineRows(
      [pr()],
      [proposal({ status: "blocked-by-overlap" })]
    )[0];
    expect(blocked.status.kind).toBe("blocked");
  });

  it("the cap is per-repo: a slow repo's longer leash defers escalation", () => {
    const RUNNER = "qontinui/qontinui-runner";
    // p90 = 10h → cap = 40h. 30h of silence is within it; 41h is past it.
    const econ: Record<string, MergeEconomics> = {
      [RUNNER]: { candidate_ci_p90_secs: 10 * 60 * 60 },
    };
    const within = buildPipelineRows(
      [
        pr({
          repo: RUNNER,
          merge_state_status: "BEHIND",
          last_activity_secs: 30 * 60 * 60,
        }),
      ],
      [],
      econ
    )[0];
    expect(within.status.kind).toBe("needs-rebase");
    const past = buildPipelineRows(
      [
        pr({
          repo: RUNNER,
          merge_state_status: "BEHIND",
          last_activity_secs: 41 * 60 * 60,
        }),
      ],
      [],
      econ
    )[0];
    expect(past.status.kind).toBe("needs-rebase-stale");
  });

  it("a proposal-only row (no PrRow) routes through the helper and never escalates", () => {
    const row = buildPipelineRows(
      [],
      [
        proposal({
          status: "blocked-by-overlap",
          repos: [repoDetail({ branch: "agent/x" })],
        }),
      ]
    )[0];
    expect(row.prNumber).toBeNull();
    // No PrRow → no dwell clock → the waiting promise stays unexpired.
    expect(row.status.kind).toBe("blocked");
    expect(row.status.attention).toBe("waiting");
  });

  it("stale rows reach derivePipelineHealth's counters — each new kind", () => {
    // web#813 shipped the row-badge-only version of this exact bug: the
    // escalation reached the badge but not the headline the operator scans.
    const behindStale = buildPipelineRows(
      [
        pr({
          merge_state_status: "BEHIND",
          last_activity_secs: THREE_DAYS_SECS,
        }),
      ],
      []
    );
    expect(derivePipelineHealth(behindStale, NOW).needsAttention).toBe(1);
    const behindFresh = buildPipelineRows(
      [pr({ merge_state_status: "BEHIND", last_activity_secs: ONE_HOUR_SECS })],
      []
    );
    expect(derivePipelineHealth(behindFresh, NOW).needsAttention).toBe(0);

    const blockedStale = buildPipelineRows(
      [pr({ last_activity_secs: THREE_DAYS_SECS })],
      [proposal({ status: "blocked-by-overlap" })]
    );
    expect(derivePipelineHealth(blockedStale, NOW).needsAttention).toBe(1);
    const blockedFresh = buildPipelineRows(
      [pr({ last_activity_secs: ONE_HOUR_SECS })],
      [proposal({ status: "blocked-by-overlap" })]
    );
    expect(derivePipelineHealth(blockedFresh, NOW).needsAttention).toBe(0);
  });

  it("stale rows reach the headline DETAIL, not just the counter", () => {
    // Counters alone were not the web#813 lesson — the operator scans the
    // detail string. A stalled wait must say so there.
    const behindStale = buildPipelineRows(
      [
        pr({
          merge_state_status: "BEHIND",
          last_activity_secs: THREE_DAYS_SECS,
        }),
      ],
      []
    );
    expect(derivePipelineHealth(behindStale, NOW).detail).toContain(
      "1 stalled waiting PR needs an author look"
    );
    const behindFresh = buildPipelineRows(
      [pr({ merge_state_status: "BEHIND", last_activity_secs: ONE_HOUR_SECS })],
      []
    );
    expect(derivePipelineHealth(behindFresh, NOW).detail ?? "").not.toContain(
      "stalled waiting"
    );
  });
});

describe("derivePipelineHealth — per-repo CI-wait thresholds", () => {
  it("a long-CI repo's awaiting-ci wait is judged against its own p90, not the global 2h", () => {
    // 90m wait on a repo whose p90 is 3h → below its red line, so NOT red
    // (global CI_WAIT_RED_MS would have flagged 2h; per-repo does not).
    const econ: Record<string, MergeEconomics> = {
      "qontinui/qontinui-runner": { candidate_ci_p90_secs: 3 * 60 * 60 },
    };
    const rows = buildPipelineRows(
      [pr({ repo: "qontinui/qontinui-runner", branch: "b1" })],
      [
        proposal({
          status: "awaiting-ci",
          updated_at: new Date(NOW - 90 * 60_000).toISOString(),
          repos: [
            repoDetail({ repo: "qontinui/qontinui-runner", branch: "b1" }),
          ],
        }),
      ],
      econ
    );
    // 90m > amber (p90/2 = 90m boundary; strictly greater fails) — use 100m.
    const h = derivePipelineHealth(rows, NOW, econ);
    expect(h.level).not.toBe("red");
  });

  it("honors coord's suggested_stuck_threshold_secs as the red line", () => {
    const econ: Record<string, MergeEconomics> = {
      "qontinui/qontinui-runner": { suggested_stuck_threshold_secs: 20 * 60 },
    };
    const rows = buildPipelineRows(
      [pr({ repo: "qontinui/qontinui-runner", branch: "b1" })],
      [
        proposal({
          status: "awaiting-ci",
          updated_at: new Date(NOW - 25 * 60_000).toISOString(),
          repos: [
            repoDetail({ repo: "qontinui/qontinui-runner", branch: "b1" }),
          ],
        }),
      ],
      econ
    );
    // 25m > 20m red line → red.
    expect(derivePipelineHealth(rows, NOW, econ).level).toBe("red");
  });
});

// ---------------------------------------------------------------------------
// The audit that keeps color honest.
// ---------------------------------------------------------------------------

describe("ATTENTION_BY_KIND — the color/attention contract", () => {
  /**
   * Every status this module can construct, from every branch of both
   * derivations. If a new kind or branch is added without an entry in
   * `ATTENTION_BY_KIND`, or with an attention that contradicts it, this fails
   * — and so does the badge palette keyed off the same table.
   */
  const EVERY_STATUS: Array<{ what: string; row: PipelineRow }> = [
    ...(
      [
        ["CLEAN", { merge_state_status: "CLEAN" }],
        ["BEHIND", { merge_state_status: "BEHIND" }],
        ["DIRTY", { merge_state_status: "DIRTY", mergeable: null }],
        ["draft", { pr_state: "draft", merge_state_status: "DRAFT" }],
        ["unknown", { merge_state_status: "UNKNOWN" }],
        [
          "merged (merge button)",
          { pr_state: "merged", merge_state_status: "CLEAN" },
        ],
        [
          "merged (coord ff-land)",
          { pr_state: "closed", merge_commit_sha: "deadbeefcafe" },
        ],
        [
          "BLOCKED/review",
          {
            merge_state_status: "BLOCKED",
            review_decision: "REVIEW_REQUIRED" as const,
          },
        ],
        [
          "BLOCKED/failing",
          { merge_state_status: "BLOCKED", failing_contexts: ["security"] },
        ],
        [
          "BLOCKED/pending",
          { merge_state_status: "BLOCKED", ci_lifecycle: "pending" },
        ],
        ["BLOCKED/ruleset", { merge_state_status: "BLOCKED" }],
        [
          "UNSTABLE/failing",
          { merge_state_status: "UNSTABLE", ci_conclusion: "failure" },
        ],
        [
          "UNSTABLE/pending",
          { merge_state_status: "UNSTABLE", ci_lifecycle: "pending" },
        ],
      ] as Array<[string, Partial<PrRow>]>
    ).map(([what, overrides]) => ({
      what,
      row: buildPipelineRows([pr(overrides)], [])[0],
    })),
    // The de-escalated conflict needs long-CI economics to be reachable.
    {
      what: "conflict-deferred",
      row: buildPipelineRows(
        [pr({ repo: "qontinui/qontinui-runner", mergeable: false })],
        [],
        {
          "qontinui/qontinui-runner": {
            candidate_ci_p90_secs: 4 * 60 * 60,
            queue_depth: 9,
          },
        }
      )[0],
    },
    // Same shape, but stranded past the deferral window → re-escalated.
    {
      what: "conflict-stranded",
      row: buildPipelineRows(
        [
          pr({
            repo: "qontinui/qontinui-runner",
            mergeable: false,
            conflict_age_secs: 30 * 24 * 60 * 60,
          }),
        ],
        [],
        {
          "qontinui/qontinui-runner": {
            candidate_ci_p90_secs: 4 * 60 * 60,
            queue_depth: 9,
          },
        }
      )[0],
    },
    // The stale escalations of the two non-conflict waiting kinds: a PR whose
    // last observed activity is older than the 24h dwell floor.
    {
      what: "needs-rebase-stale",
      row: buildPipelineRows(
        [
          pr({
            merge_state_status: "BEHIND",
            last_activity_secs: 3 * 24 * 60 * 60,
          }),
        ],
        []
      )[0],
    },
    {
      what: "blocked-stale",
      row: buildPipelineRows(
        [pr({ last_activity_secs: 3 * 24 * 60 * 60 })],
        [proposal({ status: "blocked-by-overlap" })]
      )[0],
    },
    ...(
      [
        "queued",
        "dry-rebasing",
        "awaiting-ci",
        "landing",
        "merged",
        "conflict",
        "blocked-by-overlap",
      ] as const
    ).map((status) => ({
      what: `proposal:${status}`,
      row: buildPipelineRows([pr()], [proposal({ status })])[0],
    })),
  ];

  it("covers every declared kind at least once", () => {
    const seen = new Set(EVERY_STATUS.map((s) => s.row.status.kind));
    expect([...seen].sort()).toEqual(
      Object.keys(ATTENTION_BY_KIND).sort() as UnifiedStatusKind[]
    );
  });

  it.each(EVERY_STATUS)(
    "$what carries the audited attention for its kind",
    ({ row }) => {
      expect(row.status.attention).toBe(ATTENTION_BY_KIND[row.status.kind]);
    }
  );

  it("no state that needs nobody is filed as needing the author", () => {
    // The original bug, stated as an invariant: "checks are still running" is
    // never an author-action state, and "a check failed" always is.
    expect(ATTENTION_BY_KIND["checks-pending"]).toBe("none");
    expect(ATTENTION_BY_KIND["awaiting-ci"]).toBe("none");
    expect(ATTENTION_BY_KIND["checks-failing"]).toBe("author");
  });

  it("every status explains itself — no blank reasons", () => {
    for (const { what, row } of EVERY_STATUS) {
      expect(row.status.reason, `${what} has no reason`).not.toBe("");
    }
  });
});

describe("merged rows", () => {
  const MERGED_A = pr({
    pr_number: 10,
    branch: "b-old",
    pr_state: "merged",
    merged_at: ago(600),
    merge_commit_sha: "aaaaaaa1111",
  });
  const MERGED_B = pr({
    pr_number: 11,
    branch: "b-new",
    pr_state: "closed", // coord ff-land: closed with merged=false
    merged_at: ago(5),
    merge_commit_sha: "bbbbbbb2222",
  });

  it("detects BOTH land paths and carries the land time", () => {
    const rows = buildPipelineRows([MERGED_A, MERGED_B], []);
    expect(rows.map((r) => r.status.kind)).toEqual(["merged", "merged"]);
    expect(rows.map((r) => r.mergedAt)).toEqual([ago(5), ago(600)]);
  });

  it("orders newest merge first and shows the landed sha in the reason", () => {
    const rows = buildPipelineRows([MERGED_A, MERGED_B], []).filter((r) =>
      matchesFilter(r, "merged")
    );
    expect(rows.map((r) => r.prNumber)).toEqual([11, 10]);
    expect(rows[0].status.reason).toContain("bbbbbbb");
  });

  it("treats a closed row as merged even with NO sha (pre-projection coord)", () => {
    // coord's ff-land closes the PR with merged=false and older deploys do
    // not serialize merge_commit_sha. Gating on the sha would drop these
    // through to the GitHub derivation and show landed PRs as "Ready" in the
    // LIVE list — strictly worse than not having the tab.
    const row = buildPipelineRows(
      [pr({ pr_state: "closed", merge_state_status: "CLEAN" })],
      []
    )[0];
    expect(row.status.kind).toBe("merged");
    expect(matchesFilter(row, "all")).toBe(false);
    // No sha to cite, so the reason names the branch only — never a fake sha.
    expect(row.status.reason).toBe("landed on main");
  });

  it("keeps merged rows out of the live list and in their own tab", () => {
    const rows = buildPipelineRows([MERGED_A, pr({ pr_number: 12 })], []);
    expect(
      rows.filter((r) => matchesFilter(r, "all")).map((r) => r.prNumber)
    ).toEqual([12]);
    expect(
      rows.filter((r) => matchesFilter(r, "merged")).map((r) => r.prNumber)
    ).toEqual([10]);
  });

  it("reports 'no land time' rather than passing off a refresh time", () => {
    // Coord deploys that don't project `merged_at` must not make the tab lie.
    const row = buildPipelineRows(
      [pr({ pr_state: "merged", last_refreshed_at: ago(3) })],
      []
    )[0];
    expect(row.status.kind).toBe("merged");
    expect(row.mergedAt).toBeNull();
  });

  it("feeds the health strip's 'last merged' from PR rows, not just proposals", () => {
    // `GET /merge/queue` excludes terminal proposals, so before this the
    // health strip read "last merged never" on a perfectly healthy fleet.
    const h = derivePipelineHealth(buildPipelineRows([MERGED_B], []), NOW);
    expect(h.lastMergedAt).toBe(ago(5));
  });

  // --- isMergedPr: the predicate the merged tab's contents rest on -----------

  it("isMergedPr: an open row with no merge sha is NOT merged", () => {
    // The whole safety argument for accepting a merge sha as a land signal is
    // that a live PR never carries one — coord's open-PR query does not even
    // project the column. If this ever flips, open PRs start rendering as
    // landed and vanish from the live list.
    expect(isMergedPr(pr())).toBe(false);
    expect(isMergedPr(pr({ pr_state: "draft" }))).toBe(false);
    expect(isMergedPr(pr({ pr_state: "open", merge_commit_sha: null }))).toBe(
      false
    );
  });

  it("isMergedPr: a phantom-open ff-land IS merged", () => {
    // coord's ff-land pushes a rebased sha, so GitHub never auto-closes the
    // PR: pr_state stays 'open' while the row is landed. pr_state alone misses
    // it; the sha is the land-path-independent signal.
    const phantom = pr({ pr_state: "open", merge_commit_sha: "ccccccc3333" });
    expect(isMergedPr(phantom)).toBe(true);
    expect(buildPipelineRows([phantom], [])[0].status.kind).toBe("merged");
  });

  it("isMergedPr: both terminal pr_states still count with no sha", () => {
    expect(isMergedPr(pr({ pr_state: "merged" }))).toBe(true);
    expect(isMergedPr(pr({ pr_state: "closed" }))).toBe(true);
  });

  it("a landed PR reads as merged even with a live proposal attached", () => {
    // Terminal outranks the proposal lifecycle. A PR merged by the merge
    // button while coord's proposal still sits `queued` used to render as
    // queued — unfinished work that had in fact landed, and a landing the
    // merged tab's count claimed but did not show.
    const landed = pr({
      pr_number: 20,
      branch: "b-landed",
      pr_state: "merged",
      merged_at: ago(2),
      merge_commit_sha: "ddddddd4444",
    });
    const rows = buildPipelineRows(
      [landed],
      [
        proposal({
          status: "queued",
          repos: [repoDetail({ branch: "b-landed" })],
        }),
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status.kind).toBe("merged");
    expect(matchesFilter(rows[0], "merged")).toBe(true);
    expect(matchesFilter(rows[0], "all")).toBe(false);
    // ...and NOT still in flight. The proposal lags the land, so keying the
    // in-flight arm on the proposal alone would file one row under two tabs.
    expect(matchesFilter(rows[0], "in-flight")).toBe(false);
  });
});

describe("filters + search", () => {
  const rows = buildPipelineRows(
    [
      pr({ pr_number: 1, branch: "b-conflict" }),
      pr({ pr_number: 2, branch: "b-queued" }),
      pr({ pr_number: 3, branch: "b-ready" }),
    ],
    [
      proposal({
        proposal_id: "pc",
        status: "conflict",
        repos: [repoDetail({ branch: "b-conflict" })],
      }),
      proposal({
        proposal_id: "pq",
        status: "queued",
        repos: [repoDetail({ branch: "b-queued" })],
      }),
    ]
  );

  it("attention = rows needing anyone; in-flight = live proposals only", () => {
    const attention = rows.filter((r) => matchesFilter(r, "attention"));
    expect(attention.map((r) => r.prNumber)).toEqual([1]);
    const inFlight = rows.filter((r) => matchesFilter(r, "in-flight"));
    expect(inFlight.map((r) => r.prNumber).sort()).toEqual([1, 2]);
    expect(rows.every((r) => matchesFilter(r, "all"))).toBe(true);
    expect(rows.some((r) => matchesFilter(r, "merged"))).toBe(false);
  });

  it("matches repo shorthand, #number, branch, and status label", () => {
    const row = rows.find((r) => r.prNumber === 1)!;
    expect(matchesQuery(row, "qontinui-web")).toBe(true);
    expect(matchesQuery(row, "#1")).toBe(true);
    expect(matchesQuery(row, "b-conflict")).toBe(true);
    expect(matchesQuery(row, "conflict")).toBe(true);
    expect(matchesQuery(row, "nope")).toBe(false);
    expect(matchesQuery(row, "  ")).toBe(true);
  });
});

describe("derivePipelineHealth", () => {
  it("is green while proposals advance normally", () => {
    const rows = buildPipelineRows(
      [pr()],
      [proposal({ status: "dry-rebasing", updated_at: ago(1) })]
    );
    const h = derivePipelineHealth(rows, NOW);
    expect(h.level).toBe("green");
    expect(h.headline).toBe("Merging normally");
    expect(h.queueDepth).toBe(1);
    expect(h.inFlight).toBe(1);
  });

  it("conflicts never turn the strip red, however many accumulate", () => {
    const one = buildPipelineRows(
      [pr({ branch: "b1" })],
      [
        proposal({
          proposal_id: "c1",
          status: "conflict",
          updated_at: ago(1),
          repos: [repoDetail({ branch: "b1" })],
        }),
      ]
    );
    // CONTRACT CHANGE (2026-07-20): conflict COUNT no longer sets the level.
    // A conflicted PR has no candidate in the train and cannot slow it. Amber
    // here comes from the EMPTY-TRAIN floor (this one conflict is the whole
    // fleet, so nothing can move) — never from the count itself, and never red.
    expect(derivePipelineHealth(one, NOW).level).toBe("amber");
    expect(derivePipelineHealth(one, NOW).conflicted).toBe(1);
    expect(derivePipelineHealth(one, NOW).detail).toContain(
      "1 PR needs an author rebase"
    );

    const two = buildPipelineRows(
      [pr({ branch: "b1" }), pr({ branch: "b2", pr_number: 9 })],
      [
        proposal({
          proposal_id: "c1",
          status: "conflict",
          updated_at: ago(1),
          repos: [repoDetail({ branch: "b1" })],
        }),
        proposal({
          proposal_id: "c2",
          status: "conflict",
          updated_at: ago(1),
          repos: [repoDetail({ branch: "b2" })],
        }),
      ]
    );
    const h = derivePipelineHealth(two, NOW);
    // Same contract change: two conflicting PRs are two author asks, not a
    // stopped pipeline. Amber from the empty-train floor; crucially NOT red,
    // and never "Pipeline stuck".
    expect(h.level).toBe("amber");
    expect(h.headline).not.toBe("Pipeline stuck");
    expect(h.conflicted).toBe(2);
    expect(h.detail).toContain("2 PRs need an author rebase");
  });

  it("flags a stuck CI wait at amber then red thresholds", () => {
    const mk = (ageMs: number) =>
      buildPipelineRows(
        [pr()],
        [
          proposal({
            status: "awaiting-ci",
            updated_at: new Date(NOW - ageMs).toISOString(),
          }),
        ]
      );
    expect(derivePipelineHealth(mk(CI_WAIT_AMBER_MS + 60_000), NOW).level).toBe(
      "amber"
    );
    expect(derivePipelineHealth(mk(CI_WAIT_RED_MS + 60_000), NOW).level).toBe(
      "red"
    );
  });

  it("reads a quiet non-empty queue as stalled", () => {
    const rows = buildPipelineRows(
      [pr()],
      [
        proposal({
          status: "queued",
          updated_at: new Date(NOW - STALL_RED_MS - 60_000).toISOString(),
        }),
      ]
    );
    const h = derivePipelineHealth(rows, NOW);
    expect(h.level).toBe("red");
    expect(h.detail).toContain("no movement");
  });

  it("tracks the most recent land across attempt history", () => {
    const rows = buildPipelineRows(
      [pr()],
      [
        proposal({
          proposal_id: "p-m",
          status: "merged",
          updated_at: ago(30),
          merged_at: ago(30),
        }),
        proposal({
          proposal_id: "p-live",
          status: "queued",
          updated_at: ago(1),
        }),
      ]
    );
    const h = derivePipelineHealth(rows, NOW);
    expect(h.lastMergedAt).toBe(ago(30));
    // merged proposal is terminal — not part of queue depth.
    expect(h.queueDepth).toBe(1);
  });

  it("is green and empty-safe with no data", () => {
    const h = derivePipelineHealth([], NOW);
    expect(h.level).toBe("green");
    expect(h.queueDepth).toBe(0);
    expect(h.lastMergedAt).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// The health headline vs. GitHub-derived conflicts.
//
// `derivePipelineHealth` counts conflicts by scanning ACTIVE proposals. Every
// conflict GitHub reports but coord has no live proposal for is therefore
// invisible to it. `conflict-stranded` was taught to reach the headline; its
// sibling `not-mergeable` — the LOUDEST red row in the table, a hard conflict
// on a short-CI repo or one at the front of the land queue — was not, so a
// fleet of hard conflicts still rendered "Merging normally" with a green dot.
// ----------------------------------------------------------------------------
describe("derivePipelineHealth — GitHub-derived conflicts reach the headline", () => {
  /** A hard conflict with no economics: short-CI path → `not-mergeable`. */
  let hardConflictSeq = 0;
  function hardConflictRow(branch: string): PipelineRow {
    // Distinct pr_number per row: a PR is identified by repo + number, and the
    // health count dedupes on that. Reusing one number across branches would
    // make two rows claim to be the SAME PR.
    const row = buildPipelineRows(
      [pr({ branch, pr_number: 800 + hardConflictSeq++, mergeable: false })],
      []
    )[0];
    expect(row.status.kind).toBe("not-mergeable");
    return row;
  }

  it("every GITHUB_CONFLICT_KINDS member is an author-action kind", () => {
    // Guards the set against a kind being added that is not actually red —
    // the headline must never escalate on a state nobody has to act on.
    for (const kind of GITHUB_CONFLICT_KINDS) {
      expect(ATTENTION_BY_KIND[kind]).toBe("author");
    }
    // And the two conflict families stay disjoint: the de-escalated kind is
    // deliberately NOT a headline conflict (see the set's doc comment).
    expect(GITHUB_CONFLICT_KINDS.has("conflict-deferred")).toBe(false);
  });

  it("a hard conflict with no live proposal is not invisible to the headline", () => {
    const h = derivePipelineHealth([hardConflictRow("feat/a")], NOW);
    expect(h.needsAttention).toBe(1);
    expect(h.conflicted).toBe(1);
    // Visible in the detail line; NOT an escalation of pipeline state.
    expect(h.detail).toContain("1 PR needs an author rebase");
  });

  it("two hard conflicts are reported, never escalated to stuck", () => {
    const h = derivePipelineHealth(
      [hardConflictRow("feat/a"), hardConflictRow("feat/b")],
      NOW
    );
    // Was: "2 conflicts accumulating" / red / "Pipeline stuck". That banner
    // fired on 2026-07-20 while all three trains were landing and every
    // conflict was days old. Conflicts are reported, not escalated.
    expect(h.conflicted).toBe(2);
    expect(h.detail).toContain("2 PRs need an author rebase");
    // Assert the level POSITIVELY. `not.toBe("Pipeline stuck")` is satisfied by
    // "Pipeline degraded", which is still red — so a regression re-escalating
    // conflicts into redReasons would slip through whenever a land is recent.
    // Amber (not green) because these two rows are the whole fleet: nothing is
    // in the train. Never red.
    expect(h.level).toBe("amber");
  });

  it("does not double-count a PR whose conflict IS a live proposal", () => {
    // The row's kind is `conflict` (from the proposal), which is NOT in
    // GITHUB_CONFLICT_KINDS — so the active-proposal count owns it alone.
    const rows = buildPipelineRows(
      [pr({ mergeable: false })],
      [proposal({ status: "conflict" })]
    );
    expect(rows[0].status.kind).toBe("conflict");
    expect(rows[0].activeProposal).not.toBeNull();
    // One conflict, not two — the double-count guard this test exists for.
    expect(derivePipelineHealth(rows, NOW).conflicted).toBe(1);
    expect(derivePipelineHealth(rows, NOW).detail).toContain(
      "1 PR needs an author rebase"
    );
  });

  it("keeps the deliberate de-escalation: a deferred conflict stays out", () => {
    const econ: Record<string, MergeEconomics> = {
      "qontinui/qontinui-runner": {
        candidate_ci_p90_secs: 4 * 60 * 60,
        queue_depth: 12,
      },
    };
    const rows = buildPipelineRows(
      [pr({ repo: "qontinui/qontinui-runner", mergeable: false })],
      [],
      econ
    );
    expect(rows[0].status.kind).toBe("conflict-deferred");
    const h = derivePipelineHealth(rows, NOW, econ);
    expect(h.detail).not.toContain("conflict");
    expect(h.level).toBe("green");
  });
});
