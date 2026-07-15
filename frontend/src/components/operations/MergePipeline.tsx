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
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  RotateCcw,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import Link from "next/link";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { GateDecisionRow, MergeTrainRow, SuggestionCard } from "./MergeTrain";
import { relativeTime } from "./utils";
import { useMergePipelineData } from "./useMergePipelineData";
import {
  buildPipelineRows,
  derivePipelineHealth,
  matchesFilter,
  matchesQuery,
  type PipelineFilter,
  type PipelineRow,
  type UnifiedStatusKind,
} from "./prPipeline";

// ----------------------------------------------------------------------------
// Status visuals — one color family per unified status. Same palette
// direction as the old proposal tints so returning operators keep their
// color instincts: green=done/ready, blue=landing, yellow=CI, purple=coord
// testing, red=needs the author, orange/amber=waiting on something else.
// ----------------------------------------------------------------------------

const STATUS_BADGE_CLASS: Record<UnifiedStatusKind, string> = {
  merged: "bg-green-500/15 text-green-200 border-green-500/30",
  landing: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  "awaiting-ci": "bg-yellow-500/15 text-yellow-200 border-yellow-500/30",
  rebasing: "bg-purple-500/15 text-purple-200 border-purple-500/30",
  queued: "bg-muted text-muted-foreground border-border",
  ready: "bg-green-500/5 text-green-300 border-green-500/25",
  conflict: "bg-red-500/15 text-red-200 border-red-500/35",
  "not-mergeable": "bg-red-500/15 text-red-200 border-red-500/35",
  requirements: "bg-red-500/15 text-red-200 border-red-500/35",
  "checks-failing": "bg-amber-500/15 text-amber-200 border-amber-500/30",
  // In-flight, not a failure: checks are merely still running — muted, so it
  // never reads as the red/amber "author must act" family.
  "checks-pending": "bg-muted text-muted-foreground border-border",
  blocked: "bg-orange-500/15 text-orange-200 border-orange-500/30",
  "needs-rebase": "bg-amber-500/15 text-amber-200 border-amber-500/30",
  draft: "bg-transparent text-muted-foreground border-border border-dashed",
  unknown: "bg-muted text-muted-foreground border-border",
};

/** Left-edge accent: red = the author must act, amber = waiting on others. */
function rowAccentClass(row: PipelineRow): string {
  if (row.status.attention === "author")
    return "border-l-2 border-l-red-500/80";
  if (row.status.attention === "waiting")
    return "border-l-2 border-l-amber-500/80";
  return "";
}

function StatusBadge({ row }: { row: PipelineRow }) {
  return (
    <Badge
      variant="outline"
      className={`text-[11px] font-semibold whitespace-nowrap ${STATUS_BADGE_CLASS[row.status.kind]}`}
      data-status-kind={row.status.kind}
    >
      {row.status.kind === "merged" && "✓ "}
      {(row.status.kind === "conflict" ||
        row.status.kind === "not-mergeable") &&
        "✕ "}
      {row.status.label}
    </Badge>
  );
}

function prHref(repo: string, prNumber: number): string {
  return `https://github.com/${repo}/pull/${prNumber}`;
}

// ----------------------------------------------------------------------------
// Health strip
// ----------------------------------------------------------------------------

const LIGHT_CLASS = {
  green: "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)] animate-pulse",
  amber: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.8)]",
  red: "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)]",
} as const;

const HEADLINE_CLASS = {
  green: "text-foreground",
  amber: "text-amber-200",
  red: "text-red-200",
} as const;

