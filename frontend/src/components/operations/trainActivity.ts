// ============================================================================
// Merge-train per-repo activity derivation
// ============================================================================
//
// Backs the fleet pipeline's "Train" tab. Where the other tabs answer "what is
// the state of each PR", this answers the two questions a PR-shaped view
// structurally cannot:
//
//   1. What is the merge train DOING right now, per repo?
//   2. Why are there long pauses between merges?
//
// (2) is the reason this module exists. A pause has causes at three different
// altitudes, and only one of them is visible in per-PR data:
//
//   - FLEET  — leader lease lapsing, or merges disabled/paused for the
//              tenant. Both stall every repo at once and no PR row shows
//              either.
//   - REPO   — the train is mid-phase (dry-rebasing / candidate CI / landing),
//              or serialized behind an overlapping proposal.
//   - PR     — the candidate PRs are individually blocked (red CI, conflicts,
//              review required, …), so there is nothing legal to land.
//
// The derivation folds all three into one per-repo row, and deliberately
// distinguishes "the train is busy" from "the train is idle because nothing is
// eligible" from "the train is idle and something IS eligible" — that last one
// is the orchestrator-stalled case, and it is the only one that means coord
// itself is at fault.
//
// PURE by construction (no IO, no clock reads except the injected `now`), so
// every branch is unit-testable — same convention as `prPipeline.ts`.
//
// NAMING: this file is `trainActivity.ts`, not `mergeTrain.ts`, because the
// sibling component is `MergeTrain.tsx` and Windows/macOS filesystems are
// case-insensitive — `./mergeTrain` would resolve to the component and break
// every import of it.

import type {
  MergeStatusToken,
  PrRow,
  ProposalDetail,
  ProposalStatus,
  ReadyUnmergedPr,
  RepoSlotSaturation,
  SlotSaturation,
  TrainHealth,
} from "./mergeTypes";
import { redactSecrets } from "./mergeTypes";
import { formatStallAge } from "./utils";

// ----------------------------------------------------------------------------
// Proposal status classification
// ----------------------------------------------------------------------------

/**
 * Terminal and uninteresting — dropped entirely.
 *
 * Classification is deliberately by EXCLUSION: anything that is not in this set
 * or {@link PARKED} counts as in-flight. `ProposalStatus` is coord's enum, not
 * this frontend's, so an allow-list would make a repo silently vanish from the
 * board the first time coord adds a phase — the absence-as-false-negative class
 * this whole module is built to avoid.
 *
 * Note `queued` is therefore in-flight here, unlike coord's own
 * `IN_FLIGHT_PROPOSAL_STATUSES` (which excludes it because a queued proposal
 * holds no resources worth draining before a deploy). A proposal sitting in
 * `queued` is precisely the slot-starvation pause this tab exists to explain.
 */
const TERMINAL: ReadonlySet<string> = new Set<ProposalStatus>([
  "merged",
  "cancelled",
]);

/**
 * `GET /merge/queue` returns everything that is not `merged`/`cancelled`, so
 * `conflict` and `shadow-landed` rows accumulate in it indefinitely — a live
 * coord had 76 conflict rows dating back six weeks. They are terminal for
 * activity purposes and must never be rendered as "the train is doing this".
 */
const PARKED: ReadonlySet<string> = new Set<ProposalStatus>([
  "conflict",
  "shadow-landed",
]);

/**
 * How far through the pipeline each status is. When a repo has several
 * in-flight legs, the most-advanced one is what the train is actually working
 * on; the rest are queued behind it.
 */
const PHASE_RANK: Record<string, number> = {
  landing: 6,
  "awaiting-ci": 5,
  "speculative-ci": 4,
  "dry-rebasing": 3,
  "blocked-by-overlap": 2,
  queued: 1,
};

export type TrainActivityKind = ProposalStatus | "idle";

/** What the train is doing for one repo, right now. */
export interface TrainActivity {
  kind: TrainActivityKind;
  /** Short label for the badge, e.g. "Landing", "Candidate CI". */
  label: string;
  /** One line of specifics — which branch, which files, which run. */
  detail: string;
  /** `updated_at` of the driving proposal — i.e. when this phase began. */
  since: string | null;
  /**
   * Seconds in the CURRENT phase. Derived from `updated_at`, which coord
   * stamps on status transitions — so this is phase dwell, not proposal age.
   * A large dwell is the per-repo shape of a pause.
   */
  dwellSecs: number | null;
  proposalId: string | null;
  branch: string | null;
  ciRunUrl: string | null;
  /** Files that serialized this proposal behind another (blocked-by-overlap). */
  overlapPaths: string[];
  /** Other in-flight legs for this repo, waiting behind `proposalId`. */
  behind: number;
  /** Leader-takeover churn counter. Rising = the proposal is being starved. */
  requeueCount: number;
}

// ----------------------------------------------------------------------------
// Pause reasons
// ----------------------------------------------------------------------------

export type PauseSeverity =
  /** coord is at fault, or the train is frozen — operator action needed. */
  | "blocking"
  /** Legitimately waiting on something that will resolve itself. */
  | "waiting"
  /** Context, not a cause. */
  | "info";

export type PauseReasonCode =
  | "leader-lease-stale"
  | "no-ci-runners"
  /** LEGACY NAME, live meaning. Raised when coord judged a PR landable and
   *  then did not push it — merges off/paused for the repo or tenant, or
   *  auto-merge never enabled. It is not the retired `rollout_state=dry_run`.
   *  The string is a stable identifier (ranking key + `data-testid` suffix),
   *  so it is renamed with coord's `/pr-merge/health` keys, not before. */
  | "dry-run-freeze"
  | "orchestrator-stalled"
  /** This repo is at its per-repo in-flight cap, so the dequeue skips it —
   *  even when a global slot is free. */
  | "repo-cap-starved"
  /** Every global merge slot is occupied; nothing can be dispatched. */
  | "slots-saturated"
  | "conflict-strand"
  | "ci-failed"
  | "ci-pending"
  | "conflicts"
  | "behind-base"
  | "review-required"
  | "blast-radius-block"
  | "draft"
  | "hydration-stale"
  | "no-candidates";

