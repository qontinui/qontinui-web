import { describe, it, expect } from "vitest";
import {
  buildRepoTrainRows,
  buildTrainSummary,
  effectiveMergeStatus,
  fallbackMergeStatus,
  formatDuration,
  perRepoCapHint,
  slotScopeNote,
} from "./trainActivity";
import { redactSecrets } from "./mergeTypes";
import type { PrRow, ProposalDetail, TrainHealth } from "./mergeTypes";

// A fixed clock so every age assertion is exact rather than flaky.
const NOW = Date.parse("2026-07-25T12:00:00.000Z");
const ago = (secs: number) => new Date(NOW - secs * 1000).toISOString();

function proposal(overrides: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    proposal_id: "p1",
    agent_id: "a1",
    status: "queued",
    requires_clean_ci: true,
    created_at: ago(600),
    updated_at: ago(600),
    repos: [{ repo: "qontinui/web", branch: "feat/x", head_sha: "abc" }],
    ...overrides,
  };
}

function pr(overrides: Partial<PrRow> = {}): PrRow {
  return {
    repo: "qontinui/web",
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

describe("redactSecrets", () => {
  // Verified against live coord data on 2026-07-25: merge_proposals.error
  // stores the failing clone command verbatim, credentials included.
  it("strips the token out of a coord clone-failure error", () => {
    const raw =
      "dry-rebase setup failed for synth/term: git clone " +
      "https://x-access-token:gho_0000EXAMPLEONLYNOTAREALTOKEN0000@github.com/synth/term.git " +
      "-> /root/.qontinui/coord-merge-scratch/synth/term failed: remote: Repository not found.";
    const out = redactSecrets(raw);
    expect(out).not.toContain("gho_0000EXAMPLEONLYNOTAREALTOKEN0000");
    expect(out).toContain("https://***:***@github.com/synth/term.git");
    // The diagnostic content must survive — redaction, not truncation.
    expect(out).toContain("Repository not found");
  });

  it("strips a bare token not embedded in a URL", () => {
    expect(redactSecrets("header was ghp_abcdefghij0123456789xyz")).toBe(
      "header was gh*_***"
    );
    expect(redactSecrets("token github_pat_11ABCDEFG0123456789_abcdefg")).toBe(
      "token github_pat_***"
    );
  });

  it("strips a tokenless credential URL (the other git form)", () => {
    // `https://<token>@host` carries no colon, so the userinfo regex that
    // required `user:pass@` let any non-`gh*_`-prefixed token straight through.
    const out = redactSecrets(
      "git clone https://0123456789abcdef0123456789abcdef01234567@github.com/o/r.git failed"
    );
    expect(out).not.toContain("0123456789abcdef");
    expect(out).toContain("https://***@github.com/o/r.git");
  });

  it("strips an Authorization header", () => {
    // coord's git-door push carries an agent JWT via `http.extraHeader`, and
    // the whole command lands in the error text.
    const out = redactSecrets(
      "git -c http.extraHeader='Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def' push failed"
    );
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).toContain("Bearer ***");
  });

  it("leaves ordinary prose alone", () => {
    // The unanchored rule mangled coord's own error text: "token
    // authentication failed" and "basic reachability check failed" both
    // contain a keyword followed by a long word. Redaction, not truncation.
    for (const prose of [
      "token authentication failed for user bob",
      "basic reachability check failed after 3 attempts",
      "bearer of this proposal is unknown, investigating",
    ]) {
      expect(redactSecrets(prose)).toBe(prose);
    }
  });

  it("still strips credential-shaped token flags", () => {
    // The fixture values keep the `EXAMPLE-TOKEN` prefix ON PURPOSE. They have
    // to be credential-SHAPED to exercise the rule, which means gitleaks'
    // `generic-api-key` detector matches them too — an opaque-looking value
    // after a `token=` assignment failed the secret scan on this very PR. The
    // repo's .gitleaks.toml already allowlists
    // `(example|dummy|test|…)[-_]?(token|secret|key)`, so naming them this way
    // keeps the scan honest for everyone else instead of widening the config
    // for us. Do not "tidy" the prefix away — and do not quote a real-shaped
    // example in this comment, which trips the scanner just as readily.
    expect(redactSecrets("--token EXAMPLE-TOKEN-VALUE-0001 failed")).toBe(
      "--token *** failed"
    );
    expect(redactSecrets("token=EXAMPLE-TOKEN-VALUE-0001")).toBe("token=***");
  });

  it("passes through clean text and nullish values unchanged", () => {
    expect(redactSecrets("candidate CI: failure,failure")).toBe(
      "candidate CI: failure,failure"
    );
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(undefined)).toBeUndefined();
  });
});

