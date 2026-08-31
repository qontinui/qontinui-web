"use client";

// ============================================================================
// MergePipeline — the fleet page's hero: one unified view of every PR and
// what the merge system is doing to it.
// ============================================================================
//
// Fleet-page redesign (qontinui-dev-notes/prompts/
// coord-fleet-page-redesign-2026-07-14.md). Replaces the MergeTrain card's
// split "PR Outer State" / proposal-queue presentation:
//   - an always-visible traffic-light health strip (derived, never fetched),
//   - one row per PR with ONE plain-language status (prPipeline.ts owns the
//     derivation; coordinator jargon never reaches a primary surface),
//   - expandable per-row detail: why, what to do, links (GitHub PR,
//     merge-candidate CI run, agent session), attempt history, raw ids,
//   - multi-repo proposals as grouped rows with per-repo sub-rows,
//   - the actionable side-channels (suggestions, gate decisions) and the raw
//     proposal stream demoted to a collapsed "Merge internals" section.

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  RotateCcw,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import Link from "next/link";
// The console primitives (plan
// `2026-08-16-coord-console-ui-unification-pipeline-style.md` Phase 1). This
// surface is where the Pipeline style was invented, so it is also the
// reference consumer: every rule R1-R7 it demonstrates now goes through the
// primitive that owns that rule, and `MergePipeline.test.tsx` — unmodified —
// is the proof the extraction changed nothing.
import {
  CollapsiblePanel,
  FilterTabs,
  HealthStrip,
  RecordDetail,
  RecordList,
  RecordRow,
  type HealthBadge,
} from "@/components/console";
import {
  AUTHOR_GLYPH_KINDS,
  RowTime,
  StatusBadge,
  STATUS_BADGE_CLASS,
  type StatusPalette,
} from "@/components/console/statusRow";
import {
  GateDecisionCounts,
  GateDecisionRow,
  MergeTrainRow,
  SuggestionCard,
} from "./MergeTrain";
import { PrDraftStateControl } from "./PrDraftStateControl";
import { MergeTrainActivity } from "./MergeTrainActivity";
import { MergeDependencyGraph } from "./MergeDependencyGraph";
import { relativeTime } from "./utils";
import {
  MERGED_LOOKBACK_HOURS,
  useMergePipelineData,
} from "./useMergePipelineData";
import { useTrainHealth } from "./useTrainHealth";
import { usePrCheckDetails } from "./usePrCheckDetails";
import { buildRepoTrainRows, buildTrainSummary } from "./trainActivity";
import { redactSecrets } from "./mergeTypes";
import type { MergeEconomics } from "./mergeTypes";
import {
  buildPipelineRows,
  derivePipelineHealth,
  matchesFilter,
  matchesQuery,
  singleKey,
  UNKNOWN_DWELL_NOTE,
  unstableHasFailure,
  type PipelineFilter,
  type PipelineRow,
  type UnifiedStatusKind,
} from "./prPipeline";

// ----------------------------------------------------------------------------
// Status visuals.
//
// The palette rule, the colour families, the badge and the row timestamp all
// live in `@/components/console/statusRow` now — they are shared with the
// coord Alerts tab, which renders the same "one row per entity, ONE
// plain-language status" shape. `STATUS_BADGE_CLASS` and `AUTHOR_GLYPH_KINDS`
// are re-exported here because they are this surface's palette and its callers
// (and tests) address them by this module; the implementation is
// single-sourced so the two surfaces cannot drift.
// ----------------------------------------------------------------------------

export {
  AUTHOR_GLYPH_KINDS,
  STATUS_BADGE_CLASS,
} from "@/components/console/statusRow";

/**
 * This surface's palette. `ATTENTION_BY_KIND` (prPipeline.ts) is the shared
 * audit table and a unit test asserts every entry here agrees with it, so the
 * severity model and the palette can never drift apart.
 */
const PIPELINE_PALETTE: StatusPalette<UnifiedStatusKind> = {
  badgeClass: STATUS_BADGE_CLASS,
  authorGlyphKinds: AUTHOR_GLYPH_KINDS,
  // `✓` is the landed marker; the merged tab is a record of lands.
  doneGlyphKinds: new Set<UnifiedStatusKind>(["merged"]),
  unknownNote: UNKNOWN_DWELL_NOTE,
};