export interface PauseReason {
  code: PauseReasonCode;
  severity: PauseSeverity;
  label: string;
  /** Plain-language explanation, already redacted. */
  detail: string;
  /** How many PRs in this repo sit in this reason. 0 for repo-wide reasons. */
  prCount: number;
  /** Age of the oldest PR in this reason, in seconds. */
  oldestSecs: number | null;
  /** PR numbers, for the expanded detail view. */
  prNumbers: number[];
}

/** Ordering: what best explains the pause comes first. */
const REASON_RANK: Record<PauseReasonCode, number> = {
  "leader-lease-stale": 0,
  "no-ci-runners": 1,
  "dry-run-freeze": 2,
  "orchestrator-stalled": 3,
  "hydration-stale": 4,
  // Capacity reasons outrank per-PR ones: when the train has no room, the
  // individual PRs' states are not what is holding the queue.
  "repo-cap-starved": 5,
  "slots-saturated": 6,
  "conflict-strand": 7,
  "ci-failed": 8,
  conflicts: 9,
  "blast-radius-block": 10,
  "review-required": 11,
  "behind-base": 12,
  "ci-pending": 13,
  draft: 14,
  "no-candidates": 15,
};

const REASON_META: Record<
  Exclude<
    PauseReasonCode,
    | "leader-lease-stale"
    | "no-ci-runners"
    | "dry-run-freeze"
    | "orchestrator-stalled"
    | "hydration-stale"
    | "repo-cap-starved"
    | "slots-saturated"
  >,
  { label: string; severity: PauseSeverity }
> = {
  "conflict-strand": { label: "Stranded in conflict", severity: "blocking" },
  "ci-failed": { label: "CI red", severity: "blocking" },
  conflicts: { label: "Needs rebase", severity: "blocking" },
  "blast-radius-block": { label: "Blast-radius gate", severity: "blocking" },
  "review-required": { label: "Review required", severity: "blocking" },
  "behind-base": { label: "Behind base", severity: "waiting" },
  "ci-pending": { label: "CI running", severity: "waiting" },
  draft: { label: "Draft", severity: "info" },
  "no-candidates": { label: "No candidates", severity: "info" },
};

/** Map a coord `merge_status` token onto a pause reason. */
const STATUS_TO_REASON: Partial<Record<string, PauseReasonCode>> = {
  "ci-failed": "ci-failed",
  "ci-pending": "ci-pending",
  conflicts: "conflicts",
  "behind-base": "behind-base",
  "review-required": "review-required",
  "blast-radius-block": "blast-radius-block",
  draft: "draft",
  "ready-but-unlanded": "orchestrator-stalled",
  // `ready` and `queued` mean the train HAS accepted the PR — they are
  // progress, not a pause, so they intentionally have no reason mapping.
};

// ----------------------------------------------------------------------------
// Rows
// ----------------------------------------------------------------------------

export interface RepoTrainRow {
  repo: string;
  /** `owner/name` -> `name`. */
  repoShort: string;
  activity: TrainActivity;
  /** Most-explanatory-first. */
  reasons: PauseReason[];
  /** Green + CLEAN + unlanded PRs coord knows about, oldest first. */
  readyUnmerged: ReadyUnmergedPr[];
  /** Latest proposal error for this repo, redacted. The rawest "why". */
  lastError: string | null;
  /** Most recent proposal touch for this repo — "last train activity". */
  lastActivityAt: string | null;
  openPrCount: number;
  inFlightCount: number;
  /** Parked `conflict` proposals at the repo's current heads. */
  conflictCount: number;
  /** coord reported this repo under `/pr-merge/health`'s legacy `dry_run`
   *  key: a PR was judged landable and then not pushed. The key name is
   *  historical (see buildTrainSummary) — the cause today is merges being
   *  off/paused for the repo or tenant, or auto-merge never enabled. */
  frozenDryRun: boolean;
  /** One-line answer to "what is this repo's train doing". */
  headline: string;
  /** Worst severity across `reasons` — drives the row's colour. */
  severity: PauseSeverity;
}

export interface TrainBanner {
  code: PauseReasonCode | "suppressed-train" | "healthy";
  severity: PauseSeverity;
  label: string;
  detail: string;
}

export interface TrainSummary {
  lastMergedAt: string | null;
  /** THE pause clock: seconds since anything last landed, fleet-wide. */
  sinceLastMergeSecs: number | null;
  lastPredicateEvalAt: string | null;
  leaseFresh: boolean | null;
  leaseAgeSecs: number | null;
  hydrationEnabled: boolean | null;
  staleBacklog: number | null;
  dryRunRepos: string[];
  readyUnmergedCount: number;
  readyUnmergedMaxAgeSecs: number | null;
  /** Repos with a non-idle activity. */
  activeRepoCount: number;
  /** In-flight proposals fleet-wide. */
  inFlightCount: number;
  /** coord's merge-slot saturation, or `null` when unavailable. Absence must
   *  never be rendered as "not saturated". */
  slots: SlotSaturation | null;
  /** Fleet-level explanations, most severe first. */
  banners: TrainBanner[];
  /** True when health was unavailable (proxy degraded to `{}`). */
  healthMissing: boolean;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function shortRepo(repo: string): string {
  const i = repo.indexOf("/");
  return i === -1 ? repo : repo.slice(i + 1);
}

function secsSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 1000));
}

/**
 * Chronological comparison of two RFC3339 stamps.
 *
 * NOT a string compare: coord serialises `DateTime<Utc>` with chrono's default,
 * whose fractional-second width varies (0/3/6/9 digits), so lexicographic order
 * is not chronological — `…59.999500Z` sorts BEFORE `…59.999Z`. That is enough
 * to pick the wrong driver proposal in a tie-break.
 */
function isAfter(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a > b;
  return ta > tb;
}

/**
 * Compact duration: "45s", "12m", "3h", "2d"; "—" when unknown.
 *
 * Delegates to the shared {@link formatStallAge} rather than reimplementing it
 * — the only difference is the unknown case, which reads as an em dash here
 * (a missing measurement) instead of "0s" (a measurement of zero).
 */
export function formatDuration(secs: number | null | undefined): string {
  if (secs == null || Number.isNaN(secs) || secs < 0) return "—";
  return formatStallAge(secs);
}

const ACTIVITY_LABEL: Record<TrainActivityKind, string> = {
  landing: "Landing",
  "awaiting-ci": "Candidate CI",
  "speculative-ci": "Speculative CI",
  "dry-rebasing": "Dry-rebasing",
  "blocked-by-overlap": "Serialized",
  queued: "Queued for a slot",
  conflict: "Conflict",
  "shadow-landed": "Shadow-landed",
  merged: "Merged",
  cancelled: "Cancelled",
  idle: "Idle",
};

