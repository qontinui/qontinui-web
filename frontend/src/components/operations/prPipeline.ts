// ============================================================================
// prPipeline — pure derivation for the unified PR pipeline view.
// ============================================================================
//
// Plan: qontinui-dev-notes/prompts/coord-fleet-page-redesign-2026-07-14.md.
// The fleet page used to render two parallel PR lists — GitHub's view
// (`GET /pr-merge/prs`) and coord's merge-scheduler view (`GET /merge/queue`)
// — with different terminology. This module fuses them: one row per PR (or
// per multi-repo proposal group), one user-facing status per row, past
// proposals collapsed into attempt history, and a derived traffic-light
// health summary for the whole pipeline.
//
// Everything here is pure and side-effect free (timestamps are passed in),
// so the status table and health heuristics are unit-testable without a DOM.

import type {
  MergeEconomics,
  PrRow,
  ProposalDetail,
  ProposalStatus,
  RepoDetail,
} from "./mergeTypes";

// ----------------------------------------------------------------------------
// Unified status
// ----------------------------------------------------------------------------

export type UnifiedStatusKind =
  | "ready"
  | "queued"
  | "rebasing"
  | "awaiting-ci"
  | "landing"
  | "merged"
  | "conflict"
  | "blocked"
  | "needs-rebase"
  | "not-mergeable"
  // A TRUE merge conflict that is DE-ESCALATED to amber: the repo's candidate
  // CI is long and the PR is not near the front of the land queue, so coord
  // won't try to merge it for a while — resolving the conflict now would just
  // go stale. "Resolve just-before-merge", not "act now". See statusFromGitHub.
  | "conflict-deferred"
  // The `conflict-deferred` de-escalation with an EXPIRED premise. Deferral is
  // justified only by "coord reaches this PR soon"; coord cannot rebase past a
  // TRUE conflict, so such a PR never advances to the front where the amber
  // label says to fix it — it just sits, marked "waiting", excluded from the
  // needs-attention count. Past the deferral window we re-escalate to red.
  | "conflict-stranded"
  | "requirements"
  | "checks-failing"
  | "checks-pending"
  | "draft"
  | "unknown";

/** Who (if anyone) the status is waiting on — drives the row accent. */
export type Attention = "author" | "waiting" | "none";

/**
 * The audited kind → attention table. Every status this module constructs
 * MUST carry the attention listed here (enforced by a unit test), because the
 * badge palette in MergePipeline is keyed off the SAME table: `author` → red,
 * `waiting` → amber, `none` → never red or amber. Keeping the mapping in one
 * exported constant is what stops the two surfaces from drifting into the
 * bug this replaced — a red badge on a state that needs nobody (CI still
 * running) and an amber one on a state that does (a failed check).
 *
 * The audit, one line per kind:
 *
 * | kind             | why it exists                        | author acts? |
 * |------------------|--------------------------------------|--------------|
 * | ready            | CLEAN, coord will pick it up         | no           |
 * | queued           | in coord's queue                     | no           |
 * | rebasing         | coord dry-rebasing the candidate     | no           |
 * | awaiting-ci      | candidate CI running                 | no           |
 * | checks-pending   | branch CI still running              | no           |
 * | landing          | coord pushing the land               | no           |
 * | merged           | landed                               | no           |
 * | draft            | intentionally parked by the author   | no           |
 * | unknown          | GitHub still recomputing             | no           |
 * | blocked          | overlaps another PR; coord serializes| no — waits   |
 * | needs-rebase     | BEHIND; coord auto-rebases in train  | no — waits   |
 * | conflict-deferred| true conflict, but far from merging  | no — waits   |
 * | conflict-stranded| deferred so long the premise expired | YES          |
 * | conflict         | rebase/candidate CI failed           | YES          |
 * | not-mergeable    | conflicts, and it blocks now         | YES          |
 * | checks-failing   | a check reported failure             | YES          |
 * | requirements     | review demanded / ruleset unmet      | YES          |
 */
export const ATTENTION_BY_KIND: Record<UnifiedStatusKind, Attention> = {
  ready: "none",
  queued: "none",
  rebasing: "none",
  "awaiting-ci": "none",
  "checks-pending": "none",
  landing: "none",
  merged: "none",
  draft: "none",
  unknown: "none",
  blocked: "waiting",
  "needs-rebase": "waiting",
  "conflict-deferred": "waiting",
  "conflict-stranded": "author",
  conflict: "author",
  "not-mergeable": "author",
  "checks-failing": "author",
  requirements: "author",
};

/**
 * The kinds that mean "this PR has a TRUE merge conflict and the author must
 * act", derived from GitHub state rather than from a live merge proposal.
 *
 * These rows are invisible to the in-flight queue feed: `buildPipelineRows`
 * only reaches `statusFromGitHub` (the sole producer of these kinds) when the
 * row has NO active proposal, and coord's `GET /merge/queue` excludes terminal
 * proposals. So any health/severity roll-up that counts conflicts by scanning
 * active proposals alone silently reports zero for every one of them — the
 * exact defect that let a 17-strand fleet render "Merging normally".
 *
 * Membership is deliberately narrow: `conflict-deferred` is a true conflict too
 * but is de-escalated ON PURPOSE (coord won't reach it for a while, resolving
 * now would go stale), and `conflict-stranded` already covers the case where
 * that deferral outlives its premise. A unit test asserts every member carries
 * `attention: "author"`, so a kind cannot be added here without also being red.
 */
export const GITHUB_CONFLICT_KINDS: ReadonlySet<UnifiedStatusKind> = new Set([
  "not-mergeable",
  "conflict-stranded",
]);

export interface UnifiedStatus {
  kind: UnifiedStatusKind;
  /** User-facing label. Never a raw coord/GitHub enum value. */
  label: string;
  /** Brief plain-language reason / next step. May be empty. */
  reason: string;
  attention: Attention;
}