function HealthStrip({
  rows,
  loaded,
  onShowAttention,
}: {
  rows: PipelineRow[];
  loaded: boolean;
  onShowAttention: () => void;
}) {
  const health = useMemo(
    () => derivePipelineHealth(rows, Date.now()),
    [rows]
  );
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border bg-card/30 px-4 py-2.5 flex-wrap ${
        health.level === "red"
          ? "border-red-500/40"
          : health.level === "amber"
            ? "border-amber-500/35"
            : "border-border"
      }`}
      data-testid="pipeline-health"
      data-health-level={health.level}
    >
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full shrink-0 ${LIGHT_CLASS[health.level]}`}
        aria-hidden
      />
      <span
        className={`text-[13px] font-semibold ${HEADLINE_CLASS[health.level]}`}
      >
        {loaded ? health.headline : "Connecting…"}
      </span>
      {health.detail && (
        <span className="text-xs text-muted-foreground">{health.detail}</span>
      )}
      <span className="ml-auto flex items-center gap-2">
        <Badge variant="outline" className="font-mono text-[11px]">
          queue {health.queueDepth}
        </Badge>
        <Badge variant="outline" className="font-mono text-[11px]">
          in flight {health.inFlight}
        </Badge>
        {health.needsAttention > 0 && (
          <button type="button" onClick={onShowAttention} className="contents">
            <Badge
              variant="outline"
              className="font-mono text-[11px] text-red-200 border-red-500/35 cursor-pointer"
            >
              needs attention {health.needsAttention}
            </Badge>
          </button>
        )}
        <Badge
          variant="outline"
          className="font-mono text-[11px] text-muted-foreground"
        >
          last merged {relativeTime(health.lastMergedAt)}
        </Badge>
      </span>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Row + expandable detail
// ----------------------------------------------------------------------------