/**
 * Reconstruct a `merge_status` for a PR row that lacks one.
 *
 * coord only began emitting `merge_status`/`blocking_summary` on 2026-06-18, so
 * an older deploy returns neither. Rather than render "unknown" for every PR
 * against such a coord, mirror the prefix of `classify_merge_status` that is
 * derivable from the fields `PrRow` has always carried. The tail of that
 * classifier (`ready` / `queued` / `ready-but-unlanded`) depends on proposal
 * freshness, which is reconstructed by the caller from the queue instead.
 */
/**
 * The proposal statuses coord's `proposal_in_flight` treats as "the train has
 * this PR". Verbatim from `pr_merge/mod.rs` — deliberately NARROWER than this
 * module's own {@link TERMINAL}/{@link PARKED} exclusion, because a `conflict`
 * or `dry-rebasing` proposal does NOT mean the PR is safely in the train.
 *
 * Treating any non-null status as in-flight made a green PR whose candidate CI
 * had failed read as "nothing to do" — it fell out of every reason bucket.
 */
const PROPOSAL_IN_FLIGHT: ReadonlySet<string> = new Set([
  "queued",
  "awaiting-ci",
  "landing",
]);

/**
 * coord's `dep_graph::PER_PR_LANDED_TIMEOUT` — 30 minutes.
 *
 * A proposal older than this is STALE, and coord reports the PR as
 * `ready-but-unlanded` ("merge proposal is stale — orchestrator stalled")
 * rather than as in-train. Without this bound, a proposal wedged in
 * `awaiting-ci` for days — a known wedge class (lost check-run webhooks,
 * phantom required contexts) and precisely what this tab exists to catch —
 * renders as "Candidate CI for 3d" with no pause reason and no colour at all.
 */
const PROPOSAL_FRESH_SECS = 30 * 60;

/** A proposal linked to a PR's current head, as far as the tab can see it. */
export interface LinkedProposal {
  status: string;
  /** Age in seconds, or `null` when unknown (then freshness cannot be judged). */
  ageSecs: number | null;
}

export function fallbackMergeStatus(
  pr: PrRow,
  /**
   * The proposal at this PR's CURRENT head, or `null` when none.
   *
   * REQUIRED for the tail of the classifier to be correct, and it must carry
   * the AGE as well as the status. coord's own `classify_merge_status` ends by
   * asking "is there a FRESH IN-FLIGHT proposal?", where in-flight is
   * {@link PROPOSAL_IN_FLIGHT} and fresh is younger than
   * {@link PROPOSAL_FRESH_SECS}. Dropping either half of that gate is a
   * false-negative machine:
   *
   * - no status ⇒ every green PR reads `ready-but-unlanded`, including ones
   *   the train is actively working ("Candidate CI running" and "coord failed
   *   to take this PR" on the same row);
   * - status but no freshness ⇒ a proposal wedged for days reads as healthy;
   * - status without the in-flight filter ⇒ a PR whose candidate CI FAILED
   *   reads as "in the train, nothing to do".
   *
   * The caller reconstructs it from the merge queue on `(repo, head_sha)` —
   * coord's own join key — because a coord old enough to omit `merge_status`
   * omits `proposal_status` too (both landed in the same 2026-06-18 commit),
   * so the PrRow fields cannot be the fallback's only input.
   */
  proposal: LinkedProposal | null = null
): MergeStatusToken {
  if (pr.pr_state === "draft") return "draft";
  if (pr.ci_conclusion === "failure") return "ci-failed";
  if (pr.ci_lifecycle !== "complete") return "ci-pending";
  if (pr.merge_state_status === "DIRTY" || pr.mergeable === false)
    return "conflicts";
  if (pr.merge_state_status === "BEHIND") return "behind-base";
  if (
    pr.review_decision === "REVIEW_REQUIRED" ||
    pr.required_checks_satisfied === false
  )
    return "review-required";
  if (pr.mergeable === true) {
    // Mirrors coord's `fresh_in_flight`: in-flight status AND younger than the
    // landed timeout. An unknown age fails the gate (coord's `_ => false`),
    // because "we cannot tell if it is stale" must not read as "it is fresh".
    const fresh =
      proposal !== null &&
      PROPOSAL_IN_FLIGHT.has(proposal.status) &&
      proposal.ageSecs !== null &&
      proposal.ageSecs < PROPOSAL_FRESH_SECS;
    if (fresh) {
      // `queued` means accepted and landing imminently; the rest are mid-train.
      return proposal!.status === "queued" ? "ready" : "queued";
    }
    return "ready-but-unlanded";
  }
  return "unknown";
}

/** The verdict token to use for a PR, preferring coord's own. */
export function effectiveMergeStatus(
  pr: PrRow,
  proposal: LinkedProposal | null = null
): string {
  return pr.merge_status ?? fallbackMergeStatus(pr, proposal);
}

// ----------------------------------------------------------------------------
// Fleet summary
// ----------------------------------------------------------------------------