/**
 * Map an ACTIVE proposal's scheduler state to the user-facing status.
 * Coordinator terminology is translated here and nowhere else:
 * "dry-rebasing" → "Testing merge", "blocked-by-overlap" → "Waiting on
 * another PR". `cancelled` is intentionally absent — a cancelled proposal is
 * never the active one (see `pickActiveProposal`).
 */
function statusFromProposal(p: ProposalDetail): UnifiedStatus {
  switch (p.status) {
    case "queued":
      return {
        kind: "queued",
        label: "Queued",
        reason: "in line for merge processing",
        attention: "none",
      };
    case "dry-rebasing":
      return {
        kind: "rebasing",
        label: "Testing merge",
        reason: "coord is rebasing onto latest main",
        attention: "none",
      };
    case "awaiting-ci":
      return {
        kind: "awaiting-ci",
        label: "Awaiting CI",
        reason: "running on the merge candidate, not your branch",
        attention: "none",
      };
    case "landing":
      return {
        kind: "landing",
        label: "Landing",
        reason: "coord is pushing the merge — no action needed",
        attention: "none",
      };
    case "merged":
      return {
        kind: "merged",
        label: "Merged",
        reason: "landed by the merge train",
        attention: "none",
      };
    case "conflict":
      return {
        kind: "conflict",
        label: "Conflict",
        reason: p.error
          ? p.error
          : "rebase or candidate CI failed — expand for details",
        attention: "author",
      };
    case "blocked-by-overlap": {
      const paths = p.repos.flatMap((r) => r.overlap_paths ?? []);
      return {
        kind: "blocked",
        label: "Waiting on another PR",
        reason:
          paths.length > 0
            ? `overlapping files: ${paths.slice(0, 2).join(", ")}${paths.length > 2 ? "…" : ""}`
            : (p.error ?? "overlapping files — lands after the other PR"),
        attention: "waiting",
      };
    }
    default:
      return {
        kind: "unknown",
        label: "Syncing",
        reason: "",
        attention: "none",
      };
  }
}

/**
 * True when an UNSTABLE (or aggregate-failing) PR actually has a FAILED
 * check — as opposed to checks that are merely still running. Prefers
 * coord's named `failing_contexts` (new optional field); falls back to the
 * aggregate `ci_conclusion` when the arrays are absent (older coord
 * deploys omit them entirely). Shared by prPipeline, PrsTable, and
 * MergeTrain so "failed" vs "still running" never drifts between surfaces.
 */
export function unstableHasFailure(
  pr: Pick<PrRow, "failing_contexts" | "ci_conclusion">
): boolean {
  return (
    (pr.failing_contexts?.length ?? 0) > 0 || pr.ci_conclusion === "failure"
  );
}

