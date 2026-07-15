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
  | "requirements"
  | "checks-failing"
  | "draft"
  | "unknown";

/** Who (if anyone) the status is waiting on — drives the row accent. */
export type Attention = "author" | "waiting" | "none";

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
        reason: "about to merge",
        attention: "none",
      };
    case "merged":
      return { kind: "merged", label: "Merged", reason: "", attention: "none" };
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
 * Status for a PR with NO active merge attempt — GitHub's view decides.
 * Precedence (report §C/§7): draft > merged/closed > behind-main (the
 * actionable "your CI is stale" case) > hard-unmergeable > blocked
 * requirements > failing checks > clean.
 */
function statusFromGitHub(pr: PrRow): UnifiedStatus {
  if (pr.pr_state === "draft" || pr.merge_state_status === "DRAFT") {
    return {
      kind: "draft",
      label: "Draft",
      reason: "not in the pipeline until marked ready",
      attention: "none",
    };
  }
  if (pr.pr_state === "merged") {
    return { kind: "merged", label: "Merged", reason: "", attention: "none" };
  }
  if (pr.merge_state_status === "BEHIND") {
    return {
      kind: "needs-rebase",
      label: "Needs rebase",
      reason: "behind main — green CI here is stale",
      attention: "author",
    };
  }
  if (pr.mergeable === false || pr.merge_state_status === "DIRTY") {
    return {
      kind: "not-mergeable",
      label: "Not mergeable",
      reason: "GitHub reports a merge conflict with main",
      attention: "author",
    };
  }
  if (pr.merge_state_status === "BLOCKED") {
    const reason =
      pr.review_decision === "CHANGES_REQUESTED"
        ? "changes requested in review"
        : pr.review_decision === "REVIEW_REQUIRED"
          ? "review required"
          : pr.required_checks_satisfied === false
            ? "required checks not satisfied"
            : "branch protection requirements not met";
    return {
      kind: "requirements",
      label: "Blocked by requirements",
      reason,
      attention: "author",
    };
  }
  if (
    pr.merge_state_status === "UNSTABLE" ||
    (pr.ci_lifecycle === "complete" && pr.ci_conclusion === "failure")
  ) {
    return {
      kind: "checks-failing",
      label: "Checks failing",
      reason: "a check is failing on the branch",
      attention: "author",
    };
  }
  if (pr.merge_state_status === "CLEAN") {
    return {
      kind: "ready",
      label: "Ready",
      reason: "waiting for coord to pick it up",
      attention: "none",
    };
  }
  return {
    kind: "unknown",
    label: "Syncing",
    reason: "waiting for fresh GitHub data",
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

export function buildPipelineRows(
  prs: PrRow[],
  proposals: ProposalDetail[]
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
    const status = active ? statusFromProposal(active) : statusFromGitHub(pr);
    rows.push({
      key,
      repo: pr.repo,
      repoShort: shortRepo(pr.repo),
      prNumber: pr.pr_number,
      branch: pr.branch,
      baseBranch: pr.base_branch,
      status,
      updatedAt: active ? active.updated_at : pr.last_refreshed_at,
      pr,
      activeProposal: active,
      attempts,
      ciRunUrl:
        active?.repos.find((r) => r.ci_run_url)?.ci_run_url ??
        attempts
          .flatMap((a) => a.repos)
          .find((r) => r.ci_run_url)?.ci_run_url ??
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
    rows.push({
      key,
      repo: first.repo,
      repoShort: shortRepo(first.repo),
      prNumber: null,
      branch: first.branch,
      baseBranch: null,
      status: statusFromProposal(active),
      updatedAt: active.updated_at,
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
    row.status = { ...row.status, reason: ordinal(i + 1) + " in line" };
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
  "not-mergeable": 0,
  requirements: 0,
  "checks-failing": 0,
  "needs-rebase": 0,
  blocked: 1,
  landing: 2,
  "awaiting-ci": 3,
  rebasing: 4,
  queued: 5,
  ready: 6,
  unknown: 7,
  draft: 8,
  merged: 9,
};

function compareRows(a: PipelineRow, b: PipelineRow): number {
  const rank = KIND_RANK[a.status.kind] - KIND_RANK[b.status.kind];
  if (rank !== 0) return rank;
  return (
    new Date(b.updatedAt ?? 0).getTime() - new Date(a.updatedAt ?? 0).getTime()
  );
}

// ----------------------------------------------------------------------------
// Filtering
// ----------------------------------------------------------------------------

export type PipelineFilter = "all" | "attention" | "in-flight";

export function matchesFilter(row: PipelineRow, f: PipelineFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "attention":
      return row.status.attention !== "none";
    case "in-flight": {
      const s = row.activeProposal?.status;
      return s !== undefined && !TERMINAL.has(s);
    }
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
/** Requeue count at which leader-takeover churn reads as an infra problem. */
export const REQUEUE_CHURN_THRESHOLD = 3;

export function derivePipelineHealth(
  rows: PipelineRow[],
  nowMs: number
): PipelineHealth {
  const active = rows
    .map((r) => r.activeProposal)
    .filter((p): p is ProposalDetail => p !== null && !TERMINAL.has(p.status));

  const conflicts = active.filter((p) => p.status === "conflict").length;
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

  let lastMergedAt: string | null = null;
  for (const r of rows) {
    for (const p of r.attempts) {
      if (p.merged_at && (!lastMergedAt || p.merged_at > lastMergedAt)) {
        lastMergedAt = p.merged_at;
      }
    }
  }

  const oldestCiWaitMs = Math.max(
    0,
    ...active
      .filter((p) => p.status === "awaiting-ci")
      .map((p) => nowMs - new Date(p.updated_at).getTime())
  );
  const newestActivityAgoMs =
    active.length > 0
      ? Math.min(
          ...active.map((p) => nowMs - new Date(p.updated_at).getTime())
        )
      : 0;
  const churning = active.some(
    (p) => (p.requeue_count ?? 0) >= REQUEUE_CHURN_THRESHOLD
  );

  const redReasons: string[] = [];
  const amberReasons: string[] = [];

  if (conflicts >= 2) redReasons.push(`${conflicts} conflicts accumulating`);
  else if (conflicts === 1) amberReasons.push("1 conflict");
  if (blocked > 0)
    amberReasons.push(`${blocked} waiting on overlapping PR${blocked === 1 ? "" : "s"}`);
  if (oldestCiWaitMs > CI_WAIT_RED_MS)
    redReasons.push(`oldest CI wait ${formatDurationShort(oldestCiWaitMs)}`);
  else if (oldestCiWaitMs > CI_WAIT_AMBER_MS)
    amberReasons.push(`oldest CI wait ${formatDurationShort(oldestCiWaitMs)}`);
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
    redReasons.length > 0
      ? "red"
      : amberReasons.length > 0
        ? "amber"
        : "green";
  return {
    level,
    headline:
      level === "red"
        ? "Pipeline stuck"
        : level === "amber"
          ? "Pipeline slow"
          : "Merging normally",
    detail: [...redReasons, ...amberReasons].join(" · "),
    queueDepth: active.length,
    inFlight,
    needsAttention,
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