export function buildTrainSummary(
  health: TrainHealth | null,
  rows: RepoTrainRow[],
  now: number = Date.now()
): TrainSummary {
  const healthMissing = health === null || Object.keys(health).length === 0;

  const lastMergedAt = health?.last_merged_at ?? null;
  const sinceLastMergeSecs = secsSince(lastMergedAt, now);
  const lastPredicateEvalAt = health?.last_predicate_eval_at ?? null;
  const sinceEvalSecs = secsSince(lastPredicateEvalAt, now);
  const leaseFresh = health?.leader?.lease_fresh ?? null;
  const leaseAgeSecs = health?.leader?.heartbeat_age_seconds ?? null;
  const hydrationEnabled = health?.hydration_enabled ?? null;
  const staleBacklog = health?.pr_state_stale_backlog ?? null;
  // LEGACY WIRE KEYS. coord still sends `dry_run.repos` /
  // `dry_run.would_merge_blocked_by_dry_run` on `/pr-merge/health`, but the
  // tri-state they were named for is gone: the field now carries repos where
  // coord evaluated a PR as landable and then did NOT push, i.e.
  // `!merge_permitted()`. Renaming the keys needs coord and web to move
  // together, so the local names mirror the wire and only the operator-facing
  // strings below describe the real cause. Do not infer `rollout_state` from
  // these names.
  const mergeBlockedRepos = health?.dry_run?.repos ?? [];
  const mergeBlockedPrs = health?.dry_run?.would_merge_blocked_by_dry_run ?? 0;
  const readyUnmergedCount = health?.ready_unmerged?.count ?? 0;
  const readyUnmergedMaxAgeSecs =
    health?.ready_unmerged?.max_age_seconds ?? null;

  const activeRepoCount = rows.filter((r) => r.activity.kind !== "idle").length;
  const inFlightCount = rows.reduce((n, r) => n + r.inFlightCount, 0);

  const banners: TrainBanner[] = [];

  // 1. Leadership. A lapsed lease stalls every repo at once, so nothing below
  //    it is worth reading until it is fixed.
  if (leaseFresh === false) {
    banners.push({
      code: "leader-lease-stale",
      severity: "blocking",
      label: "Leader lease stale",
      detail:
        `No replica has heartbeated the merge-scheduler lease for ` +
        `${formatDuration(leaseAgeSecs)}. Leadership is lapsing, so NO repo ` +
        `is being driven — every per-repo reason below is a consequence, ` +
        `not a cause.`,
    });
  }

  // 2. Merge suppression (coord issue #776). The signature is a frozen
  //    `last_merged_at` alongside an ADVANCING `last_predicate_eval_at`: the
  //    engine is evaluating and deciding "would merge", then suppressing it.
  if (mergeBlockedPrs > 0 || mergeBlockedRepos.length > 0) {
    banners.push({
      code: "dry-run-freeze",
      severity: "blocking",
      label: "Merges suppressed",
      detail:
        `${mergeBlockedPrs} ready PR${mergeBlockedPrs === 1 ? "" : "s"} ` +
        `evaluated as landable and then NOT pushed, across ` +
        `${mergeBlockedRepos.length} repo` +
        `${mergeBlockedRepos.length === 1 ? "" : "s"} ` +
        `(${mergeBlockedRepos.map(shortRepo).join(", ")}). The predicate ` +
        `keeps evaluating; the merges are simply never executed. Two ` +
        `settings can cause this: the repo (or the whole tenant) has merges ` +
        `switched off, or the tenant never enabled auto-merge at all — ` +
        `check both in Merge settings.`,
    });
  }

  // 2b. Capacity. A saturated train explains a long gap WITHOUT anything being
  //     broken — but only when something is actually waiting. Saturated with an
  //     empty queue is a train at full throughput, and alarming about it would
  //     train the operator to ignore this banner.
  const slots = health?.slots ?? null;
  if (slots) {
    if (slots.dynamic && slots.effective_cap === 0) {
      banners.push({
        code: "no-ci-runners",
        severity: "blocking",
        label: "No CI runners online",
        detail:
          `The slot cap is dynamic (COORD_MERGE_SLOT_CAP_DYNAMIC=1) and no CI ` +
          `runner is online, so the effective cap is 0 — the train cannot ` +
          `dispatch anything at all, regardless of how many PRs are ready.`,
      });
    } else if (slots.saturated && slots.queued_depth > 0) {
      const waited = slots.oldest_queued_wait_seconds ?? null;
      banners.push({
        code: "slots-saturated",
        // A long oldest-wait is a throughput ceiling worth acting on; a short
        // one is just the queue doing its job.
        severity: waited !== null && waited > 30 * 60 ? "blocking" : "waiting",
        label: "All merge slots busy",
        detail:
          `${slots.occupied}/${slots.effective_cap} slots occupied with ` +
          `${slots.queued_depth} proposal${slots.queued_depth === 1 ? "" : "s"} ` +
          `queued${waited !== null ? `, oldest waiting ${formatDuration(waited)}` : ""}. ` +
          `${
            slots.dynamic
              ? `The cap is clamped to ${slots.online_ci_runners ?? "?"} online CI runners. `
              : `Raise COORD_MERGE_SLOTS to increase throughput. `
          }` +
          `This is a capacity limit, not a fault.`,
      });
    }
    // Orthogonal to global saturation: free slots + starved repos is the case
    // operators consistently misread as "coord is broken".
    // Derived from `repos[]` when coord omits the summary list: both fields are
    // optional on the wire, and keying the banner off one while the per-repo
    // reason keys off the other means a deploy that sends only one gives half
    // the signal.
    const atCap =
      slots.repos_at_cap ??
      (slots.repos ?? []).filter((r) => r.at_repo_cap).map((r) => r.repo);
    if (atCap.length > 0 && slots.available > 0) {
      banners.push({
        code: "repo-cap-starved",
        severity: "waiting",
        label: "Repos at their per-repo cap",
        detail:
          `${slots.available} slot${slots.available === 1 ? " is" : "s are"} ` +
          `free, but ${atCap.length} repo${atCap.length === 1 ? "" : "s"} ` +
          `(${atCap.map(shortRepo).join(", ")}) already hold ` +
          `COORD_MERGE_PER_REPO_CAP=${slots.per_repo_cap} in-flight proposals, ` +
          `so the dequeue skips their queued work. Fairness filter, by design — ` +
          `it stops one busy repo monopolising the train.`,
      });
    }
  }

  // 3. The suppressed-train signature, independent of merge enablement:
  //    evaluation is
  //    fresh but nothing has landed in a long time. This is what "long pauses
  //    between merges" looks like when the cause is NOT per-PR.
  const EVAL_FRESH_SECS = 15 * 60;
  const MERGE_STALE_SECS = 60 * 60;
  if (
    sinceLastMergeSecs !== null &&
    sinceLastMergeSecs > MERGE_STALE_SECS &&
    sinceEvalSecs !== null &&
    sinceEvalSecs < EVAL_FRESH_SECS &&
    readyUnmergedCount > 0
  ) {
    banners.push({
      code: "suppressed-train",
      severity: "blocking",
      label: "Evaluating but not landing",
      detail:
        `Nothing has landed for ${formatDuration(sinceLastMergeSecs)}, but ` +
        `the predicate ran ${formatDuration(sinceEvalSecs)} ago and ` +
        `${readyUnmergedCount} PR${readyUnmergedCount === 1 ? " is" : "s are"} ` +
        `ready. coord is deciding and then not executing — the train is ` +
        `suppressed, not idle.`,
    });
  }

  // 4. Hydration off ⇒ every `pr_state` below may be a stale cache, so the
  //    per-repo verdicts cannot be trusted. Worth saying loudly.
  if (hydrationEnabled === false) {
    banners.push({
      code: "hydration-stale",
      severity: "blocking",
      label: "PR hydration disabled",
      detail:
        `coord has no GitHub app client configured, so cached PR state is ` +
        `never refreshed${
          staleBacklog ? ` (${staleBacklog} rows already overdue)` : ""
        }. Treat every verdict below as possibly stale.`,
    });
  } else if (staleBacklog !== null && staleBacklog > 0) {
    banners.push({
      code: "hydration-stale",
      severity: "waiting",
      label: "PR state refresh backlog",
      detail:
        `${staleBacklog} open PR row${staleBacklog === 1 ? "" : "s"} are past ` +
        `their refresh TTL. Their verdicts may lag GitHub by a reconcile tick.`,
    });
  }

  if (banners.length === 0 && !healthMissing) {
    banners.push({
      code: "healthy",
      severity: "info",
      label: activeRepoCount > 0 ? "Train running" : "Train idle",
      detail:
        activeRepoCount > 0
          ? `${inFlightCount} proposal${inFlightCount === 1 ? "" : "s"} in ` +
            `flight across ${activeRepoCount} repo` +
            `${activeRepoCount === 1 ? "" : "s"}. Last land ` +
            `${formatDuration(sinceLastMergeSecs)} ago.`
          : `No proposals in flight. Last land ` +
            `${formatDuration(sinceLastMergeSecs)} ago — the pause is on the ` +
            `PR side, not the train's.`,
    });
  }

  return {
    lastMergedAt,
    sinceLastMergeSecs,
    lastPredicateEvalAt,
    leaseFresh,
    leaseAgeSecs,
    hydrationEnabled,
    staleBacklog,
    dryRunRepos: mergeBlockedRepos,
    readyUnmergedCount,
    readyUnmergedMaxAgeSecs,
    activeRepoCount,
    inFlightCount,
    slots,
    banners,
    healthMissing,
  };
}