/** "security, test (windows) +2 more" — at most 3 named check contexts. */
export function formatContextNames(names: readonly string[]): string {
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} +${names.length - 3} more` : shown;
}

// ----------------------------------------------------------------------------
// CI-duration-aware conflict severity (plan
// 2026-07-17-fleet-ci-duration-aware-severity).
//
// A TRUE merge conflict (`DIRTY` / `mergeable===false`) is NOT uniformly
// "act now". Coord auto-rebases each candidate just before it tests+merges it,
// so on a repo whose candidate CI runs ~2h and whose PR is deep in the land
// queue, resolving the conflict *now* only means it goes stale again before
// coord reaches it. The severity model:
//   - long CI DAMPENS conflict urgency  → amber ("resolve at merge")
//   - front-of-queue AMPLIFIES it       → red   ("blocks now")
// Everything is driven by the optional per-repo `MergeEconomics` read, with a
// hardcoded fallback so the feature works before that read deploys.
// ----------------------------------------------------------------------------

/**
 * A repo whose candidate CI p90 at/above this reads as "long CI", where a
 * conflict deep in the queue de-escalates to amber. Default 30m; overridden
 * per-repo by `MergeEconomics.candidate_ci_p90_secs` when present.
 */
export const LONG_CI_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Static long-CI repo hints used ONLY when economics is absent (the common
 * case until `coord_query_merge_economics` deploys). qontinui-runner's windows
 * job runs ~60–120m — see MEMORY: "runner windows CI ~2h serializes the train".
 */
export const LONG_CI_REPO_HINTS: readonly string[] = ["qontinui-runner"];

/**
 * Queue depth at/below which a repo's land queue is "near the front": the merge
 * train reaches this repo's PRs soon, so a conflict here blocks imminently and
 * stays RED even on a long-CI repo. Only consulted when economics carries
 * `queue_depth`; absent ⇒ proximity defaults to "not-front".
 */
export const FRONT_QUEUE_DEPTH_THRESHOLD = 2;

/**
 * Floor for how long a TRUE conflict may stay de-escalated to amber before it
 * re-escalates to red. Per-repo the real cutoff is `max(this, 2 × candidate-CI
 * p90)` — see `conflictDeferralMaxMs`.
 *
 * Why a hatch is needed at all: `conflict-deferred` says "resolve this at
 * merge", which is sound ONLY while "coord reaches this PR soon" holds. coord
 * lands by rebase and cannot rebase past a true conflict — its dry-rebase ends
 * `could not apply` and the proposal goes terminal. So the PR never reaches the
 * front of the queue, the amber label never converts to red, and the row stays
 * out of the needs-attention count indefinitely. Measured 2026-07-20: 17 open
 * PRs stranded fleet-wide, oldest 752h; the trigger case (coord#1066) sat 4
 * days on a textual conflict with its fix fully implemented. Deferral is a
 * scheduling optimisation, not a terminal state — it has to expire.
 */
export const CONFLICT_DEFERRAL_MAX_MS = 6 * 60 * 60 * 1000;

/** Look up a repo's economics by full `owner/name` then by short name. */
function economicsFor(
  repo: string,
  economics: Record<string, MergeEconomics> | undefined
): MergeEconomics | undefined {
  if (!economics) return undefined;
  return economics[repo] ?? economics[shortRepo(repo)];
}

/**
 * Is this a long-CI repo? Prefers the measured `candidate_ci_p90_secs`; falls
 * back to the static repo-name hint when economics is absent for the repo.
 */
export function isLongCiRepo(
  repo: string,
  economics?: Record<string, MergeEconomics>
): boolean {
  const econ = economicsFor(repo, economics);
  if (econ?.candidate_ci_p90_secs != null) {
    return econ.candidate_ci_p90_secs * 1000 >= LONG_CI_THRESHOLD_MS;
  }
  const short = shortRepo(repo);
  return LONG_CI_REPO_HINTS.some((h) => short === h || repo === h);
}

/**
 * Is this repo's land queue near the front? A conflict on a near-front repo
 * stays RED regardless of CI duration. Derived from the economics `queue_depth`
 * (shallow queue ⇒ near front); "not-front" when economics is absent — a
 * conflicted PR has no active proposal, so it has no per-PR queue position of
 * its own (report §Grounding: "no proposal + conflict" ⇒ NOT-front).
 */
export function isNearFrontOfQueue(
  repo: string,
  economics?: Record<string, MergeEconomics>
): boolean {
  const econ = economicsFor(repo, economics);
  return (
    econ?.queue_depth != null && econ.queue_depth <= FRONT_QUEUE_DEPTH_THRESHOLD
  );
}

/**
 * True when the PR has checks that are still RUNNING (no verdict yet).
 * Prefers coord's named `pending_contexts`; falls back to the aggregate
 * `ci_lifecycle` when the arrays are absent (older coord deploys omit them).
 * This is the "just wait" signal — it must never be reported as a failure.
 */
export function hasPendingChecks(
  pr: Pick<PrRow, "pending_contexts" | "ci_lifecycle">
): boolean {
  return (
    (pr.pending_contexts?.length ?? 0) > 0 || pr.ci_lifecycle === "pending"
  );
}

/**
 * True when this PR has LANDED.
 *
 * `closed` counts as merged, and that is deliberate — it rests on a guarantee
 * from the FEED, not on GitHub's own flag. coord's two land paths close a PR
 * differently: the merge button sets `pr_state = "merged"`, while coord's
 * rebase-fast-forward land pushes straight to the base branch, so GitHub
 * reports the PR `closed` with `merged = false`. ff-lands are the MAJORITY of
 * this fleet's landings. The only way a non-open row reaches this list at all
 * is coord's `query_recently_merged_prs`, whose WHERE clause already requires
 * `merge_commit_sha IS NOT NULL` — so a closed row here has landed, whether
 * or not the sha is serialized in the payload.
 *
 * Gating on `merge_commit_sha` instead would be correct only against a coord
 * that projects it; against every older deploy the ff-landed rows would fail
 * the check, fall through to the GitHub derivation, and pollute the LIVE
 * list with closed PRs rendered as "Ready". The sha is used for the reason
 * text and nothing else.
 */
export function isMergedPr(pr: Pick<PrRow, "pr_state">): boolean {
  return pr.pr_state === "merged" || pr.pr_state === "closed";
}

/**
 * How long this repo may defer a true conflict: two full worst-case candidate
 * runs (long enough that a genuinely-queued PR would have been reached), with
 * `CONFLICT_DEFERRAL_MAX_MS` as the floor so a fast repo still gets a grace
 * window rather than flipping red the moment a conflict appears.
 */
export function conflictDeferralMaxMs(
  repo: string,
  economics?: Record<string, MergeEconomics>
): number {
  const econ = economicsFor(repo, economics);
  const p90Ms =
    econ?.candidate_ci_p90_secs != null ? econ.candidate_ci_p90_secs * 1000 : 0;
  return Math.max(CONFLICT_DEFERRAL_MAX_MS, 2 * p90Ms);
}

/**
 * How long this PR has been stuck in conflict, in ms, or `null` when nothing
 * can say.
 *
 * Reads coord's strand clock (`conflict_age_secs`) and nothing else. The
 * proposal history carried in `attempts` CANNOT answer this: coord's terminal
 * `conflict` proposals are excluded from the in-flight queue feed, so a
 * stranded PR arrives here with an EMPTY attempts array — which is exactly why
 * it renders via `statusFromGitHub` in the first place.
 *
 * `null` means "no evidence" and the caller must keep the existing amber
 * rather than invent a strand. Absence is not proof of freshness — an older
 * coord deploy omits the field entirely.
 */
export function conflictStrandedForMs(
  pr: Pick<PrRow, "conflict_age_secs">
): number | null {
  const secs = pr.conflict_age_secs;
  if (secs == null || !Number.isFinite(secs) || secs < 0) return null;
  return secs * 1000;
}

/**
 * Status for a PR with NO active merge attempt — GitHub's view decides.
 * Precedence (report §C/§7): merged (terminal, and it outranks the stale
 * pr_state a fast-forward land leaves behind) > draft > behind-main >
 * hard-unmergeable > BLOCKED (itself split by cause: review demanded /
 * checks failed / checks still running) > failing checks > clean.
 *
 * `economics` (optional; default `{}`) drives CI-duration-aware conflict
 * severity — see the DIRTY branch below.
 */
function statusFromGitHub(
  pr: PrRow,
  economics: Record<string, MergeEconomics> = {}
): UnifiedStatus {
  // Merged wins over draft: a landed PR is terminal, and coord's
  // recently-merged rows keep whatever pr_state GitHub last mirrored.
  if (isMergedPr(pr)) {
    return {
      kind: "merged",
      label: "Merged",
      reason: pr.merge_commit_sha
        ? `landed on ${pr.base_branch} as ${pr.merge_commit_sha.slice(0, 7)}`
        : `landed on ${pr.base_branch}`,
      attention: "none",
    };
  }
  if (pr.pr_state === "draft" || pr.merge_state_status === "DRAFT") {
    return {
      kind: "draft",
      label: "Draft",
      reason: "parked by the author — not in the pipeline until marked ready",
      attention: "none",
    };
  }
  if (pr.merge_state_status === "BEHIND") {
    // Coord's merge train rebases candidates itself — BEHIND is a "just
    // wait" state, not an author-action state. Kind stays `needs-rebase`
    // for filtering continuity.
    return {
      kind: "needs-rebase",
      label: "Needs rebase",
      reason: `behind ${pr.base_branch} — coord auto-rebases it in the train, no action needed`,
      attention: "waiting",
    };
  }
  if (pr.mergeable === false || pr.merge_state_status === "DIRTY") {
    const longCi = isLongCiRepo(pr.repo, economics);
    const nearFront = isNearFrontOfQueue(pr.repo, economics);
    // RED — "act now": short-CI repo (a conflict blocks the fast train), OR
    // near the front of the land queue (coord reaches it imminently). long CI
    // dampens, front-of-queue amplifies.
    if (!longCi || nearFront) {
      return {
        kind: "not-mergeable",
        label: "Not mergeable",
        reason:
          longCi && nearFront
            ? "conflict — blocks now (near front of land queue)"
            : "conflict — blocks now",
        attention: "author",
      };
    }
    // RED again — the deferral premise EXPIRED. Everything below assumes coord
    // reaches this PR soon; past the per-repo deferral window that assumption is
    // falsified by the clock, and the honest report is that nobody is coming.
    const strandedMs = conflictStrandedForMs(pr);
    const deferralMaxMs = conflictDeferralMaxMs(pr.repo, economics);
    if (strandedMs !== null && strandedMs > deferralMaxMs) {
      return {
        kind: "conflict-stranded",
        label: "Conflict (stranded)",
        reason:
          `conflict unresolved for ${formatDurationShort(strandedMs)} — coord cannot ` +
          `rebase past it and will not reach it on its own; needs an author rebase`,
        attention: "author",
      };
    }
    // AMBER — "resolve just-before-merge": long-CI repo, not near the front.
    // coord only rebases this candidate right before it merges it, so resolving
    // the conflict now would just go stale. De-escalated: NOT counted as
    // "needs attention" (that count stays true-urgency only). Bounded by the
    // hatch above so this can never become a permanent parking state.
    const econ = economicsFor(pr.repo, economics);
    const ciMs =
      econ?.candidate_ci_p90_secs != null
        ? econ.candidate_ci_p90_secs * 1000
        : CI_WAIT_RED_MS;
    const queuePart =
      econ?.queue_depth != null
        ? `${econ.queue_depth} in queue`
        : "deep in queue";
    return {
      kind: "conflict-deferred",
      label: "Conflict (resolve at merge)",
      reason: `conflict — resolve at merge (repo CI ~${formatDurationShort(ciMs)}, ${queuePart})`,
      attention: "waiting",
    };
  }
  if (pr.merge_state_status === "BLOCKED") {
    const failing = pr.failing_contexts ?? [];
    // GitHub reports BLOCKED for the WHOLE window in which required checks
    // have not yet reported — and on this fleet the overwhelmingly common
    // cause is simply "CI is still running", which needs nobody. Collapsing
    // all of BLOCKED into one red "Blocked by requirements" is what trained
    // the eye to ignore red. Split it by cause; only a real failure or a
    // review demand is an author-action state.
    if (pr.review_decision === "CHANGES_REQUESTED") {
      return {
        kind: "requirements",
        label: "Changes requested",
        reason:
          "a reviewer requested changes — address them and re-request review",
        attention: "author",
      };
    }
    if (pr.review_decision === "REVIEW_REQUIRED") {
      return {
        kind: "requirements",
        label: "Review required",
        reason: "a required approving review is missing — request one",
        attention: "author",
      };
    }
    if (failing.length > 0) {
      return {
        kind: "checks-failing",
        label: "Checks failing",
        reason: `required checks failing: ${formatContextNames(failing)} — push a fix`,
        attention: "author",
      };
    }
    if (hasPendingChecks(pr)) {
      const pending = pr.pending_contexts ?? [];
      return {
        kind: "checks-pending",
        label: "Checks in progress",
        reason:
          pending.length > 0
            ? `required checks still running: ${formatContextNames(pending)}`
            : "required checks still running — no action needed",
        attention: "none",
      };
    }
    return {
      kind: "requirements",
      label: "Blocked by requirements",
      reason:
        pr.required_checks_satisfied === false
          ? "a required check has not reported and none is running — re-run CI on the head commit"
          : "a branch ruleset / protection requirement is unmet — the PR's merge box on GitHub names it",
      attention: "author",
    };
  }
  if (
    pr.merge_state_status === "UNSTABLE" ||
    (pr.ci_lifecycle === "complete" && pr.ci_conclusion === "failure")
  ) {
    if (unstableHasFailure(pr)) {
      const failing = pr.failing_contexts ?? [];
      return {
        kind: "checks-failing",
        label: "Checks failing",
        reason:
          failing.length > 0
            ? `failing: ${formatContextNames(failing)} — push a fix`
            : "branch CI reports a failing check — push a fix",
        attention: "author",
      };
    }
    // No named failure and no aggregate failure — the non-required checks
    // are merely still running. This branch also covers the old-coord
    // fallback where the context arrays are absent and `ci_lifecycle` is
    // still "pending": never claim "failing" without a failure signal.
    const pending = pr.pending_contexts ?? [];
    return {
      kind: "checks-pending",
      label: "Checks in progress",
      reason:
        pending.length > 0
          ? `still running: ${formatContextNames(pending)}`
          : "non-required checks still running — no action needed",
      attention: "none",
    };
  }
  if (pr.merge_state_status === "CLEAN") {
    return {
      kind: "ready",
      label: "Ready",
      reason: "clean and green — waiting for coord to pick it up",
      attention: "none",
    };
  }
  return {
    kind: "unknown",
    label: "Syncing",
    reason:
      "GitHub is still recomputing mergeability — this resolves on its own",
    attention: "none",
  };
}

// ----------------------------------------------------------------------------
// Row building (the join)
// ----------------------------------------------------------------------------

/** One member of a multi-repo proposal group, with its PR when one exists. */
export interface GroupMember {
  repo: RepoDetail;
  pr: PrRow | null;
}

export interface PipelineRow {
  /** Stable identity: `repo::branch` for PRs, the repo-set signature for groups. */
  key: string;
  /** Full `owner/name` (first member repo for a group). */
  repo: string;
  /** Repo without the owner prefix — the scan-friendly display form. */
  repoShort: string;
  prNumber: number | null;
  branch: string;
  baseBranch: string | null;
  status: UnifiedStatus;
  /** Most recent signal — proposal state change if active, else PR refresh. */
  updatedAt: string | null;
  /**
   * When this row LANDED, for the merged tab's ordering + timestamp. Null on
   * every non-merged row, and also on a merged row whose coord deploy does not
   * yet project `merged_at` (the tab degrades to "merge time unknown" rather
   * than inventing one from `updatedAt`, which is a refresh time, not a land
   * time).
   */
  mergedAt: string | null;
  pr: PrRow | null;
  activeProposal: ProposalDetail | null;
  /** All proposals ever seen for this key, newest first (attempt history). */
  attempts: ProposalDetail[];
  /** Merge-candidate CI run when coord is (or was) testing this PR. */
  ciRunUrl: string | null;
  agentId: string | null;
  /** Non-null for a multi-repo proposal group (renders as sub-rows). */
  members: GroupMember[] | null;
}

function shortRepo(repo: string): string {
  return repo.includes("/") ? repo.split("/").slice(1).join("/") : repo;
}

function singleKey(repo: string, branch: string): string {
  return `${repo}::${branch}`;
}

function proposalKey(p: ProposalDetail): string {
  const parts = p.repos.map((r) => singleKey(r.repo, r.branch));
  parts.sort();
  return parts.join("|");
}

/** Coord's own merge-candidate refs sometimes ingest as branches — they are
 *  scheduler plumbing, never a user's PR, and must not render as rows. */
function isMergeCandidateRef(branch: string): boolean {
  return branch.startsWith("merge-candidate/");
}

/** Newest-first sort by `updated_at` (missing timestamps sink to the end). */
function byUpdatedDesc(a: ProposalDetail, b: ProposalDetail): number {
  return (
    new Date(b.updated_at ?? 0).getTime() -
    new Date(a.updated_at ?? 0).getTime()
  );
}

/**
 * The proposal whose state IS the row's state: the newest one that wasn't
 * cancelled. Older attempts (and cancelled ones) become expandable history —
 * the fact that coord mints a fresh proposal_id per attempt is an internal
 * detail the row must not leak (report §B).
 */
export function pickActiveProposal(
  attempts: ProposalDetail[]
): ProposalDetail | null {
  return attempts.find((p) => p.status !== "cancelled") ?? null;
}

const TERMINAL: ReadonlySet<ProposalStatus> = new Set(["merged", "cancelled"]);

/**
 * The land time for a row, or null when it has not landed / no source carries
 * one. Two independent sources, because the two land paths stamp different
 * tables: coord's own fast-forward land stamps `merge_proposals.merged_at`,
 * while `repo_branches.merged_at` is written by whichever path closed the PR.
 * We never substitute `updated_at` — a refresh time presented as a merge time
 * would silently mis-order the merged tab on every poll.
 */
function pickMergedAt(
  status: UnifiedStatus,
  pr: PrRow | null,
  attempts: ProposalDetail[]
): string | null {
  if (status.kind !== "merged") return null;
  const newestProposalMerge = attempts.reduce<string | null>(
    (acc, a) =>
      a.merged_at && (acc === null || a.merged_at > acc) ? a.merged_at : acc,
    null
  );
  return pr?.merged_at ?? newestProposalMerge;
}

export function buildPipelineRows(
  prs: PrRow[],
  proposals: ProposalDetail[],
  economicsByRepo: Record<string, MergeEconomics> = {}
): PipelineRow[] {
  // Group every proposal (any status — history included) by its repo-set key.
  const byKey = new Map<string, ProposalDetail[]>();
  for (const p of proposals) {
    if (p.repos.length === 0) continue;
    if (p.repos.every((r) => isMergeCandidateRef(r.branch))) continue;
    const key = proposalKey(p);
    const list = byKey.get(key);
    if (list) list.push(p);
    else byKey.set(key, [p]);
  }
  for (const list of byKey.values()) list.sort(byUpdatedDesc);

  const prByKey = new Map<string, PrRow>();
  for (const pr of prs) {
    if (!isMergeCandidateRef(pr.branch)) {
      prByKey.set(singleKey(pr.repo, pr.branch), pr);
    }
  }

  const rows: PipelineRow[] = [];
  const consumedProposalKeys = new Set<string>();

  // --- one row per PR -------------------------------------------------------
  for (const pr of prs) {
    if (isMergeCandidateRef(pr.branch)) continue;
    const key = singleKey(pr.repo, pr.branch);
    const attempts = byKey.get(key) ?? [];
    if (attempts.length > 0) consumedProposalKeys.add(key);
    const active = pickActiveProposal(attempts);
    const status = active
      ? statusFromProposal(active)
      : statusFromGitHub(pr, economicsByRepo);
    rows.push({
      key,
      repo: pr.repo,
      repoShort: shortRepo(pr.repo),
      prNumber: pr.pr_number,
      branch: pr.branch,
      baseBranch: pr.base_branch,
      status,
      updatedAt: active ? active.updated_at : pr.last_refreshed_at,
      mergedAt: pickMergedAt(status, pr, attempts),
      pr,
      activeProposal: active,
      attempts,
      ciRunUrl:
        active?.repos.find((r) => r.ci_run_url)?.ci_run_url ??
        attempts.flatMap((a) => a.repos).find((r) => r.ci_run_url)
          ?.ci_run_url ??
        null,
      agentId: active?.agent_id ?? attempts[0]?.agent_id ?? null,
      members: null,
    });
  }

  // --- proposal-only rows (no matching PR) + multi-repo groups --------------
  for (const [key, attempts] of byKey) {
    if (consumedProposalKeys.has(key)) continue;
    const active = pickActiveProposal(attempts);
    if (!active) continue; // every attempt cancelled and no PR → nothing to show
    const first = active.repos[0];
    if (!first) continue; // unreachable: zero-repo proposals never enter byKey
    const isGroup = active.repos.length > 1;
    const status = statusFromProposal(active);
    rows.push({
      key,
      repo: first.repo,
      repoShort: shortRepo(first.repo),
      prNumber: null,
      branch: first.branch,
      baseBranch: null,
      status,
      updatedAt: active.updated_at,
      mergedAt: pickMergedAt(status, null, attempts),
      pr: null,
      activeProposal: active,
      attempts,
      ciRunUrl: active.repos.find((r) => r.ci_run_url)?.ci_run_url ?? null,
      agentId: active.agent_id,
      members: isGroup
        ? active.repos.map((r) => ({
            repo: r,
            pr: prByKey.get(singleKey(r.repo, r.branch)) ?? null,
          }))
        : null,
    });
  }

  // --- queue positions -------------------------------------------------------
  const queued = rows
    .filter((r) => r.activeProposal?.status === "queued")
    .sort(
      (a, b) =>
        new Date(a.activeProposal!.created_at).getTime() -
        new Date(b.activeProposal!.created_at).getTime()
    );
  queued.forEach((row, i) => {
    row.status = {
      ...row.status,
      reason: `${ordinal(i + 1)} in line for the merge train — no action needed`,
    };
  });

  rows.sort(compareRows);
  return rows;
}

function ordinal(n: number): string {
  const rem10 = n % 10;
  const rem100 = n % 100;
  if (rem10 === 1 && rem100 !== 11) return `${n}st`;
  if (rem10 === 2 && rem100 !== 12) return `${n}nd`;
  if (rem10 === 3 && rem100 !== 13) return `${n}rd`;
  return `${n}th`;
}

/**
 * Triage order (report §8 — "scanning 20+ rows and immediately spotting the
 * blocked ones"): rows needing the author first, then waiting-on-others, then
 * in-flight by pipeline position, idle, and finally terminal/dormant states.
 */
const KIND_RANK: Record<UnifiedStatusKind, number> = {
  conflict: 0,
  // A strand is act-now by definition — it has already waited longer than the
  // deferral window, so it sorts with the other author-blocked rows.
  "conflict-stranded": 0,
  "not-mergeable": 0,
  requirements: 0,
  "checks-failing": 0,
  "needs-rebase": 0,
  blocked: 1,
  // De-escalated conflict: "soon, not now" — sorts with the waiting-on-others
  // band, below the true act-now (rank 0) rows, above in-flight/idle.
  "conflict-deferred": 1,
  landing: 2,
  "awaiting-ci": 3,
  "checks-pending": 4,
  rebasing: 5,
  queued: 6,
  ready: 7,
  unknown: 8,
  draft: 9,
  merged: 10,
};

function compareRows(a: PipelineRow, b: PipelineRow): number {
  const rank = KIND_RANK[a.status.kind] - KIND_RANK[b.status.kind];
  if (rank !== 0) return rank;
  // Merged rows order by LAND time, newest first — that is what the merged
  // tab is a record of. Rows whose coord deploy carries no `merged_at` fall
  // back to `updatedAt` so they still interleave sanely instead of sinking.
  if (a.status.kind === "merged" && b.status.kind === "merged") {
    return (
      new Date(b.mergedAt ?? b.updatedAt ?? 0).getTime() -
      new Date(a.mergedAt ?? a.updatedAt ?? 0).getTime()
    );
  }
  return (
    new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  );
}

// ----------------------------------------------------------------------------
// Filtering
// ----------------------------------------------------------------------------

export type PipelineFilter = "all" | "attention" | "in-flight" | "merged";

export function matchesFilter(row: PipelineRow, f: PipelineFilter): boolean {
  switch (f) {
    // "All PRs" is the live pipeline — merged rows are history and live in
    // their own tab, so they do not pad the working list.
    case "all":
      return row.status.kind !== "merged";
    case "attention":
      return row.status.attention !== "none";
    case "in-flight": {
      const s = row.activeProposal?.status;
      return s !== undefined && !TERMINAL.has(s);
    }
    case "merged":
      return row.status.kind === "merged";
  }
}

/** Case-insensitive match on repo, branch, #number, and the status label. */
export function matchesQuery(row: PipelineRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    row.repo,
    row.repoShort,
    row.branch,
    row.prNumber !== null ? `#${row.prNumber}` : "",
    row.prNumber !== null ? String(row.prNumber) : "",
    row.status.label,
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