/**
 * The pipeline's timestamp: a merged row reports its LAND time (what the
 * merged tab is a record of); every other row reports its last state change.
 * A merged row from a coord deploy that does not project `merged_at` says so
 * rather than passing a refresh time off as a merge time.
 */
function PipelineRowTime({ row }: { row: PipelineRow }) {
  const isMerged = row.status.kind === "merged";
  return (
    <RowTime
      at={isMerged ? row.mergedAt : row.updatedAt}
      verb={isMerged ? "Merged" : "Updated"}
      prefix={
        isMerged ? (
          <span className="text-green-300/80">merged </span>
        ) : undefined
      }
      absent={
        isMerged
          ? {
              label: "merged",
              title: "coord did not report a merge time for this PR",
            }
          : null
      }
    />
  );
}

function prHref(repo: string, prNumber: number): string {
  return `https://github.com/${repo}/pull/${prNumber}`;
}

function commitHref(repo: string, sha: string): string {
  return `https://github.com/${repo}/commit/${sha}`;
}

/** The coord close_cause of a rebase fast-forward land. */
const FF_LAND_CLOSE_CAUSE = "commits_landed_via_other_pr";

// ----------------------------------------------------------------------------
// Health strip
// ----------------------------------------------------------------------------

/**
 * This surface's R1 health strip: derive the verdict from the rows already on
 * the page (never a second fetch), then hand `{level, headline, detail,
 * badges}` to the shared `<HealthStrip>`. The derivation is what is specific
 * to the merge pipeline; the strip itself is not, so only the derivation lives
 * here.
 */
function PipelineHealthStrip({
  rows,
  economicsByRepo,
  loaded,
  onShowAttention,
}: {
  rows: PipelineRow[];
  economicsByRepo: Record<string, MergeEconomics>;
  loaded: boolean;
  onShowAttention: () => void;
}) {
  const health = useMemo(
    () => derivePipelineHealth(rows, Date.now(), economicsByRepo),
    [rows, economicsByRepo]
  );
  const badges: HealthBadge[] = [
    { key: "queue", label: `queue ${health.queueDepth}` },
    { key: "in-flight", label: `in flight ${health.inFlight}` },
  ];
  if (health.needsAttention > 0) {
    badges.push({
      key: "needs-attention",
      label: `needs attention ${health.needsAttention}`,
      tone: "attention",
      onClick: onShowAttention,
    });
  }
  badges.push({
    key: "last-merged",
    label: `last merged ${relativeTime(health.lastMergedAt)}`,
    tone: "muted",
  });

  return (
    <HealthStrip
      data-testid="pipeline-health"
      level={health.level}
      headline={loaded ? health.headline : "Connecting…"}
      detail={health.detail}
      badges={badges}
    />
  );
}

// ----------------------------------------------------------------------------
// Row + expandable detail
// ----------------------------------------------------------------------------

/** Conclusions that are NOT failures — everything else gets a red row. */
const PASSING_CONCLUSIONS = ["success", "neutral", "skipped"];

/**
 * Named failing checks with a link to each run. Fetches coord's per-check
 * breakdown on expansion (usePrCheckDetails — once per head sha, no
 * polling); while the fetch is in flight or if it fails, the row's own
 * `failing_contexts` names render as plain chips so the operator never
 * stares at a blank panel.
 */