// ----------------------------------------------------------------------------
// Per-repo rows
// ----------------------------------------------------------------------------

interface Leg {
  proposal: ProposalDetail;
  branch: string;
  ciRunUrl: string | null;
  overlapPaths: string[];
}

/**
 * Fold the merge queue, the open-PR list, and train health into one row per
 * repo.
 *
 * A repo appears if the train has ANY signal for it: an in-flight or parked
 * proposal, an open PR, a ready-unmerged entry, or suppressed merges. Repos with
 * nothing at all are omitted rather than rendered as empty idle rows.
 */
export function buildRepoTrainRows(
  proposals: ProposalDetail[],
  prs: PrRow[],
  health: TrainHealth | null,
  now: number = Date.now()
): RepoTrainRow[] {
  const inFlightLegs = new Map<string, Leg[]>();
  const parkedLegs = new Map<string, Leg[]>();
  const lastTouch = new Map<string, string>();
  /**
   * `repo@head_sha` → the status of the in-flight proposal at that head.
   * coord's own join key for linking a PR to its proposal, and the input the
   * merge-status fallback needs to avoid accusing the orchestrator of stalling
   * on PRs the train is actively working.
   */
  const proposalByHead = new Map<string, LinkedProposal>();

  for (const p of proposals) {
    if (TERMINAL.has(p.status)) continue;
    for (const r of p.repos ?? []) {
      const leg: Leg = {
        proposal: p,
        branch: r.branch,
        ciRunUrl: r.ci_run_url ?? null,
        overlapPaths: r.overlap_paths ?? [],
      };
      if (PARKED.has(p.status)) {
        push(parkedLegs, r.repo, leg);
      } else {
        // IN_FLIGHT, or an unrecognised non-terminal status — see TERMINAL.
        push(inFlightLegs, r.repo, leg);
        // Age from `created_at`, mirroring coord's `proposal_age` basis.
        proposalByHead.set(`${r.repo}@${r.head_sha}`, {
          status: p.status,
          ageSecs: secsSince(p.created_at, now),
        });
      }
      // Last train touch spans BOTH sets: a repo whose only recent proposal
      // died in conflict has still been worked on, and saying "no activity"
      // would be wrong.
      const prev = lastTouch.get(r.repo);
      if (prev === undefined || isAfter(p.updated_at, prev)) {
        lastTouch.set(r.repo, p.updated_at);
      }
    }
  }

  const prsByRepo = new Map<string, PrRow[]>();
  for (const pr of prs) {
    // Merged/closed rows are history — they describe no pause.
    if (pr.pr_state === "merged" || pr.pr_state === "closed") continue;
    push(prsByRepo, pr.repo, pr);
  }

  const readyByRepo = new Map<string, ReadyUnmergedPr[]>();
  for (const r of health?.ready_unmerged?.prs ?? []) {
    push(readyByRepo, r.repo, r);
  }

  const dryRunRepos = new Set(health?.dry_run?.repos ?? []);

  const slots = health?.slots ?? null;
  const slotsByRepo = new Map<string, RepoSlotSaturation>();
  for (const r of slots?.repos ?? []) slotsByRepo.set(r.repo, r);

  const repos = new Set<string>([
    ...inFlightLegs.keys(),
    ...parkedLegs.keys(),
    ...prsByRepo.keys(),
    ...readyByRepo.keys(),
    ...dryRunRepos,
    // A repo with only QUEUED proposals has no in-flight leg and may have no
    // open-PR row yet, but it is precisely the starved repo this tab exists to
    // surface — so coord's slot view seeds the row set too.
    ...slotsByRepo.keys(),
  ]);

  const rows: RepoTrainRow[] = [];
  for (const repo of repos) {
    const inFlight = inFlightLegs.get(repo) ?? [];
    const parked = parkedLegs.get(repo) ?? [];
    const repoPrs = prsByRepo.get(repo) ?? [];
    const ready = (readyByRepo.get(repo) ?? [])
      .slice()
      .sort((a, b) => (b.age_seconds ?? 0) - (a.age_seconds ?? 0));

    const repoSlots = slotsByRepo.get(repo) ?? null;
    const activity = deriveActivity(inFlight, slots, repoSlots, now);
    const frozenDryRun = dryRunRepos.has(repo);
    const reasons = deriveReasons({
      repoPrs,
      parked,
      ready,
      frozenDryRun,
      hasInFlight: inFlight.length > 0,
      slots,
      repoSlots,
      queuedLegs: inFlight.filter((l) => l.proposal.status === "queued").length,
      proposalByHead,
    });

    // The rawest "why": the newest parked proposal's error text. Redacted —
    // coord embeds the failing clone URL, credentials and all.
    const newestParked = parked
      .slice()
      .sort(
        (a, b) =>
          Date.parse(b.proposal.updated_at) - Date.parse(a.proposal.updated_at)
      )[0];
    // `||` not `??`: an empty-string `error` is not nullish, so `??` would let
    // it win the chain and suppress the real fallback text.
    const lastError =
      redactSecrets(newestParked?.proposal.error ?? null) ||
      redactSecrets(
        ready.find((r) => r.latest_proposal_error)?.latest_proposal_error ??
          null
      ) ||
      null;

    const severity: PauseSeverity = reasons.some(
      (r) => r.severity === "blocking"
    )
      ? "blocking"
      : reasons.some((r) => r.severity === "waiting")
        ? "waiting"
        : "info";

    rows.push({
      repo,
      repoShort: shortRepo(repo),
      activity,
      reasons,
      readyUnmerged: ready,
      lastError,
      lastActivityAt: lastTouch.get(repo) ?? null,
      openPrCount: repoPrs.length,
      inFlightCount: inFlight.length,
      conflictCount: parked.filter((l) => l.proposal.status === "conflict")
        .length,
      frozenDryRun,
      headline: headlineFor(activity, reasons, repoPrs.length),
      severity,
    });
  }

  return rows.sort(compareRepoRows);
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const cur = m.get(k);
  if (cur) cur.push(v);
  else m.set(k, [v]);
}