function RowDetail({ row }: { row: PipelineRow }) {
  const active = row.activeProposal;
  const earlier = row.attempts.filter(
    (a) => a.proposal_id !== active?.proposal_id
  );
  return (
    <div className="border border-t-0 border-border rounded-b-md bg-card px-4 py-3 space-y-3 text-sm">
      {/* why, in plain language */}
      {row.status.reason && (
        <p className="text-[13px] text-foreground/85 m-0">
          {row.status.reason}
        </p>
      )}
      {active?.error && active.error !== row.status.reason && (
        <p className="text-xs text-red-300 flex items-center gap-1 m-0">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {active.error}
        </p>
      )}

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
            <a href={row.ciRunUrl} target="_blank" rel="noopener noreferrer">
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
      </div>

      {/* CI-on-candidate education — the #1 recurring confusion */}
      {row.status.kind === "awaiting-ci" && (
        <p className="text-[11px] text-muted-foreground m-0">
          Checks run on coord&rsquo;s merge candidate, not on your branch —
          your PR&rsquo;s own green checkmarks can be stale.
          {row.ciRunUrl ? " The candidate run linked above is the one that counts." : ""}
        </p>
      )}

      {/* attempt history */}
      {active && (
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
              {earlier.length} earlier attempt{earlier.length === 1 ? "" : "s"}
              : {earlier.map((a) => a.status).join(", ")}
            </p>
          )}
        </div>
      )}

      {/* raw state for support/debugging — the ONLY place internals show */}
      <p className="m-0 font-mono text-[10px] text-muted-foreground/60 break-all">
        {active && <>proposal {active.proposal_id} · {active.status}</>}
        {row.pr && (
          <>
            {active && " · "}
            {row.pr.merge_state_status ?? "?"} · mergeable=
            {String(row.pr.mergeable)} · {row.pr.review_decision ?? "no review"}{" "}
            · CI {row.pr.ci_lifecycle ?? "?"}
            {row.pr.ci_conclusion ? `/${row.pr.ci_conclusion}` : ""}
          </>
        )}
      </p>
    </div>
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
}: {
  row: PipelineRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div data-testid="pipeline-row" data-row-key={row.key}>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center gap-3 px-3 py-2 border border-border rounded-md bg-card/30 hover:bg-accent/60 transition-colors text-left ${rowAccentClass(
          row
        )} ${expanded ? "rounded-b-none bg-accent/60" : ""}`}
        aria-expanded={expanded}
      >
        <Badge variant="outline" className="font-mono text-xs shrink-0">
          {row.members
            ? `${row.members.length}-repo change`
            : row.prNumber !== null
              ? `${row.repoShort}#${row.prNumber}`
              : row.repoShort}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="text-foreground/90">{row.branch}</span>
          {row.baseBranch && (
            <span className="text-muted-foreground"> → {row.baseBranch}</span>
          )}
          {row.members && (
            <span className="text-muted-foreground">
              {" "}
              · {row.members.map((m) => m.repo.repo.split("/").pop()).join(" + ")}
            </span>
          )}
        </span>
        <StatusBadge row={row} />
        {row.status.reason && !expanded && (
          <span className="hidden lg:inline text-xs text-muted-foreground truncate max-w-[26ch]">
            {row.status.reason}
          </span>
        )}
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {relativeTime(row.updatedAt)}
        </span>
        <Chevron className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
      {expanded && (
        <>
          <RowDetail row={row} />
          <GroupMembers row={row} />
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Filter tabs
// ----------------------------------------------------------------------------

const FILTERS: Array<{ id: PipelineFilter; label: string }> = [
  { id: "all", label: "All PRs" },
  { id: "attention", label: "Needs attention" },
  { id: "in-flight", label: "In flight" },
];
// A "My PRs" tab needs pr_author from coord's /pr-merge/prs join (today the
// queue only carries agent_id) — backend follow-up per the redesign report §4.

// ----------------------------------------------------------------------------
// The panel
// ----------------------------------------------------------------------------

export function MergePipeline() {
  const {
    proposals,
    prs,
    suggestions,
    gateBlocks,
    gateTotalBlocks,
    error,
    suggestionBusy,
    onSuggestionAction,
  } = useMergePipelineData();

  const [filter, setFilter] = useState<PipelineFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loaded = proposals !== null && prs !== null;
  const rows = useMemo(
    () => buildPipelineRows(prs ?? [], proposals ?? []),
    [prs, proposals]
  );
  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [
          f.id,
          rows.filter((r) => matchesFilter(r, f.id)).length,
        ])
      ) as Record<PipelineFilter, number>,
    [rows]
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
      <HealthStrip
        rows={rows}
        loaded={loaded}
        onShowAttention={() => setFilter("attention")}
      />

      {/* tabs + search */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <Button
            key={f.id}
            size="sm"
            variant={filter === f.id ? "secondary" : "ghost"}
            onClick={() => setFilter(f.id)}
            data-testid={`pipeline-filter-${f.id}`}
          >
            {f.label}
            <span
              className={`font-mono text-[11px] ${
                f.id === "attention" && counts[f.id] > 0
                  ? "text-red-300"
                  : "text-muted-foreground"
              }`}
            >
              {counts[f.id]}
            </span>
          </Button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter: repo, branch, #number…"
          className="ml-auto w-56 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          data-testid="pipeline-search"
        />
      </div>

      {error && <p className="text-xs text-red-300">{error}</p>}

      {/* the unified list */}
      {!loaded ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : visible.length === 0 ? (
        <p
          className="text-sm text-muted-foreground italic py-4 text-center"
          data-testid="pipeline-empty"
        >
          {rows.length === 0
            ? "No open PRs or merge activity."
            : "No PRs match this filter."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((row) => (
            <PipelineRowDisplay
              key={row.key}
              row={row}
              expanded={expandedKey === row.key}
              onToggle={() =>
                setExpandedKey((k) => (k === row.key ? null : row.key))
              }
            />
          ))}
        </div>
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
            {gateTotalBlocks !== null && (
              <Badge variant="outline" className="ml-1 font-mono text-[10px]">
                {gateTotalBlocks}
              </Badge>
            )}
          </h4>
          <div className="space-y-2">
            {gateBlocks.map((b) => (
              <GateDecisionRow key={`${b.repo}#${b.pr_number}@${b.at}`} block={b} />
            ))}
            <p className="text-[11px] text-muted-foreground pt-1">
              Coverage labels reflect how complete the code graph was when the
              gate ran — a degraded decision is never authoritative.
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
        <p className="text-[11px] text-muted-foreground mb-2">
          Raw scheduler proposals, one per attempt (the unified list above
          collapses these per PR). Cross-repo dependency DAG:{" "}
          <a href="#merge-dep-graph" className="underline hover:text-foreground">
            dependency graph
          </a>
          .
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