// ----------------------------------------------------------------------------
// Pipeline health (the traffic light)
// ----------------------------------------------------------------------------

export type HealthLevel = "green" | "amber" | "red";

export interface PipelineHealth {
  level: HealthLevel;
  /** e.g. "Merging normally" / "Pipeline slow" / "Pipeline stuck". */
  headline: string;
  /** The signals behind the verdict, plain language, comma-joined. */
  detail: string;
  /** Active (non-terminal) proposals. */
  queueDepth: number;
  /** Proposals past the queue: rebasing / awaiting CI / landing. */
  inFlight: number;
  /** Rows whose status needs the author. */
  needsAttention: number;
  /**
   * PRs blocked on a merge conflict — author-side backlog.
   *
   * Reported SEPARATELY from `level` on purpose. A conflicted PR never enters
   * the merge train (coord cannot rebase past a conflict, so no candidate is
   * ever cut), which means it cannot slow the pipeline down and its count says
   * nothing about pipeline throughput. Folding it into the level is what made
   * the page announce "Pipeline stuck · 7 conflicts accumulating" while all
   * three trains were landing normally (measured 2026-07-20: three lands inside
   * 1h40m, and every one of the conflicts was days old).
   */
  conflicted: number;
  lastMergedAt: string | null;
}

// Thresholds. The fleet's slowest CI (runner windows job) runs ~60–120m, so
// "amber" fires at half that and "red" only past a full worst-case runtime.
export const CI_WAIT_AMBER_MS = 30 * 60 * 1000;
export const CI_WAIT_RED_MS = 2 * 60 * 60 * 1000;
// "Nothing is moving": newest state change across ACTIVE proposals is older
// than this while the queue is non-empty.
export const STALL_AMBER_MS = 30 * 60 * 1000;
export const STALL_RED_MS = 90 * 60 * 1000;
/**
 * A land inside this window proves the pipeline is passing work through, so a
 * red signal is reported as "degraded" rather than "stuck". Sized to the
 * fleet's slowest candidate CI (~2h) so a long-CI repo mid-cycle is not called
 * stopped merely for being slow.
 */