function deriveActivity(
  inFlight: Leg[],
  slots: SlotSaturation | null,
  repoSlots: RepoSlotSaturation | null,
  now: number
): TrainActivity {
  if (inFlight.length === 0) {
    return {
      kind: "idle",
      label: ACTIVITY_LABEL.idle,
      detail: "No proposal in flight",
      since: null,
      dwellSecs: null,
      proposalId: null,
      branch: null,
      ciRunUrl: null,
      overlapPaths: [],
      behind: 0,
      requeueCount: 0,
    };
  }

  // Most-advanced phase wins; ties break to the most recently updated leg.
  // `inFlight` is non-empty here, so `reduce` without a seed is total — and it
  // avoids the `sort()[0]` shape that `noUncheckedIndexedAccess` (correctly)
  // types as possibly-undefined.
  const driver = inFlight.reduce((best, leg) => {
    const rank =
      (PHASE_RANK[leg.proposal.status] ?? 0) -
      (PHASE_RANK[best.proposal.status] ?? 0);
    if (rank !== 0) return rank > 0 ? leg : best;
    return isAfter(leg.proposal.updated_at, best.proposal.updated_at)
      ? leg
      : best;
  });

  const p = driver.proposal;
  const kind = p.status as TrainActivityKind;
  const dwellSecs = secsSince(p.updated_at, now);

  let detail: string;
  switch (p.status) {
    case "landing":
      detail = `Fast-forwarding ${driver.branch} onto main`;
      break;
    case "awaiting-ci":
      detail = `Candidate CI running on ${driver.branch}`;
      break;
    case "speculative-ci":
      detail = `Speculative CI on ${driver.branch}, stacked on an unlanded predecessor`;
      break;
    case "dry-rebasing":
      detail = `Trial-rebasing ${driver.branch} onto current main`;
      break;
    case "blocked-by-overlap":
      detail = driver.overlapPaths.length
        ? `Serialized behind an in-flight proposal touching ${driver.overlapPaths
            .slice(0, 3)
            .join(", ")}${
            driver.overlapPaths.length > 3
              ? ` +${driver.overlapPaths.length - 3} more`
              : ""
          }`
        : "Serialized behind an overlapping in-flight proposal";
      break;
    case "queued":
      // Name the ACTUAL constraint. "Waiting for a merge slot" alone leaves an
      // operator unable to tell a busy train from a fairness skip — the two
      // have completely different fixes (raise the cap vs wait for this repo's
      // own in-flight work to finish).
      if (repoSlots?.at_repo_cap && slots) {
        detail =
          `Accepted, but skipped by the dequeue: this repo is at its ` +
          `per-repo cap (${repoSlots.in_flight}/${slots.per_repo_cap} in flight)` +
          `${slots.available > 0 ? `, despite ${slots.available} free global slot${slots.available === 1 ? "" : "s"}` : ""}`;
      } else if (slots?.saturated) {
        detail =
          `Accepted, waiting for a merge slot — all ${slots.effective_cap} ` +
          `are busy (${slots.queued_depth} queued fleet-wide)`;
      } else {
        detail = `Accepted, waiting for a merge slot`;
      }
      break;
    default:
      detail = driver.branch;
  }

  return {
    kind,
    label: ACTIVITY_LABEL[kind] ?? p.status,
    detail,
    since: p.updated_at,
    dwellSecs,
    proposalId: p.proposal_id,
    branch: driver.branch,
    ciRunUrl: driver.ciRunUrl,
    overlapPaths: driver.overlapPaths,
    behind: inFlight.length - 1,
    requeueCount: p.requeue_count ?? 0,
  };
}

/**
 * Threshold past which a `conflicts` verdict is reported as a STRAND rather
 * than a fresh conflict.
 *
 * coord re-proposes a conflicting PR indefinitely, so the newest proposal is
 * always minutes old even for a PR stranded for weeks — `conflict_age_secs` is
 * the only field that separates the two, and it is absent on older coord
 * deploys (treat absence as "no evidence", never as "not stranded").
 */
const STRAND_SECS = 24 * 60 * 60;