describe("formatDuration", () => {
  it("renders compact units and a dash for unknown", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(3 * 3600)).toBe("3h");
    expect(formatDuration(50 * 3600)).toBe("2d");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("fallbackMergeStatus", () => {
  // coord only emits merge_status from 2026-06-18; an older deploy sends
  // nothing and the tab must still classify rather than render "unknown".
  it("mirrors the classifier's precedence on raw PrRow signals", () => {
    expect(fallbackMergeStatus(pr({ pr_state: "draft" }))).toBe("draft");
    expect(fallbackMergeStatus(pr({ ci_conclusion: "failure" }))).toBe(
      "ci-failed"
    );
    expect(fallbackMergeStatus(pr({ ci_lifecycle: "pending" }))).toBe(
      "ci-pending"
    );
    expect(fallbackMergeStatus(pr({ merge_state_status: "DIRTY" }))).toBe(
      "conflicts"
    );
    expect(fallbackMergeStatus(pr({ merge_state_status: "BEHIND" }))).toBe(
      "behind-base"
    );
    expect(
      fallbackMergeStatus(pr({ review_decision: "REVIEW_REQUIRED" }))
    ).toBe("review-required");
    expect(fallbackMergeStatus(pr())).toBe("ready-but-unlanded");
  });

  // The arm this exercises used to share `review-required` with the review
  // decision above, so a PR blocked purely on CI was labelled with a human's
  // name. The `pr()` baseline is otherwise clean and green, so nothing earlier
  // in the cascade can absorb these cases.
  it("separates an unsatisfied required check from a review block", () => {
    expect(fallbackMergeStatus(pr({ required_checks_satisfied: false }))).toBe(
      "required-checks-missing"
    );
    // Both true: review wins — a human is the longer pole.
    expect(
      fallbackMergeStatus(
        pr({
          review_decision: "REVIEW_REQUIRED",
          required_checks_satisfied: false,
        })
      )
    ).toBe("review-required");
    // `null` is "coord could not prove it" (no rollup, no required contexts
    // published, or a truncated page), NOT "unsatisfied". It must fall through
    // to the later arms, or every PR on a repo with no required contexts reads
    // as permanently blocked.
    expect(fallbackMergeStatus(pr({ required_checks_satisfied: null }))).toBe(
      "ready-but-unlanded"
    );
  });

  it("prefers coord's own verdict when present", () => {
    expect(
      effectiveMergeStatus(pr({ merge_status: "blast-radius-block" }))
    ).toBe("blast-radius-block");
    // Draft would win the fallback, but coord's token is authoritative.
    expect(
      effectiveMergeStatus(pr({ pr_state: "draft", merge_status: "ci-failed" }))
    ).toBe("ci-failed");
  });
});

describe("buildRepoTrainRows — current activity", () => {
  it("reports the most-advanced in-flight phase and its dwell", () => {
    const rows = buildRepoTrainRows(
      [
        proposal({
          proposal_id: "p-land",
          status: "landing",
          updated_at: ago(120),
        }),
        proposal({ proposal_id: "p-q", status: "queued", updated_at: ago(30) }),
      ],
      [],
      null,
      NOW
    );
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.activity.kind).toBe("landing");
    expect(row.activity.proposalId).toBe("p-land");
    expect(row.activity.dwellSecs).toBe(120);
    // The queued sibling is reported as waiting behind the driver.
    expect(row.activity.behind).toBe(1);
    expect(row.inFlightCount).toBe(2);
  });

  it("treats conflict and shadow-landed as PARKED, never as activity", () => {
    // `/merge/queue` returns everything that is not merged/cancelled, so these
    // accumulate for weeks — a live coord had 76 such rows.
    const rows = buildRepoTrainRows(
      [
        proposal({ status: "conflict", error: "boom", updated_at: ago(86400) }),
        proposal({ proposal_id: "p2", status: "shadow-landed" }),
      ],
      [],
      null,
      NOW
    );
    const row = rows[0]!;
    expect(row.activity.kind).toBe("idle");
    expect(row.inFlightCount).toBe(0);
    expect(row.conflictCount).toBe(1);
    // Parked still counts as the last time the train touched this repo.
    expect(row.lastActivityAt).not.toBeNull();
  });

  it("names the overlapping files that serialized a proposal", () => {
    const rows = buildRepoTrainRows(
      [
        proposal({
          status: "blocked-by-overlap",
          repos: [
            {
              repo: "qontinui/web",
              branch: "feat/x",
              head_sha: "abc",
              overlap_paths: ["src/a.ts", "src/b.ts"],
            },
          ],
        }),
      ],
      [],
      null,
      NOW
    );
    const row = rows[0]!;
    expect(row.activity.kind).toBe("blocked-by-overlap");
    expect(row.activity.detail).toContain("src/a.ts");
    expect(row.activity.overlapPaths).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("redacts credentials out of the surfaced proposal error", () => {
    const rows = buildRepoTrainRows(
      [
        proposal({
          status: "conflict",
          error:
            "git clone https://x-access-token:gho_AAAAAAAAAAAAAAAAAAAA@github.com/o/r.git failed",
        }),
      ],
      [],
      null,
      NOW
    );
    expect(rows[0]!.lastError).not.toContain("gho_AAAAAAAAAAAAAAAAAAAA");
    expect(rows[0]!.lastError).toContain("***:***@github.com");
  });
});

describe("buildRepoTrainRows — why it is paused", () => {
  it("ranks the orchestrator stall above ordinary CI waits", () => {
    const health: TrainHealth = {
      ready_unmerged: {
        count: 1,
        max_age_seconds: 5400,
        prs: [{ repo: "qontinui/web", pr_number: 7, age_seconds: 5400 }],
      },
    };
    const rows = buildRepoTrainRows(
      [],
      [
        pr({ pr_number: 7 }),
        pr({ pr_number: 8, ci_lifecycle: "pending", ci_conclusion: null }),
      ],
      health,
      NOW
    );
    const row = rows[0]!;
    expect(row.reasons[0]!.code).toBe("orchestrator-stalled");
    expect(row.reasons[0]!.oldestSecs).toBe(5400);
    expect(row.severity).toBe("blocking");
    // The health-derived stall replaces the generic per-PR bucket rather than
    // double-reporting the same PR.
    expect(
      row.reasons.filter((r) => r.code === "orchestrator-stalled")
    ).toHaveLength(1);
    expect(row.reasons.map((r) => r.code)).toContain("ci-pending");
  });

  it("says so explicitly when nothing is in flight — coord is at fault", () => {
    const health: TrainHealth = {
      ready_unmerged: {
        count: 1,
        prs: [{ repo: "qontinui/web", pr_number: 7, age_seconds: 100 }],
      },
    };
    const rows = buildRepoTrainRows([], [pr({ pr_number: 7 })], health, NOW);
    expect(rows[0]!.reasons[0]!.detail).toContain("NO proposal is in flight");
  });

  it("attributes the stall to slot contention when a proposal IS in flight", () => {
    const health: TrainHealth = {
      ready_unmerged: {
        count: 1,
        prs: [{ repo: "qontinui/web", pr_number: 7, age_seconds: 100 }],
      },
    };
    const rows = buildRepoTrainRows(
      [proposal({ status: "awaiting-ci" })],
      [pr({ pr_number: 7 })],
      health,
      NOW
    );
    expect(rows[0]!.reasons[0]!.detail).toContain("slot contention");
  });

  it("promotes a day-old conflict to a strand", () => {
    const rows = buildRepoTrainRows(
      [],
      [
        pr({
          pr_number: 9,
          merge_status: "conflicts",
          conflict_age_secs: 3 * 86400,
        }),
      ],
      null,
      NOW
    );
    const codes = rows[0]!.reasons.map((r) => r.code);
    expect(codes).toContain("conflict-strand");
    expect(codes).not.toContain("conflicts");
  });

  it("leaves a fresh conflict as an ordinary conflict", () => {
    const rows = buildRepoTrainRows(
      [],
      [pr({ pr_number: 9, merge_status: "conflicts", conflict_age_secs: 600 })],
      null,
      NOW
    );
    expect(rows[0]!.reasons.map((r) => r.code)).toContain("conflicts");
  });

  it("treats absent conflict_age_secs as no evidence, not as not-stranded", () => {
    const rows = buildRepoTrainRows(
      [],
      [pr({ pr_number: 9, merge_status: "conflicts" })],
      null,
      NOW
    );
    const conflict = rows[0]!.reasons.find((r) => r.code === "conflicts");
    expect(conflict).toBeDefined();
    expect(conflict!.oldestSecs).toBeNull();
  });

  it("flags a merge-suppressed repo even with no PRs and no proposals", () => {
    // `dry_run` is coord's LEGACY wire key for "judged landable, not pushed";
    // the reason it raises must describe merge enablement, not the retired
    // tri-state whose controls no longer exist anywhere in the dashboard.
    const rows = buildRepoTrainRows([], [], {
      dry_run: { would_merge_blocked_by_dry_run: 2, repos: ["qontinui/web"] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.frozenDryRun).toBe(true);
    const reason = rows[0]!.reasons[0]!;
    expect(reason.code).toBe("dry-run-freeze");
    expect(reason.label).toBe("Merges suppressed");
    expect(reason.detail).not.toMatch(/rollout_state|dry.?run|set to live/i);
  });

  it("does not treat train-accepted PRs as a pause", () => {
    // `ready` / `queued` mean coord HAS the PR — progress, not a stall.
    const rows = buildRepoTrainRows(
      [proposal({ status: "awaiting-ci" })],
      [pr({ pr_number: 3, merge_status: "queued" })],
      null,
      NOW
    );
    expect(rows[0]!.reasons).toHaveLength(0);
  });

  it("reports no-candidates for an idle repo whose PRs are all draft", () => {
    const rows = buildRepoTrainRows(
      [],
      [pr({ pr_number: 4, pr_state: "draft" })],
      null,
      NOW
    );
    const codes = rows[0]!.reasons.map((r) => r.code);
    expect(codes).toContain("draft");
    expect(rows[0]!.severity).toBe("info");
  });

  it("ignores merged and closed PR rows", () => {
    const rows = buildRepoTrainRows(
      [],
      [
        pr({ pr_number: 5, pr_state: "merged" }),
        pr({ pr_number: 6, pr_state: "closed" }),
      ],
      null,
      NOW
    );
    expect(rows).toHaveLength(0);
  });
});

describe("buildRepoTrainRows — ordering", () => {
  it("puts active repos first, then blocking, then waiting", () => {
    const rows = buildRepoTrainRows(
      [
        proposal({
          proposal_id: "act",
          status: "landing",
          repos: [{ repo: "org/active", branch: "b", head_sha: "s" }],
        }),
      ],
      [
        pr({
          repo: "org/waiting",
          pr_number: 1,
          ci_lifecycle: "pending",
          ci_conclusion: null,
        }),
        pr({ repo: "org/blocked", pr_number: 2, ci_conclusion: "failure" }),
      ],
      null,
      NOW
    );
    expect(rows.map((r) => r.repo)).toEqual([
      "org/active",
      "org/blocked",
      "org/waiting",
    ]);
  });
});

describe("regressions found in review", () => {
  it("does not accuse the orchestrator of stalling on a PR it is working", () => {
    // The bug: with no coord `merge_status` (deploys before 2026-06-18),
    // fallbackMergeStatus returned `ready-but-unlanded` for every green PR,
    // so a row read "Candidate CI running" AND "coord failed to take this PR"
    // at once. The proposal is matched on (repo, head_sha) — coord's own key.
    const rows = buildRepoTrainRows(
      [
        proposal({
          status: "awaiting-ci",
          repos: [
            { repo: "qontinui/web", branch: "feat/x", head_sha: "HEAD1" },
          ],
        }),
      ],
      [pr({ pr_number: 3, head_sha: "HEAD1" })],
      null,
      NOW
    );
    expect(rows[0]!.activity.kind).toBe("awaiting-ci");
    expect(rows[0]!.reasons.map((r) => r.code)).not.toContain(
      "orchestrator-stalled"
    );
  });

  it("still flags a stall when no proposal exists at the PR's head", () => {
    // The other half: a green PR whose head has NO proposal genuinely is the
    // orchestrator-stalled case, and a force-push (new head) must re-expose it.
    const rows = buildRepoTrainRows(
      [
        proposal({
          status: "awaiting-ci",
          repos: [{ repo: "qontinui/web", branch: "feat/x", head_sha: "OLD" }],
        }),
      ],
      [pr({ pr_number: 3, head_sha: "NEWHEAD" })],
      null,
      NOW
    );
    expect(rows[0]!.reasons.map((r) => r.code)).toContain(
      "orchestrator-stalled"
    );
  });

  it("prefers coord's own proposal_status over the queue reconstruction", () => {
    const rows = buildRepoTrainRows(
      [],
      [
        pr({
          pr_number: 3,
          proposal_status: "queued",
          proposal_age_secs: 120,
        }),
      ],
      null,
      NOW
    );
    // Fresh `queued` proposal ⇒ coord accepted it ⇒ progress, not a pause.
    expect(rows[0]!.reasons.map((r) => r.code)).not.toContain(
      "orchestrator-stalled"
    );
  });

  it("does not treat an unknown proposal age as fresh", () => {
    // coord's gate is `(Some(status), Some(age)) => … , _ => false`. "We can't
    // tell if it is stale" must not read as "it is fresh".
    const rows = buildRepoTrainRows(
      [],
      [pr({ pr_number: 3, proposal_status: "queued" })],
      null,
      NOW
    );
    expect(rows[0]!.reasons.map((r) => r.code)).toContain(
      "orchestrator-stalled"
    );
  });

  it("flags a proposal wedged past the landed timeout as a stall", () => {
    // The false NEGATIVE the first fix introduced: a proposal stuck in
    // `awaiting-ci` for days (lost check-run webhooks, phantom required
    // contexts) rendered as "Candidate CI for 3d" with no reason and no colour.
    // coord calls anything older than PER_PR_LANDED_TIMEOUT (30m) stale.
    const rows = buildRepoTrainRows(
      [
        proposal({
          status: "awaiting-ci",
          created_at: ago(3 * 86400),
          updated_at: ago(3 * 86400),
          repos: [{ repo: "qontinui/web", branch: "b", head_sha: "H" }],
        }),
      ],
      [pr({ pr_number: 3, head_sha: "H" })],
      null,
      NOW
    );
    expect(rows[0]!.activity.kind).toBe("awaiting-ci");
    expect(rows[0]!.reasons.map((r) => r.code)).toContain(
      "orchestrator-stalled"
    );
    expect(rows[0]!.severity).toBe("blocking");
  });

  it("does not treat a failed-candidate-CI proposal as in-train", () => {
    // `conflict` is not one of coord's in-flight statuses. Treating any
    // non-null status as in-flight made a green PR whose candidate CI failed
    // read as "nothing to do".
    const rows = buildRepoTrainRows(
      [],
      [
        pr({
          pr_number: 3,
          proposal_status: "conflict",
          proposal_age_secs: 60,
        }),
      ],
      null,
      NOW
    );
    expect(rows[0]!.reasons.map((r) => r.code)).toContain(
      "orchestrator-stalled"
    );
    expect(rows[0]!.reasons.map((r) => r.code)).not.toContain("no-candidates");
  });

  it("keeps a repo visible when coord reports a status we do not know", () => {
    // `ProposalStatus` is coord's enum. An unrecognised non-terminal status
    // must not drop the leg and silently erase the whole repo from the board.
    const rows = buildRepoTrainRows(
      [proposal({ status: "some-future-phase" as never })],
      [],
      null,
      NOW
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.activity.kind).toBe("some-future-phase");
    expect(rows[0]!.inFlightCount).toBe(1);
  });

  it("still explains a PR whose merge_status we do not recognise", () => {
    // `STATUS_TO_REASON` is keyed on bare `string` and explicitly partial, so
    // a coord newer than this bundle emits tokens the map has no row for.
    // Dropping those PRs made them VANISH from the breakdown — a train visibly
    // stalled with no reason stated at all. `MergeStatusToken` silently lacked
    // `repo-unreachable` for over a month without a build error, so the
    // compiler is not the net here; this fallback is.
    const rows = buildRepoTrainRows(
      [],
      [pr({ pr_number: 9, merge_status: "some-future-token" })],
      null,
      NOW
    );
    const reason = rows[0]!.reasons.find(
      (r) => r.code === "unrecognized-status"
    )!;
    expect(reason).toBeDefined();
    expect(reason.prNumbers).toEqual([9]);
    expect(reason.prCount).toBe(1);
    expect(reason.severity).toBe("blocking");
    // The label is derived from the raw token — all the meaning we have.
    expect(reason.label).toBe("Some future token");
    expect(reason.detail).toContain("some-future-token");
  });

  it("does not invent a pause reason for train-accepted PRs", () => {
    // `ready`/`queued` are absent from `STATUS_TO_REASON` DELIBERATELY (they
    // are progress). The unrecognised-token fallback must not sweep them up.
    const rows = buildRepoTrainRows(
      [],
      [
        pr({ pr_number: 10, merge_status: "ready" }),
        pr({ pr_number: 11, merge_status: "queued" }),
      ],
      null,
      NOW
    );
    expect(rows[0]!.reasons.map((r) => r.code)).not.toContain(
      "unrecognized-status"
    );
  });

  it("reports an unsatisfied required check without naming a reviewer", () => {
    const rows = buildRepoTrainRows(
      [],
      [pr({ pr_number: 12, merge_status: "required-checks-missing" })],
      null,
      NOW
    );
    const reason = rows[0]!.reasons.find(
      (r) => r.code === "required-checks-missing"
    )!;
    expect(reason).toBeDefined();
    expect(reason.label).toBe("Required checks missing");
    // A surviving `required_checks_satisfied === false` is a genuine block per
    // coord's own post-reconciliation invariant, so this is not a `waiting`.
    expect(reason.severity).toBe("blocking");
    expect(reason.detail).toContain("No review is required");
    expect(reason.prNumbers).toEqual([12]);
  });

  it("does not report a hydration timestamp as a blocked-for age", () => {
    // `last_refreshed_at` is when coord re-read the row (minutes), not how
    // long CI has been red (days). No age beats a wrong age.
    const rows = buildRepoTrainRows(
      [],
      [
        pr({
          pr_number: 4,
          ci_conclusion: "failure",
          last_refreshed_at: ago(240),
        }),
      ],
      null,
      NOW
    );
    const red = rows[0]!.reasons.find((r) => r.code === "ci-failed")!;
    expect(red.oldestSecs).toBeNull();
  });

  it("admits ignorance when coord reports no conflict age", () => {
    const rows = buildRepoTrainRows(
      [],
      [pr({ pr_number: 9, merge_status: "conflicts" })],
      null,
      NOW
    );
    const c = rows[0]!.reasons.find((r) => r.code === "conflicts")!;
    expect(c.detail).toMatch(/may be stranded/i);
  });

  it("orders proposals chronologically, not lexicographically", () => {
    // chrono's RFC3339 output has variable fractional-second width, so
    // `…59.999500Z` sorts BEFORE `…59.999Z` as a string. The later proposal
    // must still win the driver tie-break.
    const rows = buildRepoTrainRows(
      [
        proposal({
          proposal_id: "older",
          status: "awaiting-ci",
          updated_at: "2026-07-25T11:59:59.999Z",
        }),
        proposal({
          proposal_id: "newer",
          status: "awaiting-ci",
          updated_at: "2026-07-25T12:00:00.500100Z",
        }),
      ],
      [],
      Date.parse("2026-07-25T12:30:00Z")
    );
    expect(rows[0]!.activity.proposalId).toBe("newer");
  });

  it("does not let an empty error string suppress the real one", () => {
    const rows = buildRepoTrainRows(
      [proposal({ status: "conflict", error: "", updated_at: ago(10) })],
      [],
      {
        ready_unmerged: {
          count: 1,
          prs: [
            {
              repo: "qontinui/web",
              pr_number: 1,
              latest_proposal_error: "candidate CI: failure,failure",
            },
          ],
        },
      },
      NOW
    );
    expect(rows[0]!.lastError).toBe("candidate CI: failure,failure");
  });
});

describe("slot-cap saturation", () => {
  const slots = (over: Partial<NonNullable<TrainHealth["slots"]>> = {}) => ({
    configured_cap: 3,
    effective_cap: 3,
    dynamic: false,
    online_ci_runners: null,
    occupied: 3,
    available: 0,
    saturated: true,
    queued_depth: 4,
    oldest_queued_wait_seconds: 2400,
    per_repo_cap: 2,
    repos: [],
    repos_at_cap: [],
    ...over,
  });

  it("explains a long gap as a capacity limit, not a fault", () => {
    const s = buildTrainSummary({ slots: slots() }, [], NOW);
    const b = s.banners.find((x) => x.code === "slots-saturated");
    expect(b?.detail).toContain("3/3 slots occupied");
    expect(b?.detail).toContain("oldest waiting 40m");
    expect(b?.detail).toContain("not a fault");
    // A 40-minute wait is a throughput ceiling worth acting on.
    expect(b?.severity).toBe("blocking");
  });

  it("does not alarm when the queue drains quickly", () => {
    const s = buildTrainSummary(
      { slots: slots({ oldest_queued_wait_seconds: 20 }) },
      [],
      NOW
    );
    expect(s.banners.find((x) => x.code === "slots-saturated")?.severity).toBe(
      "waiting"
    );
  });

  it("stays silent when every slot is busy but nothing is waiting", () => {
    // Full throughput is not a stall; alarming here trains the eye to ignore
    // the banner.
    const s = buildTrainSummary(
      { slots: slots({ queued_depth: 0, oldest_queued_wait_seconds: null }) },
      [],
      NOW
    );
    expect(s.banners.map((b) => b.code)).not.toContain("slots-saturated");
  });

  it("flags a collapsed dynamic cap as a total halt", () => {
    const s = buildTrainSummary(
      {
        slots: slots({
          dynamic: true,
          effective_cap: 0,
          occupied: 0,
          online_ci_runners: 0,
        }),
      },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "no-ci-runners");
    expect(b?.severity).toBe("blocking");
    expect(b?.detail).toContain("cannot dispatch anything");
  });

  it("surfaces the free-slots-but-starved case", () => {
    // The case operators misread as "coord is broken".
    const s = buildTrainSummary(
      {
        slots: slots({
          occupied: 2,
          available: 1,
          saturated: false,
          repos_at_cap: ["qontinui/qontinui-runner"],
        }),
      },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "repo-cap-starved");
    expect(b?.detail).toContain("1 slot is free");
    expect(b?.detail).toContain("qontinui-runner");
    expect(b?.detail).toContain("by design");
  });

  it("names the per-repo cap as the reason on the starved repo's row", () => {
    const rows = buildRepoTrainRows(
      [],
      [],
      {
        slots: slots({
          occupied: 2,
          available: 1,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 2,
              queued: 3,
              at_repo_cap: true,
              oldest_queued_wait_seconds: 900,
            },
          ],
          repos_at_cap: ["qontinui/web"],
        }),
      },
      NOW
    );
    const row = rows[0]!;
    expect(row.reasons[0]!.code).toBe("repo-cap-starved");
    expect(row.reasons[0]!.detail).toContain("COORD_MERGE_PER_REPO_CAP=2");
    expect(row.reasons[0]!.detail).toContain("1 global slot is free");
    expect(row.reasons[0]!.oldestSecs).toBe(900);
  });

  it("distinguishes a global slot wait from a per-repo skip", () => {
    const rows = buildRepoTrainRows(
      [],
      [],
      {
        slots: slots({
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 1,
              queued: 2,
              at_repo_cap: false,
              oldest_queued_wait_seconds: 600,
            },
          ],
        }),
      },
      NOW
    );
    expect(rows[0]!.reasons[0]!.code).toBe("slots-saturated");
    expect(rows[0]!.reasons[0]!.detail).toContain("All 3 global merge slots");
  });

  it("gives a queued proposal the actual constraint, not just 'waiting'", () => {
    const rows = buildRepoTrainRows(
      [proposal({ status: "queued" })],
      [],
      {
        slots: slots({
          occupied: 2,
          available: 1,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 2,
              queued: 1,
              at_repo_cap: true,
            },
          ],
          repos_at_cap: ["qontinui/web"],
        }),
      },
      NOW
    );
    expect(rows[0]!.activity.kind).toBe("queued");
    expect(rows[0]!.activity.detail).toContain("per-repo cap (2/2 in flight)");
    expect(rows[0]!.activity.detail).toContain("1 free global slot");
  });

  // --- A2 candidate-CI distress narrowing (coord #1550 / #1614). ----------
  // `at_repo_cap` and `repos_at_cap` are derived by coord against each repo's
  // EFFECTIVE cap, which A2 temporarily reduces while a repo's candidate CI
  // keeps failing. Quoting `per_repo_cap` beside them states a threshold the
  // dequeue is not applying AND names the wrong remedy, so every site that
  // prints a per-repo cap must read `narrowed_repo_cap` first.

  it("quotes the narrowed cap, not the configured one, on a queued proposal", () => {
    const rows = buildRepoTrainRows(
      [proposal({ status: "queued" })],
      [],
      {
        slots: slots({
          occupied: 1,
          available: 2,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 1,
              queued: 3,
              at_repo_cap: true,
              narrowed_repo_cap: 1,
            },
          ],
          repos_at_cap: ["qontinui/web"],
        }),
      },
      NOW
    );
    const detail = rows[0]!.activity.detail;
    // The pre-fix bug printed "(1/2 in flight)" — a pair that cannot both be
    // true, since at_repo_cap was derived against 1.
    expect(detail).toContain("per-repo cap (1/1 in flight)");
    expect(detail).not.toContain("1/2 in flight");
    expect(detail).toContain("TEMPORARILY narrowed from 2");
    expect(detail).toContain("candidate CI");
  });

  it("names candidate CI, not the fairness filter, as the hold on a narrowed repo", () => {
    const rows = buildRepoTrainRows(
      [],
      [],
      {
        slots: slots({
          occupied: 1,
          available: 2,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 1,
              queued: 4,
              at_repo_cap: true,
              narrowed_repo_cap: 1,
              oldest_queued_wait_seconds: 900,
            },
          ],
          repos_at_cap: ["qontinui/web"],
        }),
      },
      NOW
    );
    const reason = rows[0]!.reasons[0]!;
    expect(reason.code).toBe("repo-cap-starved");
    expect(reason.label).toBe("At narrowed per-repo cap");
    expect(reason.detail).toContain("narrowed from COORD_MERGE_PER_REPO_CAP=2");
    expect(reason.detail).toContain("until its candidate CI recovers");
    // The remedy must NOT be "wait for one to finish", and the fairness filter
    // must not be credited for an A2 hold.
    expect(reason.detail).not.toContain("until one finishes");
    expect(reason.detail).not.toContain("fairness filter working as designed");
  });

  it("explains a narrowed repo in the fleet banner", () => {
    const s = buildTrainSummary(
      {
        slots: slots({
          occupied: 1,
          available: 2,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 1,
              queued: 4,
              at_repo_cap: true,
              narrowed_repo_cap: 1,
            },
          ],
          repos_at_cap: ["qontinui/web"],
        }),
      },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "repo-cap-starved");
    expect(b?.detail).toContain("narrowed cap of 1");
    expect(b?.detail).toContain("candidate CI");
    expect(b?.detail).not.toContain("COORD_MERGE_PER_REPO_CAP=2");
    expect(b?.detail).not.toContain("by design");
  });

  it("leaves an un-narrowed repo's prose byte-identical", () => {
    // A term that is narrowing nothing must change nothing, prose included.
    const rows = buildRepoTrainRows(
      [proposal({ status: "queued" })],
      [],
      {
        slots: slots({
          occupied: 2,
          available: 1,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 2,
              queued: 1,
              at_repo_cap: true,
            },
          ],
          repos_at_cap: ["qontinui/web"],
        }),
      },
      NOW
    );
    expect(rows[0]!.activity.detail).toContain("per-repo cap (2/2 in flight)");
    expect(rows[0]!.activity.detail).not.toContain("TEMPORARILY narrowed");
    expect(rows[0]!.reasons[0]!.label).toBe("At per-repo cap");
    expect(rows[0]!.reasons[0]!.detail).toContain("COORD_MERGE_PER_REPO_CAP=2");
    expect(rows[0]!.reasons[0]!.detail).toContain("until one finishes");
  });

  // --- The FLEET readout of the per-repo cap (the fourth render site). ------
  // The Slots stat's hint prints a per-repo cap too. It was not reached by the
  // narrowing fix above, whose grep stayed inside this module and never opened
  // `MergeTrainActivity.tsx` — the same too-narrow-grep miss that left this
  // whole family of sites wrong in the first place.

  it("prints the plain configured per-repo cap when nothing is narrowed", () => {
    expect(perRepoCapHint(slots())).toBe("per-repo cap 2");
  });

  it("names the narrowed repo in the fleet per-repo cap hint", () => {
    const hint = perRepoCapHint(
      slots({
        repos: [
          {
            repo: "qontinui/web",
            in_flight: 1,
            queued: 3,
            at_repo_cap: true,
            narrowed_repo_cap: 1,
          },
        ],
      })
    );
    // "per-repo cap 2" alone contradicts the "1/1 in flight" the row below
    // prints for the same repo; the operator must not have to guess which is
    // the number the dequeue is applying.
    expect(hint).toContain("web is held at 1");
    expect(hint).toContain("candidate CI");
  });

  it("counts, rather than lists, several narrowed repos", () => {
    const hint = perRepoCapHint(
      slots({
        repos: [
          {
            repo: "qontinui/web",
            in_flight: 1,
            queued: 3,
            at_repo_cap: true,
            narrowed_repo_cap: 1,
          },
          {
            repo: "qontinui/qontinui-runner",
            in_flight: 1,
            queued: 2,
            at_repo_cap: true,
            narrowed_repo_cap: 1,
          },
        ],
      })
    );
    expect(hint).toContain("2 repos are held below it");
  });

  it("ignores a narrowed_repo_cap that is not actually narrower", () => {
    // coord omits the key rather than echoing the configured cap, so a value
    // equal to it means a producer that stopped honouring that — and it must
    // not be announced as a narrowing.
    const hint = perRepoCapHint(
      slots({
        repos: [
          {
            repo: "qontinui/web",
            in_flight: 1,
            queued: 3,
            at_repo_cap: true,
            narrowed_repo_cap: 2,
          },
        ],
      })
    );
    expect(hint).toBe("per-repo cap 2");
  });

  // --- queued_blocked_by_cap: the partial case `at_repo_cap` cannot state. ---
  // coord scopes `at_repo_cap` to the HEAD of a repo's queue. A repo whose head
  // is admitted while proposals behind it are skipped by the same cap reports
  // `at_repo_cap: false`, and every cap explanation above keys off that flag —
  // so the console said nothing at all about the cap for those proposals.

  it("explains queued proposals held behind a cap the repo is not AT", () => {
    const rows = buildRepoTrainRows(
      [],
      [],
      {
        slots: slots({
          occupied: 1,
          available: 2,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 1,
              queued: 4,
              at_repo_cap: false,
              queued_blocked_by_cap: 3,
              oldest_queued_wait_seconds: 900,
            },
          ],
          repos_at_cap: [],
        }),
      },
      NOW
    );
    const r = rows[0]!.reasons.find(
      (x) => x.code === "queued-behind-repo-cap"
    )!;
    expect(r).toBeDefined();
    expect(r.label).toBe("Queued behind the per-repo cap");
    expect(r.detail).toContain("3 of its 4 queued proposals");
    expect(r.detail).toContain("COORD_MERGE_PER_REPO_CAP=2");
    // The point of the reason: free slots are not the remedy.
    expect(r.detail).toContain("Freeing a global slot does NOT release them");
    expect(r.prCount).toBe(3);
    expect(r.oldestSecs).toBe(900);
  });

  it("does not repeat itself on a repo that IS at its cap", () => {
    // `repo-cap-starved` already tells the whole story there; two reasons for
    // one cause is how a reason list stops being read.
    const rows = buildRepoTrainRows(
      [],
      [],
      {
        slots: slots({
          occupied: 2,
          available: 1,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 2,
              queued: 3,
              at_repo_cap: true,
              queued_blocked_by_cap: 3,
            },
          ],
          repos_at_cap: ["qontinui/web"],
        }),
      },
      NOW
    );
    const codes = rows[0]!.reasons.map((r) => r.code);
    expect(codes).toContain("repo-cap-starved");
    expect(codes).not.toContain("queued-behind-repo-cap");
  });

  it("names the narrowed cap for proposals held behind it", () => {
    const rows = buildRepoTrainRows(
      [],
      [],
      {
        slots: slots({
          occupied: 1,
          available: 2,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 0,
              queued: 4,
              at_repo_cap: false,
              queued_blocked_by_cap: 3,
              narrowed_repo_cap: 1,
            },
          ],
          repos_at_cap: [],
        }),
      },
      NOW
    );
    const r = rows[0]!.reasons.find(
      (x) => x.code === "queued-behind-repo-cap"
    )!;
    expect(r.label).toBe("Queued behind a narrowed per-repo cap");
    expect(r.detail).toContain("narrowed from COORD_MERGE_PER_REPO_CAP=2");
    // A narrowed cap does not widen when in-flight work finishes.
    expect(r.detail).toContain("candidate CI recovers");
  });

  it("adds the cap reason ALONGSIDE a slot wait, not instead of it", () => {
    // Both are true at once, and they have different remedies: a freed slot
    // releases the head, the repo's own cap still skips the rest.
    const rows = buildRepoTrainRows(
      [],
      [],
      {
        slots: slots({
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 1,
              queued: 4,
              at_repo_cap: false,
              queued_blocked_by_cap: 3,
            },
          ],
        }),
      },
      NOW
    );
    const codes = rows[0]!.reasons.map((r) => r.code);
    expect(codes).toContain("slots-saturated");
    expect(codes).toContain("queued-behind-repo-cap");
    // The total stop outranks the partial one.
    expect(codes.indexOf("slots-saturated")).toBeLessThan(
      codes.indexOf("queued-behind-repo-cap")
    );
  });

  it("stays silent when coord omits queued_blocked_by_cap", () => {
    // An older coord does not send the field. Absence is an old producer, and
    // must not be rendered as a cap claim either way.
    const rows = buildRepoTrainRows(
      [],
      [],
      {
        slots: slots({
          occupied: 1,
          available: 2,
          saturated: false,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 1,
              queued: 4,
              at_repo_cap: false,
            },
          ],
          repos_at_cap: [],
        }),
      },
      NOW
    );
    expect(rows[0]!.reasons.map((r) => r.code)).not.toContain(
      "queued-behind-repo-cap"
    );
  });

  it("shows a starved repo even when it has no in-flight leg or PR row", () => {
    // A repo with only queued proposals is exactly the starved case; it must
    // not vanish from the board for lack of another signal.
    const rows = buildRepoTrainRows([], [], {
      slots: slots({
        repos: [
          { repo: "org/starved", in_flight: 0, queued: 5, at_repo_cap: false },
        ],
      }),
    });
    expect(rows.map((r) => r.repo)).toContain("org/starved");
  });

  it("still reports a slot wait when coord omits the per-repo breakdown", () => {
    // `slots.repos` is optional. Keying the reason off it alone made a
    // saturated fleet read as "this repo has nothing waiting" — the queued
    // legs are already in hand from the merge queue.
    const rows = buildRepoTrainRows(
      [
        proposal({ status: "queued" }),
        proposal({ proposal_id: "q2", status: "queued" }),
      ],
      [],
      { slots: slots({ repos: undefined, repos_at_cap: undefined }) },
      NOW
    );
    const r = rows[0]!.reasons.find((x) => x.code === "slots-saturated");
    expect(r).toBeDefined();
    expect(r!.prCount).toBe(2);
  });

  it("derives the at-cap banner from repos[] when the summary list is absent", () => {
    // Both fields are optional; a deploy sending only one must not give half
    // the signal.
    const s = buildTrainSummary(
      {
        slots: slots({
          occupied: 2,
          available: 1,
          saturated: false,
          repos_at_cap: undefined,
          repos: [
            {
              repo: "qontinui/web",
              in_flight: 2,
              queued: 3,
              at_repo_cap: true,
            },
          ],
        }),
      },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "repo-cap-starved");
    expect(b?.detail).toContain("web");
  });

  it("merges the ready-unmerged bucket rather than replacing it", () => {
    // coord's ready_unmerged is tenant-scoped and can be narrower than the
    // locally-derived bucket; the extra PRs must not vanish from the reasons.
    const rows = buildRepoTrainRows(
      [],
      [pr({ pr_number: 1 }), pr({ pr_number: 2 })],
      {
        ready_unmerged: {
          count: 1,
          prs: [{ repo: "qontinui/web", pr_number: 1, age_seconds: 900 }],
        },
      },
      NOW
    );
    const stalls = rows[0]!.reasons.filter(
      (r) => r.code === "orchestrator-stalled"
    );
    const covered = stalls.flatMap((r) => r.prNumbers);
    expect(covered).toContain(1);
    expect(covered).toContain(2);
  });

  it("treats absent slot data as unknown, never as not-saturated", () => {
    const s = buildTrainSummary({ last_merged_at: ago(60) }, [], NOW);
    expect(s.slots).toBeNull();
    expect(s.banners.map((b) => b.code)).not.toContain("slots-saturated");
    expect(s.banners.map((b) => b.code)).not.toContain("repo-cap-starved");
  });

  // --- occupancy_over_cap: the invariant tripwire nothing was reading. ------
  // coord always serializes it and documents it as having to read 0 forever.
  // Unread, the console rendered the impossible `4/3` as an ordinary ratio and
  // repeated the silence the Prometheus gauge already kept through three
  // incidents.

  it("raises a blocking banner when the slot count exceeds the ceiling", () => {
    const s = buildTrainSummary(
      {
        slots: slots({
          configured_cap: 3,
          effective_cap: 3,
          occupied: 4,
          occupancy_over_cap: 1,
        }),
      },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "occupancy-over-cap");
    expect(b?.severity).toBe("blocking");
    expect(b?.detail).toContain("4 permit-holding proposals");
    expect(b?.detail).toContain("ceiling of 3");
    expect(b?.detail).toContain("coord defect");
  });

  it("ranks the tripwire above the capacity readings it undermines", () => {
    // Every slot number on the tab comes from the suspect count, so an
    // operator must read "these numbers are wrong" before "the train is at
    // capacity" — otherwise they chase a throughput ceiling that may not exist.
    const s = buildTrainSummary(
      { slots: slots({ occupied: 4, occupancy_over_cap: 1 }) },
      [],
      NOW
    );
    const codes = s.banners.map((b) => b.code);
    expect(codes.indexOf("occupancy-over-cap")).toBeLessThan(
      codes.indexOf("slots-saturated")
    );
  });

  it("stays silent on a healthy invariant and on a coord that omits it", () => {
    // 0 is coord ASSERTING the invariant holds; absence is an older producer
    // saying nothing. Neither may raise the banner — and absence must not be
    // back-derived from `occupied > configured_cap`, which is coord's
    // comparison to make, not ours.
    for (const over of [
      { occupancy_over_cap: 0 },
      { occupancy_over_cap: undefined },
    ]) {
      const s = buildTrainSummary({ slots: slots(over) }, [], NOW);
      expect(s.banners.map((b) => b.code)).not.toContain("occupancy-over-cap");
    }
  });

  // --- tenant_scoped: the scope the Slots stat used to assert wrongly. ------
  // `/pr-merge/health` observes with `Some(tenant_id)` ALWAYS, so under any
  // coord that reports the field the cap is the TENANT's while the occupancy
  // beside it stays fleet-wide. The stat hardcoded "occupancy and cap are
  // fleet-wide", pairing a fleet-wide numerator with a tenant-scoped
  // denominator — the same shape as quoting a configured per-repo cap beside a
  // flag derived against a narrowed one.

  it("says the cap is the tenant's when coord scoped the observation", () => {
    const note = slotScopeNote(slots({ tenant_scoped: true }));
    expect(note).toContain("Occupancy is fleet-wide");
    expect(note).toContain("YOUR TENANT's");
  });

  it("says both are fleet-wide only when coord reports an untenanted read", () => {
    const note = slotScopeNote(slots({ tenant_scoped: false }));
    expect(note).toContain("both fleet-wide");
  });

  it("reports the scope as unknown when coord omits tenant_scoped", () => {
    // Absence is UNKNOWN, not fleet-wide. Picking either scope on no evidence
    // is the absence-as-fact error the whole module exists to avoid.
    const note = slotScopeNote(slots());
    expect(note).toContain("unknown");
    expect(note).not.toContain("YOUR TENANT's");
    expect(note).not.toContain("both fleet-wide");
  });

  it("names the tenant's own fleet when its dynamic cap collapses to 0", () => {
    // Scope changes the remedy and the blast radius: tenanted, the runners to
    // bring back are the tenant's own and other tenants keep landing.
    const s = buildTrainSummary(
      {
        slots: slots({
          dynamic: true,
          effective_cap: 0,
          occupied: 0,
          online_ci_runners: 0,
          tenant_scoped: true,
        }),
      },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "no-ci-runners");
    expect(b?.detail).toContain("YOUR TENANT's runners");
    expect(b?.detail).toContain("other tenants may be landing normally");
  });

  it("keeps the no-runners copy unchanged when the scope is unknown", () => {
    // A coord too old to report the scope must not have a tenant claim put in
    // its mouth — the copy is byte-identical to before the field existed.
    const s = buildTrainSummary(
      {
        slots: slots({
          dynamic: true,
          effective_cap: 0,
          occupied: 0,
          online_ci_runners: 0,
        }),
      },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "no-ci-runners");
    expect(b?.detail).toBe(
      `The slot cap is dynamic (COORD_MERGE_SLOT_CAP_DYNAMIC=1) and no CI ` +
        `runner is online, so the effective cap is 0 — the train cannot ` +
        `dispatch anything at all, regardless of how many PRs are ready.`
    );
  });
});