export const LAND_RECENCY_MS = 2 * 60 * 60 * 1000;

/** Requeue count at which leader-takeover churn reads as an infra problem. */
export const REQUEUE_CHURN_THRESHOLD = 3;

/**
 * Per-repo CI-wait thresholds. When economics carries a
 * `suggested_stuck_threshold_secs` (coord's own timing-derived cutoff) that is
 * the red line, amber at half; else derive from `candidate_ci_p90_secs` (red at
 * a full worst-case p90 runtime, amber at half); else the fleet-wide fallback
 * constants. A long-CI repo therefore no longer trips "stuck" at the global 2h
 * when its candidate runs are legitimately that long.
 */
function ciWaitThresholds(
  repo: string,
  economics: Record<string, MergeEconomics> | undefined
): { amberMs: number; redMs: number } {
  const econ = economicsFor(repo, economics);
  if (econ?.suggested_stuck_threshold_secs != null) {
    const redMs = econ.suggested_stuck_threshold_secs * 1000;
    return { amberMs: redMs / 2, redMs };
  }
  if (econ?.candidate_ci_p90_secs != null) {
    const redMs = econ.candidate_ci_p90_secs * 1000;
    return { amberMs: redMs / 2, redMs };
  }
  return { amberMs: CI_WAIT_AMBER_MS, redMs: CI_WAIT_RED_MS };
}