function deriveReasons(args: {
  repoPrs: PrRow[];
  parked: Leg[];
  ready: ReadyUnmergedPr[];
  frozenDryRun: boolean;
  hasInFlight: boolean;
  slots: SlotSaturation | null;
  repoSlots: RepoSlotSaturation | null;
  /** Count of this repo's `queued` legs seen in the merge queue — the
   *  fallback when coord omits the per-repo slot breakdown. */
  queuedLegs: number;
  proposalByHead: Map<string, LinkedProposal>;
}): PauseReason[] {
  const {
    repoPrs,
    ready,
    frozenDryRun,
    hasInFlight,
    slots,
    repoSlots,
    queuedLegs,
    proposalByHead,
  } = args;
  const reasons: PauseReason[] = [];

  // `slots.repos` is optional on the wire. When coord omits it we still know
  // this repo's queued legs from the merge queue, so a saturated fleet is not
  // silently reported as "this repo has nothing waiting" — absence of the
  // per-repo breakdown must not read as absence of a backlog.
  const queuedHere = repoSlots?.queued ?? queuedLegs;

  // Capacity first — when the train has no room for this repo, the per-PR
  // states below are not what is holding it up.
  if (repoSlots?.at_repo_cap && slots) {
    reasons.push({
      code: "repo-cap-starved",
      severity: "waiting",
      label: "At per-repo cap",
      detail:
        `This repo already holds ${repoSlots.in_flight} in-flight proposal` +
        `${repoSlots.in_flight === 1 ? "" : "s"}, its cap ` +
        `(COORD_MERGE_PER_REPO_CAP=${slots.per_repo_cap}). The dequeue SKIPS ` +
        `its remaining ${repoSlots.queued} queued proposal` +
        `${repoSlots.queued === 1 ? "" : "s"} until one finishes — ` +
        `${
          slots.available > 0
            ? `even though ${slots.available} global slot` +
              `${slots.available === 1 ? " is" : "s are"} free. This is the ` +
              `fairness filter working as designed, not a fault.`
            : `and every global slot is busy too.`
        }`,
      prCount: repoSlots.queued,
      oldestSecs: repoSlots.oldest_queued_wait_seconds ?? null,
      prNumbers: [],
    });
  } else if (slots?.saturated && queuedHere > 0) {
    reasons.push({
      code: "slots-saturated",
      severity: "waiting",
      label: "Waiting for a slot",
      detail:
        `All ${slots.effective_cap} global merge slot` +
        `${slots.effective_cap === 1 ? " is" : "s are"} occupied, so this ` +
        `repo's ${queuedHere} queued proposal` +
        `${queuedHere === 1 ? "" : "s"} cannot be dispatched. ` +
        `Fleet queue depth is ${slots.queued_depth}.`,
      prCount: queuedHere,
      oldestSecs: repoSlots?.oldest_queued_wait_seconds ?? null,
      prNumbers: [],
    });
  }

  if (frozenDryRun) {
    reasons.push({
      code: "dry-run-freeze",
      severity: "blocking",
      label: "Merges suppressed",
      detail:
        "coord evaluates every PR in this repo and then suppresses the " +
        "merge, so nothing will land. Either merges are switched off for " +
        "this repo or paused tenant-wide (Merge settings → the repo card, or " +
        "the tenant pause), or the tenant has never enabled auto-merge.",
      prCount: 0,
      oldestSecs: null,
      prNumbers: [],
    });
  }

  // Bucket open PRs by verdict.
  const buckets = new Map<PauseReasonCode, PrRow[]>();
  for (const pr of repoPrs) {
    // Prefer coord's own `proposal_status`; fall back to the queue join on
    // `(repo, head_sha)` for coord deploys that emit neither verdict field.
    const linked: LinkedProposal | null = pr.proposal_status
      ? { status: pr.proposal_status, ageSecs: pr.proposal_age_secs ?? null }
      : (proposalByHead.get(`${pr.repo}@${pr.head_sha}`) ?? null);
    const status = effectiveMergeStatus(pr, linked);
    let code = STATUS_TO_REASON[status];
    if (!code) continue;
    // Promote a long-lived conflict to a strand — a different problem with a
    // different fix (the PR needs a human, not another rebase attempt).
    if (
      code === "conflicts" &&
      pr.conflict_age_secs != null &&
      pr.conflict_age_secs > STRAND_SECS
    ) {
      code = "conflict-strand";
    }
    push(buckets, code, pr);
  }

  for (const [code, bucketPrs] of buckets) {
    let prsIn = bucketPrs;
    // The orchestrator-stalled bucket is enriched below from health, which has
    // a real readiness-onset clock. Skip the generic path only for the PRs
    // health ALREADY covers — coord's `ready_unmerged` is tenant-scoped and
    // may be narrower than this bucket, and dropping the whole bucket made
    // those extra PRs vanish from the reasons entirely rather than merge.
    if (code === "orchestrator-stalled" && ready.length > 0) {
      const covered = new Set(ready.map((r) => r.pr_number));
      const uncovered = prsIn.filter((p) => !covered.has(p.pr_number));
      if (uncovered.length === 0) continue;
      prsIn = uncovered;
    }
    const meta =
      code === "orchestrator-stalled"
        ? { label: "Ready but unlanded", severity: "blocking" as PauseSeverity }
        : REASON_META[code as keyof typeof REASON_META];
    if (!meta) continue;

    // Only the conflict buckets have a real age. `last_refreshed_at` is when
    // coord last re-HYDRATED the row (bounded by the freshness TTL, minutes at
    // most) — not how long the PR has been red or pending. Reporting it as an
    // age rendered "CI red 1 · 4m" for a PR that had been red three days, and
    // sorted idle repos by hydration staleness. No age is better than a wrong
    // one, so the chip simply omits the duration for the other buckets.
    const ages =
      code === "conflict-strand" || code === "conflicts"
        ? prsIn
            .map((pr) => pr.conflict_age_secs ?? null)
            .filter((a): a is number => a != null)
        : [];

    reasons.push({
      code,
      severity: meta.severity,
      label: meta.label,
      detail: detailFor(code, prsIn),
      prCount: prsIn.length,
      oldestSecs: ages.length ? Math.max(...ages) : null,
      prNumbers: prsIn.map((p) => p.pr_number).sort((a, b) => a - b),
    });
  }

  // Health-derived orchestrator stall — the authoritative version, with a
  // readiness-onset age and coord's own error text for the head.
  const oldest = ready[0];
  if (oldest) {
    const withError = ready.find((r) => r.latest_proposal_error);
    const detail = withError?.latest_proposal_error
      ? `coord judges ${ready.length} PR${ready.length === 1 ? "" : "s"} ready ` +
        `but ${ready.length === 1 ? "it is" : "they are"} unlanded. Latest ` +
        `proposal error: ${redactSecrets(withError.latest_proposal_error)}`
      : `coord judges ${ready.length} PR${ready.length === 1 ? "" : "s"} ready ` +
        `(CLEAN, checks complete, no blocking label) but ` +
        `${ready.length === 1 ? "it is" : "they are"} still unlanded` +
        `${
          hasInFlight
            ? " — a proposal IS in flight, so this may just be slot contention."
            : " and NO proposal is in flight. This is the orchestrator stalling."
        }`;
    reasons.push({
      code: "orchestrator-stalled",
      severity: "blocking",
      label: "Ready but unlanded",
      detail,
      prCount: ready.length,
      oldestSecs: oldest.age_seconds ?? null,
      prNumbers: ready.map((r) => r.pr_number).sort((a, b) => a - b),
    });
  }

  if (reasons.length === 0 && !hasInFlight) {
    reasons.push({
      code: "no-candidates",
      severity: "info",
      label: "No candidates",
      detail:
        repoPrs.length === 0
          ? "No open PRs — the train has nothing to do for this repo."
          : `${repoPrs.length} open PR${repoPrs.length === 1 ? "" : "s"}, none ` +
            `currently eligible to land.`,
      prCount: repoPrs.length,
      oldestSecs: null,
      prNumbers: [],
    });
  }

  return reasons.sort((a, b) => REASON_RANK[a.code] - REASON_RANK[b.code]);
}