describe("buildTrainSummary", () => {
  it("computes the pause clock from last_merged_at", () => {
    const s = buildTrainSummary({ last_merged_at: ago(7200) }, [], NOW);
    expect(s.sinceLastMergeSecs).toBe(7200);
    expect(s.healthMissing).toBe(false);
  });

  it("marks health missing when the proxy degraded to {}", () => {
    const s = buildTrainSummary({}, [], NOW);
    expect(s.healthMissing).toBe(true);
    expect(s.sinceLastMergeSecs).toBeNull();
    // No banners are invented from an empty body.
    expect(s.banners).toHaveLength(0);
  });

  it("raises a blocking banner for a stale leader lease", () => {
    const s = buildTrainSummary(
      { leader: { lease_fresh: false, heartbeat_age_seconds: 1200 } },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "leader-lease-stale");
    expect(b?.severity).toBe("blocking");
    expect(b?.detail).toContain("20m");
  });

  it("raises the merge-suppression banner (coord issue #776)", () => {
    const s = buildTrainSummary(
      {
        last_merged_at: ago(100),
        dry_run: { would_merge_blocked_by_dry_run: 3, repos: ["qontinui/web"] },
      },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "dry-run-freeze");
    expect(b?.severity).toBe("blocking");
    expect(b?.detail).toContain("3 ready PRs");
    // Must not name the retired tri-state, and must point at the two settings
    // that can actually cause this — including `auto_merge_enabled`, which
    // defaults off and is out of this plan's scope.
    expect(b?.detail).not.toMatch(/rollout_state|dry.?run/i);
    expect(b?.detail).toMatch(/auto-merge/i);
  });

  it("detects the suppressed-train signature: evaluating but not landing", () => {
    const s = buildTrainSummary(
      {
        last_merged_at: ago(4 * 3600),
        last_predicate_eval_at: ago(60),
        ready_unmerged: { count: 5, max_age_seconds: 9000, prs: [] },
      },
      [],
      NOW
    );
    expect(s.banners.map((b) => b.code)).toContain("suppressed-train");
  });

  it("does NOT call a long gap suppressed when nothing is ready", () => {
    // A quiet fleet with no landable work is idle, not broken.
    const s = buildTrainSummary(
      {
        last_merged_at: ago(4 * 3600),
        last_predicate_eval_at: ago(60),
        ready_unmerged: { count: 0, prs: [] },
      },
      [],
      NOW
    );
    expect(s.banners.map((b) => b.code)).not.toContain("suppressed-train");
    expect(s.banners.map((b) => b.code)).toContain("healthy");
  });

  it("warns loudly when hydration is disabled", () => {
    const s = buildTrainSummary(
      {
        last_merged_at: ago(60),
        hydration_enabled: false,
        pr_state_stale_backlog: 12,
      },
      [],
      NOW
    );
    const b = s.banners.find((x) => x.code === "hydration-stale");
    expect(b?.severity).toBe("blocking");
    expect(b?.detail).toContain("12 rows already overdue");
  });

  it("counts in-flight proposals and active repos from the rows", () => {
    const rows = buildRepoTrainRows(
      [
        proposal({
          status: "landing",
          repos: [{ repo: "a/b", branch: "x", head_sha: "s" }],
        }),
        proposal({
          status: "awaiting-ci",
          repos: [{ repo: "c/d", branch: "y", head_sha: "t" }],
        }),
      ],
      [],
      null,
      NOW
    );
    const s = buildTrainSummary({ last_merged_at: ago(30) }, rows, NOW);
    expect(s.activeRepoCount).toBe(2);
    expect(s.inFlightCount).toBe(2);
  });
});