export function derivePipelineHealth(
  rows: PipelineRow[],
  nowMs: number,
  economicsByRepo: Record<string, MergeEconomics> = {}
): PipelineHealth {
  const active = rows
    .map((r) => r.activeProposal)
    .filter((p): p is ProposalDetail => p !== null && !TERMINAL.has(p.status));

  // Conflicts come from BOTH sides, for the same reason `lastMergedAt` does.
  // `active` only sees the in-flight queue feed, which EXCLUDES terminal
  // `conflict` proposals — so a PR whose conflict is reported by GitHub rather
  // than by a live proposal has no active proposal at all and would count zero
  // here. That is how a fleet with 17 stranded PRs rendered as "Merging
  // normally": the escalation reached the row badge and the needs-attention
  // chip, but not the headline the operator actually scans.
  //
  // The two sides are disjoint by construction: `buildPipelineRows` only calls
  // `statusFromGitHub` (the sole producer of GITHUB_CONFLICT_KINDS) when the
  // row has no active proposal, so nothing is double-counted.
  // Counted as DISTINCT PRs, not rows. A multi-repo group proposal produces
  // its OWN row (keyed `repoA::b1|repoB::b2`) *and* a row per member PR, so a
  // row-wise sum reports one conflict two or three times — and this number is
  // printed to the operator as a literal PR count.
  const conflictedPrs = new Set<string>();
  const noteConflict = (repo: string, prNumber: number | null | undefined) => {
    if (prNumber != null) conflictedPrs.add(`${repo}#${prNumber}`);
  };
  for (const r of rows) {
    const conflicted =
      (r.activeProposal !== null && r.activeProposal.status === "conflict") ||
      GITHUB_CONFLICT_KINDS.has(r.status.kind);
    if (!conflicted) continue;
    if (r.members) {
      for (const m of r.members) noteConflict(m.repo.repo, m.pr?.pr_number);
    } else {
      noteConflict(r.repo, r.prNumber);
    }
  }
  const conflicts = conflictedPrs.size;
  const blocked = active.filter(
    (p) => p.status === "blocked-by-overlap"
  ).length;
  const inFlight = active.filter(
    (p) =>
      p.status === "dry-rebasing" ||
      p.status === "awaiting-ci" ||
      p.status === "landing"
  ).length;
  const needsAttention = rows.filter(
    (r) => r.status.attention === "author"
  ).length;

  // Land times come from BOTH sources. `GET /merge/queue` is the in-flight
  // view — it excludes terminal proposals — so reading only `attempts` left
  // this permanently "never" on a healthy fleet; the merged PR rows are the
  // reliable source.
  let lastMergedAt: string | null = null;
  const noteMerge = (t: string | null | undefined) => {
    if (t && (lastMergedAt === null || t > lastMergedAt)) lastMergedAt = t;
  };
  for (const r of rows) {
    noteMerge(r.mergedAt);
    for (const p of r.attempts) noteMerge(p.merged_at);
  }

  // Per-repo CI-wait severity: each awaiting-ci proposal is judged against its
  // OWN repo's threshold (long-CI repos get a longer leash), then reduced to
  // the worst breach for the headline. Falls back to the global constants when
  // economics is absent — identical to the prior global behaviour.
  let redCiWaitMs = 0;
  let amberCiWaitMs = 0;
  for (const p of active) {
    if (p.status !== "awaiting-ci") continue;
    const waited = nowMs - new Date(p.updated_at).getTime();
    const { amberMs, redMs } = ciWaitThresholds(
      p.repos[0]?.repo ?? "",
      economicsByRepo
    );
    if (waited > redMs) redCiWaitMs = Math.max(redCiWaitMs, waited);
    else if (waited > amberMs) amberCiWaitMs = Math.max(amberCiWaitMs, waited);
  }
  const newestActivityAgoMs =
    active.length > 0
      ? Math.min(...active.map((p) => nowMs - new Date(p.updated_at).getTime()))
      : 0;
  const churning = active.some(
    (p) => (p.requeue_count ?? 0) >= REQUEUE_CHURN_THRESHOLD
  );

  // Pipeline reasons drive `level`. Author reasons NEVER do — see below.
  const redReasons: string[] = [];
  const amberReasons: string[] = [];
  const authorReasons: string[] = [];

  // Conflicts are author-side backlog, not pipeline throughput. They stay
  // VISIBLE (that was the point of surfacing them at all) but they no longer
  // set the level: a conflicted PR has no candidate in the train and cannot
  // make the train slow or stuck. Phrase it as the action it needs, so the
  // reader is not left inferring severity from a bare noun.
  if (conflicts > 0)
    authorReasons.push(
      `${conflicts} PR${conflicts === 1 ? " needs" : "s need"} an author rebase`
    );
  // Orthogonal means the conflict count is no evidence EITHER WAY — it does not
  // license asserting the positive. With backlog present and nothing at all in
  // the train, green would be reached by absence of evidence and would render
  // "Merging normally" beside a "last merged never" badge. Nothing can be cut
  // into the train, which is a pipeline fact, so it earns amber (never red).
  // NB: a `conflict` proposal is "active" here (this module's TERMINAL set is
  // only {merged, cancelled}), so `active.length` is NOT the test — it stays
  // non-zero on a fleet where every proposal has conflicted. The question is
  // whether anything can still MOVE.
  const movable = active.filter((p) => p.status !== "conflict").length;
  if (conflicts > 0 && movable === 0)
    amberReasons.push("nothing in the train — all open work is conflicted");
  if (blocked > 0)
    amberReasons.push(
      `${blocked} waiting on overlapping PR${blocked === 1 ? "" : "s"}`
    );
  if (redCiWaitMs > 0)
    redReasons.push(`oldest CI wait ${formatDurationShort(redCiWaitMs)}`);
  else if (amberCiWaitMs > 0)
    amberReasons.push(`oldest CI wait ${formatDurationShort(amberCiWaitMs)}`);
  if (active.length > 0 && newestActivityAgoMs > STALL_RED_MS)
    redReasons.push(
      `no movement in ${formatDurationShort(newestActivityAgoMs)}`
    );
  else if (active.length > 0 && newestActivityAgoMs > STALL_AMBER_MS)
    amberReasons.push(
      `queue quiet for ${formatDurationShort(newestActivityAgoMs)}`
    );
  if (churning) amberReasons.push("repeated requeues (leader churn)");

  const level: HealthLevel =
    redReasons.length > 0 ? "red" : amberReasons.length > 0 ? "amber" : "green";

  // "Stuck" is a claim that nothing is getting through, and a train that landed
  // minutes ago falsifies it. A red signal with a recent land is DEGRADED, not
  // stopped — same severity, honest wording. Without this guard the strongest
  // available evidence (a land) loses to a threshold breach.
  // `nowMs` is the BROWSER clock; `lastMergedAt` is a coord SERVER stamp. Any
  // skew putting the newest land ahead of the client makes the difference
  // negative — trivially < the window — which would suppress "stuck" forever.
  // Same lower bound `relativeTime` (utils.ts) already applies to this value.
  // NaN falls through to "stuck", which is the safe direction.
  const sinceLandMs = lastMergedAt
    ? nowMs - new Date(lastMergedAt).getTime()
    : Number.NaN;
  const landedRecently = sinceLandMs >= 0 && sinceLandMs < LAND_RECENCY_MS;

  return {
    level,
    headline:
      level === "red"
        ? landedRecently
          ? "Pipeline degraded"
          : "Pipeline stuck"
        : level === "amber"
          ? "Pipeline slow"
          : "Merging normally",
    detail: [...redReasons, ...amberReasons, ...authorReasons].join(" · "),
    queueDepth: active.length,
    inFlight,
    needsAttention,
    conflicted: conflicts,
    lastMergedAt,
  };
}

/** "47m", "2h", "3d" — compact, for health-strip details. */
export function formatDurationShort(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
