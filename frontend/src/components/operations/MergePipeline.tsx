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
//   - multi-repo proposals as grouped rows with per-repo sub-rows.
//
// ============================================================================
// 2026-09-19 — ONE LIST, ONE AXIS
// ============================================================================
//
// The surface had grown into FOUR per-PR lists stacked vertically, in four
// vocabularies, over overlapping populations, which the operator joined by
// reading `repo#number` with their eyes:
//
//   the pipeline rows | Suggestions | Gate decisions | Merge internals
//
// ...and then a fifth list below them on a different axis entirely
// (`CiStatusPanel`, one row per REPO). Each addition was locally reasonable
// and the sum was a page that answers "where is my PR?" five times.
//
// The rule this redesign applies: **anything that is about a PR belongs in
// that PR's row; anything that is about all of them belongs in the health
// strip; anything on a different axis belongs on the view that owns that
// axis.** What is left over is audit residue, and it goes behind ONE
// disclosure rather than becoming a section.
//
// Concretely, and each of the three named sections had a distinct defect:
//
//  - **Gate decisions — was a second list, and it was not what it looked
//    like.** Its own footnote admitted a listed PR "is not necessarily still
//    held": coord returns the newest decision per PR within its retention
//    window, so the section was an AUDIT LOG rendered directly beneath a LIVE
//    list, in the position that reads as "and these are also blocked". It is
//    now three things in their right places — the decision for a listed PR is
//    evidence inside that row (`GateDecisionDetail`), the tenant-wide count is
//    a health-strip badge carrying its own provenance caveat, and decisions
//    whose PR is not on this page at all are the residue (`Coord internals`).
//
//  - **Merge internals — was a duplicate.** `buildPipelineRows` already emits
//    a row for every proposal INCLUDING proposal-only ones with no PR, and
//    every attempt rides `row.attempts`. So the raw stream re-rendered, in
//    scheduler vocabulary, rows that were already on screen. The per-attempt
//    facts it uniquely showed (each attempt's status, age, requeue count and
//    error — not just the active one's) moved into the row's own history slot,
//    which previously said `"queued, conflict"` and now says when and why. The
//    stream itself survives as a nested, collapsed-by-default disclosure for
//    maintainers, so nothing is lost — it is just no longer a section.
//
//  - **CI status — was on the wrong axis, and it polled while collapsed.**
//    See `CiRepoStrip`'s header; it now lives on the Train tab, which is
//    already the repo-axis view, and it owns its own transport so a visitor
//    who never opens that tab pays nothing for it.
//
// Net effect on the page: five top-level sections become two (the list, and
// one collapsed residue panel), and the row gained the three things an
// operator previously had to scroll and cross-reference to find.

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
  AUTHOR_RED,
  RowTime,
  StatusBadge,
  STATUS_BADGE_CLASS,
  type StatusPalette,
} from "@/components/console/statusRow";
import {
  GateDecisionCounts,
  GateDecisionDetail,
  GateDecisionRow,
  MergeTrainRow,
  SuggestionCard,
} from "./MergeTrain";
import {
  gateBlockKey,
  gateProvenanceTitle,
  indexGateBlocks,
  unattachedGateBlocks,
} from "./gateDecision";
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
import type { BlastRadiusBlock, MergeEconomics } from "./mergeTypes";
import {
  buildPipelineRows,
  candidateChurnBadgeLabel,
  candidateChurnBadgeTitle,
  deriveCandidateChurn,
  derivePipelineHealth,
  fusePipelinePrs,
  matchesFilter,
  matchesQuery,
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
  gateTotalBlocks,
  gateTotalEvals,
  onShowAttention,
}: {
  rows: PipelineRow[];
  economicsByRepo: Record<string, MergeEconomics>;
  loaded: boolean;
  gateTotalBlocks: number | null;
  gateTotalEvals: number | null;
  onShowAttention: () => void;
}) {
  const health = useMemo(
    () => derivePipelineHealth(rows, Date.now(), economicsByRepo),
    [rows, economicsByRepo]
  );
  const churn = useMemo(
    () => deriveCandidateChurn(economicsByRepo),
    [economicsByRepo]
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
  // Candidate-CI waste (plan
  // 2026-07-27-coord-green-candidates-discarded-always-zero): merge candidates
  // whose CI went green and were then discarded. ALWAYS rendered — when no
  // repo measured it (or the economics read failed) the badge reads
  // "unknown" rather than disappearing, because an absent number on a page
  // about waste reads as "no waste", which is the failure mode the plan
  // documented. `attention` only when there IS measured waste; unknown is not
  // an alarm, it is an admission.
  badges.push({
    key: "green-discarded",
    label: candidateChurnBadgeLabel(churn),
    tone:
      churn.greenDiscarded !== null && churn.greenDiscarded > 0
        ? "attention"
        : "muted",
    title: candidateChurnBadgeTitle(churn),
    "data-testid": "pipeline-green-discarded",
  });
  // The blast-radius gate's tenant-wide reading. This is the SIGNAL half of
  // the deleted "Gate decisions" section (R7: secondary material may lose its
  // section, never its signal) — the per-PR half went into the rows.
  //
  // Rendered only when coord answered at all: `null` is "not fetched / read
  // failed", and a badge reading `gate holds 0` on that basis would be a
  // false all-clear. A measured 0 IS a fact and prints.
  //
  // `gateProvenanceTitle` carries the honesty the section's header badge used
  // to: against a pre-Phase-2 coord this number may be a raw audit-row count
  // rather than a count of held PRs, and the hover says so rather than the
  // label asserting "decisions" it cannot substantiate.
  if (gateTotalBlocks !== null) {
    badges.push({
      key: "gate-holds",
      label: `gate holds ${gateTotalBlocks}`,
      tone: gateTotalBlocks > 0 ? "attention" : "muted",
      title: gateProvenanceTitle(gateTotalBlocks, gateTotalEvals),
      "data-testid": "pipeline-gate-holds",
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
    `font-mono text-[11px] ${AUTHOR_RED}`;
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

/**
 * Every attempt coord made on this PR, newest first — the replacement for the
 * page-level "Merge internals" stream.
 *
 * The old slot rendered two lines: `Attempt started {created_at}` for the
 * ACTIVE attempt, then `earlier.map(a => a.status).join(", ")` for the rest —
 * so the earlier attempts were a list of bare words with no when and no why,
 * and a reader chasing "why did this requeue four times?" had to leave the
 * row, scroll to a flat cross-PR list, and find this PR's proposals by eye.
 * The fix for the duplicate section is to make the row answer the question.
 *
 * **Both timestamps are rendered, for every attempt, and that is deliberate
 * rather than thorough.** They are different facts and the gap between them is
 * the interesting one: a proposal that has sat queued for six hours while
 * coord re-ticks it has a `created_at` six hours old and an `updated_at`
 * minutes old. Nothing else on the page recovers that — the row's dwell
 * escalation (`escalateIfStale`) clocks the PrRow, never the proposal — so
 * dropping `created_at` here would have made a stalled attempt indistinguishable
 * from a fresh one everywhere on the surface.
 *
 * The ACTIVE attempt is rendered by the caller above this (it owns the row's
 * status); this lists it too, marked, because "the current attempt is the
 * third" is the fact the list is read for.
 */
function AttemptHistory({ row }: { row: PipelineRow }) {
  const active = row.activeProposal;
  if (row.attempts.length === 0) return null;
  return (
    <div
      className="text-[11px] text-muted-foreground space-y-0.5"
      data-testid="attempt-history"
    >
      <p className="m-0">
        {row.attempts.length} merge attempt
        {row.attempts.length === 1 ? "" : "s"}
      </p>
      {row.attempts.map((a) => (
        <p
          key={a.proposal_id}
          className="m-0 flex items-center gap-1.5 flex-wrap"
          data-testid="attempt-row"
          data-proposal-id={a.proposal_id}
        >
          <span
            className={
              a.proposal_id === active?.proposal_id
                ? "text-foreground/85 font-medium"
                : undefined
            }
          >
            {a.status}
          </span>
          {/* Labelled, because two bare relative times side by side are not
              readable as "how long it has been trying" and "when it last
              moved" — which is the whole reason both are here. */}
          <span className="tabular-nums" data-testid="attempt-started">
            started {relativeTime(a.created_at)}
          </span>
          <span className="tabular-nums">
            updated {relativeTime(a.updated_at)}
          </span>
          {typeof a.requeue_count === "number" && a.requeue_count > 0 && (
            <span className="text-orange-200">
              <RotateCcw className="inline h-3 w-3" /> ×{a.requeue_count}
            </span>
          )}
          {/* Redacted at the boundary, same as every other place a coord
              error string reaches the DOM. An earlier attempt's error is the
              one thing the flat stream showed that nothing else did. */}
          {a.error && (
            <span className="text-red-300 truncate" title={redactSecrets(a.error)}>
              {redactSecrets(a.error)}
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

function RowDetail({
  row,
  gateBlock,
  onActed,
}: {
  row: PipelineRow;
  /** coord's blast-radius decision for THIS PR, when it has one. */
  gateBlock: BlastRadiusBlock | null;
  onActed: () => void;
}) {
  const active = row.activeProposal;
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
          {/* Ordered by what must be acted on, not by what is cheapest to
              render. The gate is first because it is the only blocker here
              that no amount of waiting clears: a held PR needs the removed
              export restored or its callers updated. */}
          {gateBlock && <GateDecisionDetail block={gateBlock} />}

          {/* which checks failed, with links to the runs */}
          <FailingChecks row={row} />

          {/* how a landed PR reached its base branch (explains ff-land closes) */}
          <LandedDetail row={row} />

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
                <Link href="/sessions">
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
      history={<AttemptHistory row={row} />}
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
  gateBlock,
  expanded,
  onToggle,
  onActed,
}: {
  row: PipelineRow;
  gateBlock: BlastRadiusBlock | null;
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
      <RowDetail row={row} gateBlock={gateBlock} onActed={onActed} />
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
    // ONE row per PR, across AND within the two reads — see `fusePipelinePrs`.
    //
    // This used to be built here by hand, and it collapsed only `open` against
    // `merged`. That missed the case coord actually serves: `?include_merged=`
    // returns the phantom-open copy of an ff-landed PR and its landed twin in
    // the SAME response, so both arrive inside `mergedPrs` where an
    // array-vs-array subtraction never looks. The PR then rendered twice under
    // a colliding React key (operator-reported 2026-09-20).
    //
    // The collapse is keyed by `singleKey` — the SAME identity
    // `buildPipelineRows` gives the row and React renders it under, so what is
    // collapsed is exactly what would collide. (PR number is the tempting key
    // and the wrong one: it is not what collides.)
    return buildPipelineRows(
      fusePipelinePrs(prs ?? [], mergedPrs ?? []),
      proposals ?? [],
      economicsByRepo
    );
  }, [prs, mergedPrs, proposals, economicsByRepo]);

  // Row-per-repo train state. Derived from the SAME queue + PR data the other
  // tabs use (plus health), so opening the tab costs one extra read, not a
  // second copy of the pipeline.
  // `economicsByRepo` rides along for the per-repo churn readings — the same
  // map the health strip and the severity model already read, not a second
  // fetch.
  const trainRows = useMemo(
    () =>
      buildRepoTrainRows(
        proposals ?? [],
        prs ?? [],
        trainHealth,
        Date.now(),
        economicsByRepo
      ),
    [proposals, prs, trainHealth, economicsByRepo]
  );
  const trainSummary = useMemo(
    () =>
      buildTrainSummary(trainHealth, trainRows, Date.now(), economicsByRepo),
    [trainHealth, trainRows, economicsByRepo]
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

  // The gate join (see gateDecision.ts). Built over EVERY row the page holds,
  // never the FILTERED ones — `matchesFilter` must not move a decision between
  // "in a row" and "residue".
  //
  // ONE honest caveat, because the obvious stronger claim is false: the tab
  // does move the boundary, via the DATA rather than the filter. `mergedPrs`
  // is fetched only while the Merged tab is open (`includeMerged` above — that
  // read is expensive enough to have taken the API down once), so a decision
  // on a PR that landed inside the lookback window counts as unlisted on the
  // other tabs and attaches to its row when Merged is opened. There is no
  // client-side fix: the rows genuinely have not been fetched. Naming it here
  // is the alternative to a comment that would read as a guarantee.
  const gateByPr = useMemo(() => indexGateBlocks(gateBlocks), [gateBlocks]);
  const presentPrKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows) {
      if (r.prNumber !== null) keys.add(gateBlockKey(r.repo, r.prNumber));
      // Insurance, NOT a live requirement — stated precisely because the
      // plausible-sounding version ("without this, a group's members read as
      // residue") is false today. `buildPipelineRows` gives every member PR
      // its OWN single-PR row: a group proposal is keyed by the combined
      // repo-set key, so the member never consumes its own `singleKey` and
      // the PR loop emits it independently. Every key this adds, `:prNumber`
      // above already added. It stays so that a future row model which DOES
      // fold members into the group row cannot silently strand their gate
      // decisions.
      for (const m of r.members ?? []) {
        if (m.pr) keys.add(gateBlockKey(m.repo.repo, m.pr.pr_number));
      }
    }
    return keys;
  }, [rows]);
  const orphanGateBlocks = useMemo(
    () => unattachedGateBlocks(gateBlocks, presentPrKeys),
    [gateBlocks, presentPrKeys]
  );

  const showSuggestions = suggestions !== null && suggestions.length > 0;

  return (
    <section className="space-y-3" data-testid="merge-pipeline">
      <PipelineHealthStrip
        rows={rows}
        economicsByRepo={economicsByRepo}
        loaded={loaded}
        gateTotalBlocks={gateTotalBlocks}
        gateTotalEvals={gateTotalEvals}
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
              gateBlock={
                row.prNumber === null
                  ? null
                  : (gateByPr.get(gateBlockKey(row.repo, row.prNumber)) ?? null)
              }
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
      {/* ------------------------------------------------------------------
          Coord internals — ONE disclosure for everything that is coord state
          with no PR row on this page to attach it to.

          This replaces both the "Gate decisions" section and the "Merge
          internals" section. What they had in common, and what nobody had
          said out loud, is that each was a list of coord records the operator
          was expected to join to the live list themselves. The records that
          CAN be joined now are (they are in their rows); what is left here is
          genuinely unattached, which is a much smaller and much more honest
          population.

          Collapsed by default and `CollapsiblePanel` unmounts its children,
          so on a normal day this costs one line of chrome and nothing else.
          R7's signal rule is satisfied by the summary badges, which stay
          visible while closed, and by the health strip's `gate holds N`.
          ------------------------------------------------------------------ */}
      <CollapsiblePanel
        storageKey="fleet:coord-internals"
        defaultOpen={false}
        icon={<GitMerge className="h-4 w-4" />}
        title="Coord internals"
        data-testid="coord-internals"
        summary={
          <>
            {orphanGateBlocks.length > 0 && (
              <Badge
                variant="outline"
                className="ml-2 font-mono text-[10px] normal-case"
                data-testid="coord-internals-orphan-gates"
                title="Gate decisions whose PR is not in the list above — closed, or outside the window this page reads."
              >
                {orphanGateBlocks.length} unlisted
              </Badge>
            )}
            {proposals && (
              <Badge
                variant="outline"
                className="ml-1 font-mono text-[10px] normal-case text-muted-foreground"
              >
                {proposals.length} proposals
              </Badge>
            )}
          </>
        }
      >
        <div className="space-y-4">
          {/* ---- gate decisions with no row above -------------------------
              The counts are tenant-wide and belong with the honesty copy that
              qualifies them, which is why `GateDecisionCounts` stays here
              rather than following the badge onto the strip: the strip has
              room for a number and a tooltip, not for the paragraph that says
              what the number is NOT. */}
          <div data-testid="gate-decisions">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
              <ShieldQuestion className="h-3 w-3" />
              Gate decisions
              <GateDecisionCounts
                totalBlocks={gateTotalBlocks}
                totalEvals={gateTotalEvals}
              />
            </h4>
            {orphanGateBlocks.length > 0 ? (
              <div className="space-y-2">
                {orphanGateBlocks.map((b) => (
                  <GateDecisionRow
                    key={`${b.repo}#${b.pr_number}@${b.at}`}
                    block={b}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground m-0">
                Every gate decision coord returned belongs to a PR in the list
                above, and is shown inside that PR&rsquo;s row.
              </p>
            )}
            {/* What these records ARE, said once rather than left to be
                inferred. Coord's Phase 2 (plan 2026-08-20-predicate-eval-
                surface-counts-evals-not-decisions) returns the newest row per
                PR, so the population is "PRs the gate has held inside coord's
                retention window" — a PR unblocked weeks ago still appears,
                carrying its own last-seen timestamp. A row is an audit record
                of a decision, NOT an assertion that the PR is held right now,
                and that was already true of the pre-Phase-2 raw-row list. So
                this is stated unconditionally: unlike the header counts, it
                does not depend on which coord is answering. */}
            <p className="text-[11px] text-muted-foreground pt-1 m-0">
              Coverage labels reflect how complete the code graph was when the
              gate ran — a degraded decision is never authoritative. Each row is
              the most recent time the gate reached that decision, within
              coord&apos;s retention window; a PR listed here is not necessarily
              still held.
            </p>
          </div>

          {/* ---- the raw scheduler stream --------------------------------
              Kept, and nested one level deeper, because deleting a
              maintainer's escape hatch to make a page tidier is a trade the
              page does not get to make on their behalf. What changed is its
              RANK: it is no longer a top-level section competing with the live
              list, because every proposal it shows is already a row up there
              (`buildPipelineRows` emits proposal-only rows too) and every
              attempt is in that row's history. Nested + collapsed means it is
              unmounted unless someone deliberately asks for it. */}
          <CollapsiblePanel
            titleAs="h3"
            storageKey="fleet:raw-proposals"
            defaultOpen={false}
            title="Raw scheduler proposals"
            data-testid="raw-proposals"
            summary={
              proposals && (
                <Badge
                  variant="outline"
                  className="ml-2 font-mono text-[10px] normal-case"
                >
                  {proposals.length}
                </Badge>
              )
            }
          >
            <p className="text-[11px] text-muted-foreground mb-2 m-0">
              One entry per attempt, flat and in scheduler vocabulary. The list
              above already collapses these per PR, and a PR&rsquo;s own
              attempts — with their errors and requeue counts — are in that
              row&rsquo;s detail; this is the cross-PR ordering, for reading
              what the scheduler did rather than what happened to one PR.
            </p>
            {proposals && proposals.length > 0 ? (
              <div className="space-y-2">
                {proposals.map((p) => (
                  <MergeTrainRow key={p.proposal_id} proposal={p} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground m-0">
                No in-flight proposals.
              </p>
            )}
          </CollapsiblePanel>
        </div>
      </CollapsiblePanel>
    </section>
  );
}