function detailFor(code: PauseReasonCode, prs: PrRow[]): string {
  const n = prs.length;
  const plural = n === 1 ? "" : "s";
  switch (code) {
    case "ci-failed": {
      const contexts = [
        ...new Set(prs.flatMap((p) => p.failing_contexts ?? [])),
      ].slice(0, 4);
      return contexts.length
        ? `${n} PR${plural} with red CI (${contexts.join(", ")}). Nothing can ` +
            `be proposed until they go green.`
        : `${n} PR${plural} with red CI — not proposable until green.`;
    }
    case "ci-pending": {
      const contexts = [
        ...new Set(prs.flatMap((p) => p.pending_contexts ?? [])),
      ].slice(0, 4);
      return contexts.length
        ? `${n} PR${plural} still running checks (${contexts.join(", ")}). ` +
            `This is a normal wait — long CI is the usual cause of long gaps.`
        : `${n} PR${plural} still running checks — a normal wait.`;
    }
    case "conflict-strand":
      return (
        `${n} PR${plural} stranded in conflict for over a day. coord will ` +
        `keep re-proposing and failing; ${n === 1 ? "it needs" : "they need"} ` +
        `a manual rebase.`
      );
    case "conflicts": {
      // Absent `conflict_age_secs` is NO EVIDENCE, not evidence of freshness —
      // coord omits it on older deploys and on any PR with no conflict
      // proposal at its head. Claiming "needs a rebase" flatly would quietly
      // assert the PR is not stranded, which is the very inference the strand
      // promotion exists to avoid.
      const unknownAge = prs.every((p) => p.conflict_age_secs == null);
      return (
        `${n} PR${plural} conflict with main and need a rebase before the ` +
        `train can take ${n === 1 ? "it" : "them"}.` +
        (unknownAge
          ? " coord reported no conflict age, so how long they have been this" +
            " way is unknown — they may be stranded."
          : "")
      );
    }
    case "behind-base":
      return `${n} PR${plural} behind base — needs an update before landing.`;
    case "review-required":
      return `${n} PR${plural} awaiting review approval or a required check.`;
    case "blast-radius-block":
      return (
        `${n} PR${plural} blocked by the blast-radius gate (removes a ` +
        `referenced export).`
      );
    case "draft":
      return `${n} draft PR${plural} — intentionally held, not a stall.`;
    // Reached only when coord's health read is unavailable, so there is no
    // readiness-onset clock and no proposal error to quote — but this is the
    // single most important reason, so it still gets real copy.
    case "orchestrator-stalled":
      return (
        `${n} PR${plural} green, CLEAN and unlanded with no fresh merge ` +
        `proposal. The train should have taken ${n === 1 ? "it" : "them"}.`
      );
    default:
      return `${n} PR${plural}.`;
  }
}

function headlineFor(
  activity: TrainActivity,
  reasons: PauseReason[],
  openPrCount: number
): string {
  if (activity.kind !== "idle") {
    const dwell = formatDuration(activity.dwellSecs);
    const behind = activity.behind > 0 ? `, ${activity.behind} behind it` : "";
    return `${activity.label} for ${dwell}${behind}`;
  }
  const top = reasons[0];
  if (!top) {
    return openPrCount === 0 ? "Nothing to do" : "Idle";
  }
  if (top.code === "no-candidates") return top.detail;
  const age =
    top.oldestSecs != null ? `, oldest ${formatDuration(top.oldestSecs)}` : "";
  return `Idle — ${top.prCount || ""} ${top.label.toLowerCase()}${age}`.replace(
    /\s+/g,
    " "
  );
}

/**
 * Busiest and most-broken first: a repo the train is actively working sorts
 * above one that is merely blocked, and blocking reasons sort above waiting
 * ones.
 *
 * Within a tie, active rows order by phase dwell. IDLE rows order by the top
 * reason's age where one exists — but most reasons now carry no age at all
 * (only the conflict buckets and the capacity/health-derived ones have a real
 * clock; reporting a hydration timestamp as an age was worse than reporting
 * none), so idle ties commonly fall through to the repo name. That is
 * deliberate: a stable alphabetical order beats one keyed on a number that
 * does not mean what it says.
 */
function compareRepoRows(a: RepoTrainRow, b: RepoTrainRow): number {
  const active =
    Number(b.activity.kind !== "idle") - Number(a.activity.kind !== "idle");
  if (active !== 0) return active;

  const SEV: Record<PauseSeverity, number> = {
    blocking: 0,
    waiting: 1,
    info: 2,
  };
  const sev = SEV[a.severity] - SEV[b.severity];
  if (sev !== 0) return sev;

  if (a.activity.kind !== "idle" && b.activity.kind !== "idle") {
    return (b.activity.dwellSecs ?? 0) - (a.activity.dwellSecs ?? 0);
  }
  const aOldest = a.reasons[0]?.oldestSecs ?? 0;
  const bOldest = b.reasons[0]?.oldestSecs ?? 0;
  if (aOldest !== bOldest) return bOldest - aOldest;
  return a.repo.localeCompare(b.repo);
}