function FailingChecks({ row }: { row: PipelineRow }) {
  const hasFailure = row.pr !== null && unstableHasFailure(row.pr);
  const { checks, loading, error } = usePrCheckDetails(
    row.repo,
    row.prNumber,
    hasFailure,
    row.pr?.head_sha ?? null
  );
  if (!hasFailure || row.pr === null) return null;

  // Only COMPLETED non-passing runs — a still-running check is not "failing".
  const failed =
    !loading && error === null && checks !== null
      ? checks.filter(
          (c) =>
            c.conclusion !== null && !PASSING_CONCLUSIONS.includes(c.conclusion)
        )
      : null;
  const fallbackNames = row.pr.failing_contexts ?? [];
  // Nothing to name (older coord omits failing_contexts and the fetch
  // hasn't produced names) — the status reason already covers the aggregate.
  if ((failed === null || failed.length === 0) && fallbackNames.length === 0)
    return null;

  const chipClass =
    "font-mono text-[11px] bg-red-500/15 text-red-200 border-red-500/35";
  return (
    <div className="space-y-1" data-testid="failing-checks">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground m-0">
        Failing checks
      </p>
      {failed !== null && failed.length > 0 ? (
        <div className="space-y-1">
          {failed.map((c) => (
            <div
              key={c.name}
              className="flex flex-wrap items-center gap-2"
              data-testid="failing-check-row"
            >
              <Badge variant="outline" className={chipClass}>
                {c.name}
              </Badge>
              {c.completed_at && (
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {relativeTime(c.completed_at)}
                </span>
              )}
              {c.details_url && (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={c.details_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    View run
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        // Fetch in flight or failed — name the checks from the row itself.
        <div className="flex flex-wrap gap-1.5">
          {fallbackNames.map((name) => (
            <Badge key={name} variant="outline" className={chipClass}>
              {name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * How a landed PR reached its base branch — shown in the detail view a click
 * earns, next to the GitHub link. coord lands by rebase fast-forward
 * (close_cause `commits_landed_via_other_pr`): it pushes the rebased commits
 * straight to the base branch, so GitHub closes the PR as *Closed, not Merged*
 * even though the code landed. That appearance is the fleet's #1 "did this
 * actually merge?" confusion, so we spell it out — but only when close_cause
 * confirms the ff-land. An absent close_cause (older coord) shows the landed
 * commit + time with no caveat, never a claim we can't back.
 */
function LandedDetail({ row }: { row: PipelineRow }) {
  if (row.status.kind !== "merged" || row.pr === null) return null;
  const sha = row.pr.merge_commit_sha ?? null;
  const base = row.baseBranch ?? row.pr.base_branch ?? "the base branch";
  const ffLand = row.pr.close_cause === FF_LAND_CLOSE_CAUSE;
  return (
    <div className="space-y-1" data-testid="landed-detail">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground m-0">
        How it landed
      </p>
      <p className="text-[13px] text-foreground/85 m-0">
        {ffLand
          ? `Landed on ${base} by coord (rebase fast-forward)`
          : `Merged into ${base}`}
        {sha && (
          <>
            {" as "}
            <a
              href={commitHref(row.repo, sha)}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-primary hover:underline"
              data-testid="landed-commit-link"
            >
              {sha.slice(0, 7)}
            </a>
          </>
        )}
        {row.pr.merged_at && (
          <span className="text-muted-foreground">
            {" · "}
            {relativeTime(row.pr.merged_at)}
          </span>
        )}
      </p>
      {ffLand && (
        <p
          className="text-[11px] text-muted-foreground m-0"
          data-testid="ff-land-note"
        >
          coord lands by pushing the rebased commits straight to {base}, so
          GitHub shows this PR <span className="font-medium">Closed</span>, not{" "}
          <span className="font-medium">Merged</span> — the commits are on{" "}
          {base}.
        </p>
      )}
    </div>
  );
}

function RowDetail({
  row,
  onActed,
}: {
  row: PipelineRow;
  onActed: () => void;
}) {
  const active = row.activeProposal;
  const earlier = row.attempts.filter(
    (a) => a.proposal_id !== active?.proposal_id
  );
  // The five R5 slots, in the order `<RecordDetail>` fixes them: why →
  // problems → actions → history → raw. Each slot is a fragment, so the
  // panel's `space-y-3` spaces the real content nodes exactly as it did when
  // this markup was one inline <div>.
  return (
    <RecordDetail
      why={
        <>
          {/* why, in plain language */}
          {row.status.reason && (
            <p className="text-[13px] text-foreground/85 m-0">
              {row.status.reason}
            </p>
          )}
          {/* The four-word inline marker, spelled out. The glyph is what
              survives the scan; this is what the operator reads once it has
              earned a click. Muted, not red — an unknown age accuses nobody. */}
          {row.status.dwellEvidence === "unknown" && (
            <p
              className="text-xs text-muted-foreground flex items-center gap-1 m-0"
              data-testid="unknown-dwell-note"
            >
              <ShieldQuestion className="h-3 w-3 shrink-0" />
              {UNKNOWN_DWELL_NOTE}
            </p>
          )}
          {active?.error && active.error !== row.status.reason && (
            <p className="text-xs text-red-300 flex items-center gap-1 m-0">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {redactSecrets(active.error)}
            </p>
          )}
        </>
      }
      problems={
        <>
          {/* how a landed PR reached its base branch (explains ff-land closes) */}
          <LandedDetail row={row} />

          {/* which checks failed, with links to the runs */}
          <FailingChecks row={row} />

          {/* The cross-repo dependency DAG for THIS PR, keyed on the row —
              no repo field, no PR field, nothing to re-type.

              The collapse lives HERE rather than inside the graph component,
              and that placement is the whole point: `CollapsiblePanel`
              unmounts its children, so while this is closed the graph
              component does not exist and its fetch never fires. When the
              graph owned its own panel, its mount effect sat ABOVE the
              collapsed content and every expanded row cost a request. Only one
              row expands at a time (`expandedKey`), so at most one graph is
              ever mounted. */}
          {row.prNumber !== null && (
            <CollapsiblePanel
              titleAs="h3"
              data-testid="merge-dep-graph"
              storageKey="pipeline:dep-graph"
              defaultOpen={false}
              icon={<GitBranch className="h-4 w-4" />}
              title="Cross-repo PR dependency graph"
            >
              <MergeDependencyGraph repo={row.repo} pr={row.prNumber} />
            </CollapsiblePanel>
          )}

          {/* The merge-side half of resolved Q4: the alembic reservation queue
              is a Dev Ops resource, and this is the link that carries the need
              back here. Deliberately worded as a place to look rather than a
              claim about this PR — coord's queue read
              (`GET /coord/migrations/queue?repo=`) carries no PR number, so
              nothing on this surface can join a reservation to a row. Saying
              "this PR is waiting on a migration slot" would be fabricating the
              join. */}
          {(row.status.kind === "queued" || row.status.kind === "blocked") && (
            <p
              className="text-[11px] text-muted-foreground m-0"
              data-testid="pipeline-migration-queue-link"
            >
              A PR carrying an alembic migration also waits for a reservation
              slot, and coord&rsquo;s queue carries no PR number — so this is a
              place to look, not a verdict on this PR:{" "}
              <Link
                href="/admin/coord/migrations"
                className="underline hover:text-foreground"
              >
                migration queue
              </Link>
              .
            </p>
          )}
        </>
      }
      actions={
        <>
          {/* what you can do / where to look */}
          <div className="flex flex-wrap items-center gap-2">
            {row.prNumber !== null && (
              <Button asChild size="sm" variant="outline">
                <a
                  href={prHref(row.repo, row.prNumber)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <GitPullRequest className="h-3.5 w-3.5" />
                  GitHub PR
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
            {row.ciRunUrl && (
              <Button asChild size="sm" variant="outline">
                <a
                  href={row.ciRunUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Candidate CI run
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            )}
            {row.agentId && (
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/agent-sessions">
                  Agent {row.agentId.slice(0, 8)}
                </Link>
              </Button>
            )}
            <PrDraftStateControl
              repo={row.repo}
              prNumber={row.prNumber}
              prState={row.pr?.pr_state}
              hasActiveProposal={row.activeProposal !== null}
              onActed={onActed}
            />
          </div>

          {/* CI-on-candidate education — the #1 recurring confusion */}
          {row.status.kind === "awaiting-ci" && (
            <p className="text-[11px] text-muted-foreground m-0">
              Checks run on coord&rsquo;s merge candidate, not on your branch —
              your PR&rsquo;s own green checkmarks can be stale.
              {row.ciRunUrl
                ? " The candidate run linked above is the one that counts."
                : ""}
            </p>
          )}
        </>
      }
      history={
        active ? (
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            <p className="m-0">
              Attempt started {relativeTime(active.created_at)}
              {typeof active.requeue_count === "number" &&
                active.requeue_count > 0 && (
                  <span className="text-orange-200">
                    {" "}
                    <RotateCcw className="inline h-3 w-3" /> requeued ×
                    {active.requeue_count}
                  </span>
                )}
            </p>
            {earlier.length > 0 && (
              <p className="m-0">
                {earlier.length} earlier attempt
                {earlier.length === 1 ? "" : "s"}:{" "}
                {earlier.map((a) => a.status).join(", ")}
              </p>
            )}
          </div>
        ) : null
      }
      raw={
        /* raw state for support/debugging — the ONLY place internals show */
        <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
          {active && (
            <>
              proposal {active.proposal_id} · {active.status}
            </>
          )}
          {row.pr && (
            <>
              {active && " · "}
              {row.pr.merge_state_status ?? "?"} · mergeable=
              {String(row.pr.mergeable)} ·{" "}
              {row.pr.review_decision ?? "no review"} · CI{" "}
              {row.pr.ci_lifecycle ?? "?"}
              {row.pr.ci_conclusion ? `/${row.pr.ci_conclusion}` : ""}
            </>
          )}
        </p>
      }
    />
  );
}

function GroupMembers({ row }: { row: PipelineRow }) {
  if (!row.members) return null;
  return (
    <div className="border border-t-0 border-border rounded-b-md bg-card/50">
      {row.members.map((m) => (
        <div
          key={`${m.repo.repo}::${m.repo.branch}`}
          className="flex items-center gap-3 pl-8 pr-3 py-1.5 border-t border-border/60 text-xs"
        >
          <Badge variant="outline" className="font-mono text-[11px]">
            {m.pr
              ? `${m.repo.repo.split("/").pop()}#${m.pr.pr_number}`
              : m.repo.repo.split("/").pop()}
          </Badge>
          <span className="text-muted-foreground truncate">
            {m.repo.branch}
          </span>
          {m.repo.ci_run_url && (
            <a
              href={m.repo.ci_run_url}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-primary hover:underline inline-flex items-center gap-1"
            >
              candidate run <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

function PipelineRowDisplay({
  row,
  expanded,
  onToggle,
  onActed,
}: {
  row: PipelineRow;
  expanded: boolean;
  onToggle: () => void;
  onActed: () => void;
}) {
  return (
    <RecordRow
      data-testid="pipeline-row"
      rowKey={row.key}
      expanded={expanded}
      onToggle={onToggle}
      attention={row.status.attention}
      identity={
        row.members
          ? `${row.members.length}-repo change`
          : row.prNumber !== null
            ? `${row.repoShort}#${row.prNumber}`
            : row.repoShort
      }
      label={
        <>
          <span className="text-foreground/90">{row.branch}</span>
          {row.baseBranch && (
            <span className="text-muted-foreground"> → {row.baseBranch}</span>
          )}
          {row.members && (
            <span className="text-muted-foreground">
              {" "}
              ·{" "}
              {row.members.map((m) => m.repo.repo.split("/").pop()).join(" + ")}
            </span>
          )}
        </>
      }
      status={<StatusBadge status={row.status} palette={PIPELINE_PALETTE} />}
      reason={row.status.reason}
      time={<PipelineRowTime row={row} />}
    >
      <RowDetail row={row} onActed={onActed} />
      <GroupMembers row={row} />
    </RecordRow>
  );
}

// ----------------------------------------------------------------------------
// Filter tabs
// ----------------------------------------------------------------------------

const FILTERS: Array<{ id: PipelineFilter; label: string }> = [
  { id: "all", label: "All PRs" },
  { id: "attention", label: "Needs attention" },
  { id: "in-flight", label: "In flight" },
  // Landing history, newest-merge-first. Populated from coord's
  // `?include_merged=<hours>` rows (see MERGED_LOOKBACK_HOURS).
  { id: "merged", label: "Merged" },
  // Row-per-REPO view of the merge train itself — see MergeTrainActivity.
  // Not a filter over the PR rows, so it renders its own component and its
  // tab count is repos-with-activity, not PRs.
  { id: "train", label: "Train" },
];
// A "My PRs" tab needs pr_author from coord's /pr-merge/prs join (today the
// queue only carries agent_id) — backend follow-up per the redesign report §4.

// ----------------------------------------------------------------------------
// The panel
// ----------------------------------------------------------------------------

export function MergePipeline() {
  // Declared before the data hook: the merged rows are an expensive read, so
  // the hook only fetches them while this tab is the visible one.
  const [filter, setFilter] = useState<PipelineFilter>("all");

  const {
    proposals,
    prs,
    mergedPrs,
    mergedCount,
    economicsByRepo,
    suggestions,
    gateBlocks,
    gateTotalBlocks,
    gateTotalEvals,
    error,
    suggestionBusy,
    onSuggestionAction,
    refetch,
  } = useMergePipelineData({ includeMerged: filter === "merged" });

  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Merge-train liveness — its own hook on its own slower cadence, and only
  // while the Train tab is open (coord's health read scales with the
  // ready-unmerged backlog, and every dashboard request pins a backend DB
  // connection for its whole lifetime).
  const { health: trainHealth, loaded: trainHealthLoaded } = useTrainHealth(
    filter === "train"
  );

  const loaded = proposals !== null && prs !== null;
  const rows = useMemo(() => {
    // The merged read returns landed rows the open poll can ALSO be carrying:
    // an ff-landed PR sits "phantom-open" (GitHub never auto-closed it) until
    // coord's straggler sweep, so it is in both lists at once. The merged row
    // is the truthful one — it knows the PR landed — so it wins, and the open
    // copy is dropped. Without this the same PR renders twice, once as live
    // work, under a colliding row key.
    //
    // Keyed by `singleKey` — the SAME identity buildPipelineRows gives the row
    // and React renders it under, so what is collapsed here is exactly what
    // would collide there. (PR number is the tempting key and the wrong one:
    // it is not what collides.)
    const merged = mergedPrs ?? [];
    const landed = new Set(merged.map((p) => singleKey(p.repo, p.branch)));
    const open = (prs ?? []).filter(
      (p) => !landed.has(singleKey(p.repo, p.branch))
    );
    return buildPipelineRows(
      [...open, ...merged],
      proposals ?? [],
      economicsByRepo
    );
  }, [prs, mergedPrs, proposals, economicsByRepo]);

  // Row-per-repo train state. Derived from the SAME queue + PR data the other
  // tabs use (plus health), so opening the tab costs one extra read, not a
  // second copy of the pipeline.
  const trainRows = useMemo(
    () => buildRepoTrainRows(proposals ?? [], prs ?? [], trainHealth),
    [proposals, prs, trainHealth]
  );
  const trainSummary = useMemo(
    () => buildTrainSummary(trainHealth, trainRows),
    [trainHealth, trainRows]
  );

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [
          f.id,
          // The Train tab counts repos the train is actively working, not PRs
          // — a PR count there would be meaningless against a per-repo list.
          f.id === "train"
            ? trainRows.filter((r) => r.activity.kind !== "idle").length
            : rows.filter((r) => matchesFilter(r, f.id)).length,
        ])
      ) as Record<PipelineFilter, number>,
    [rows, trainRows]
  );
  const visible = useMemo(
    () =>
      rows.filter((r) => matchesFilter(r, filter) && matchesQuery(r, query)),
    [rows, filter, query]
  );

  const showSuggestions = suggestions !== null && suggestions.length > 0;
  const showGateDecisions = gateBlocks !== null && gateBlocks.length > 0;

  return (
    <section className="space-y-3" data-testid="merge-pipeline">
      <PipelineHealthStrip
        rows={rows}
        economicsByRepo={economicsByRepo}
        loaded={loaded}
        onShowAttention={() => setFilter("attention")}
      />

      {/* tabs + search (R6). The `–`-not-`0` rule lives in `<FilterTabs>`:
          pass `null` for a count nobody has fetched and the primitive renders
          the dash.

          The merged ROWS are only fetched while that tab is open, so until
          then `counts.merged` would be 0 for want of looking, not because
          nothing landed. coord answers the cheap half — `merged_recent_count`
          — on the hot poll, so the label is a real number from the first
          render; `null` (coord too old to answer, or its count failed) is the
          genuinely unknown case and becomes the dash.

          The two numbers count the same landings but not the same things:
          coord counts landed PRs, `counts.merged` counts RENDERED rows, and a
          landed MULTI-REPO proposal renders a summary row on top of its member
          PR rows. So opening the tab can nudge the number up by the number of
          such groups — pre-existing row-model behavior, not a stale count. */}
      <FilterTabs<PipelineFilter>
        tabs={FILTERS.map((f) => ({
          id: f.id,
          label: f.label,
          count:
            f.id === "merged" && mergedPrs === null
              ? mergedCount
              : counts[f.id],
          attention: f.id === "attention" && counts[f.id] > 0,
        }))}
        active={filter}
        onChange={setFilter}
        testIdPrefix="pipeline-filter"
        query={query}
        onQueryChange={setQuery}
        queryPlaceholder="filter: repo, branch, #number…"
        queryTestId="pipeline-search"
      />

      {error && <p className="text-xs text-red-300">{error}</p>}

      {/* The Train tab is a row-per-REPO view of the merge train itself, not a
          filter over the PR rows — so it replaces the list entirely. */}
      {filter === "train" ? (
        <MergeTrainActivity
          summary={trainSummary}
          rows={trainRows}
          loaded={loaded}
          healthLoaded={trainHealthLoaded}
          query={query}
          onActed={refetch}
        />
      ) : (
        <RecordList
          items={visible}
          itemKey={(row) => row.key}
          loaded={loaded}
          // The empty state names WHICH question came back empty — "nothing
          // landed in the window" is a different claim from "nothing matches
          // your filter", and from "there is no pipeline". The primitive
          // cannot know that, so the surface supplies it.
          empty={
            <p
              className="text-sm text-muted-foreground italic py-4 text-center"
              data-testid="pipeline-empty"
            >
              {filter === "merged"
                ? `Nothing merged in the last ${MERGED_LOOKBACK_HOURS} hours.`
                : rows.length === 0
                  ? "No open PRs or merge activity."
                  : "No PRs match this filter."}
            </p>
          }
          // Hoisted rather than left internal: the Train tab REPLACES the
          // list, so an internally-held key would be lost on every visit to
          // it and the operator's open row would silently close.
          expandedKey={expandedKey}
          onExpandedKeyChange={setExpandedKey}
          renderRow={(row, { expanded, onToggle }) => (
            <PipelineRowDisplay
              row={row}
              expanded={expanded}
              onToggle={onToggle}
              onActed={refetch}
            />
          )}
        />
      )}

      {/* actionable side-channels — visible only when non-empty */}
      {showSuggestions && suggestions && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
            <ShieldAlert className="h-3 w-3" />
            Suggestions
            <Badge variant="outline" className="ml-1 font-mono text-[10px]">
              {suggestions.length}
            </Badge>
          </h4>
          <div className="space-y-2">
            {suggestions.map((sug) => (
              <SuggestionCard
                key={sug.alert_id}
                sug={sug}
                busy={suggestionBusy === sug.alert_id}
                onAction={onSuggestionAction}
              />
            ))}
          </div>
        </div>
      )}
      {showGateDecisions && gateBlocks && (
        <div data-testid="gate-decisions">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
            <ShieldQuestion className="h-3 w-3" />
            Gate decisions
            <GateDecisionCounts
              totalBlocks={gateTotalBlocks}
              totalEvals={gateTotalEvals}
            />
          </h4>
          <div className="space-y-2">
            {gateBlocks.map((b) => (
              <GateDecisionRow
                key={`${b.repo}#${b.pr_number}@${b.at}`}
                block={b}
              />
            ))}
            {/* What this list IS, said once rather than left to be inferred.
                Coord's Phase 2 (plan 2026-08-20-predicate-eval-surface-counts-
                evals-not-decisions) returns the newest row per PR, so the
                population became "PRs the gate has held inside coord's
                retention window" — a PR unblocked weeks ago still appears,
                carrying its own last-seen timestamp. A row is an audit record
                of a decision, NOT an assertion that the PR is held right now,
                and that was already true of the pre-Phase-2 raw-row list. So
                this is stated unconditionally: unlike the header counts, it
                does not depend on which coord is answering. */}
            <p className="text-[11px] text-muted-foreground pt-1">
              Coverage labels reflect how complete the code graph was when the
              gate ran — a degraded decision is never authoritative. Each row is
              the most recent time the gate reached that decision, within
              coord&apos;s retention window; a PR listed here is not necessarily
              still held.
            </p>
          </div>
        </div>
      )}

      {/* raw scheduler stream, for maintainers — collapsed by default */}
      <CollapsiblePanel
        storageKey="fleet:merge-internals"
        defaultOpen={false}
        icon={<GitMerge className="h-4 w-4" />}
        title="Merge internals"
        summary={
          proposals && (
            <Badge variant="outline" className="ml-2 font-mono text-xs">
              {proposals.length} proposals
            </Badge>
          )
        }
      >
        {/* The cross-repo dependency DAG used to be linked from here by a
            `#merge-dep-graph` anchor into a standalone panel that then asked
            for the repo and PR number by hand. It lives in each row's own
            expansion now, keyed on that row (Phase 4 of
            `2026-08-25-coord-console-intent-and-devops-sections`). */}
        <p className="text-[11px] text-muted-foreground mb-2">
          Raw scheduler proposals, one per attempt (the unified list above
          collapses these per PR). A PR&rsquo;s cross-repo dependency DAG is in
          that PR&rsquo;s own row — expand the row and open &ldquo;Cross-repo PR
          dependency graph&rdquo;.
        </p>
        {proposals && proposals.length > 0 ? (
          <div className="space-y-2">
            {proposals.map((p) => (
              <MergeTrainRow key={p.proposal_id} proposal={p} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No in-flight proposals.
          </p>
        )}
      </CollapsiblePanel>
    </section>
  );
}
