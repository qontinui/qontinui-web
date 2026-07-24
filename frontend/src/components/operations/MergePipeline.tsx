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

import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  PenLine,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldQuestion,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { CollapsiblePanel } from "./CollapsiblePanel";
import { GateDecisionRow, MergeTrainRow, SuggestionCard } from "./MergeTrain";
import { prDraftStateUrl, relativeTime } from "./utils";
import {
  MERGED_LOOKBACK_HOURS,
  useMergePipelineData,
} from "./useMergePipelineData";
import { usePrCheckDetails } from "./usePrCheckDetails";
import type { MergeEconomics } from "./mergeTypes";
import {
  buildPipelineRows,
  derivePipelineHealth,
  matchesFilter,
  matchesQuery,
  unstableHasFailure,
  type PipelineFilter,
  type PipelineRow,
  type UnifiedStatusKind,
} from "./prPipeline";

// ----------------------------------------------------------------------------
// Status visuals.
//
// THE RULE, and the whole point of the palette: **color encodes who has to do
// something, not how alarming the word sounds.** Red is reserved for
// `attention: "author"` — someone must act now. Amber means the row is
// waiting on something else and will clear itself. Everything else is a calm
// in-flight hue (yellow = CI running, purple = coord testing, blue = landing,
// green = ready/done, muted = inert).
//
// Getting this backwards is the bug this table exists to prevent: a red badge
// on "CI hasn't finished" trained the eye to ignore red, while a failed check
// — the one state that genuinely needs a push — sat in amber next to it.
// `ATTENTION_BY_KIND` (prPipeline.ts) is the shared audit table and a unit
// test asserts every entry below agrees with it, so the severity model and
// the palette can never drift apart again.
// ----------------------------------------------------------------------------

/** The three families. A kind may only use the family its attention allows. */
const AUTHOR_RED = "bg-red-500/15 text-red-200 border-red-500/35";
const WAITING_AMBER = "bg-amber-500/15 text-amber-200 border-amber-500/30";
const CI_YELLOW = "bg-yellow-500/15 text-yellow-200 border-yellow-500/30";
const INERT = "bg-muted text-muted-foreground border-border";

export const STATUS_BADGE_CLASS: Record<UnifiedStatusKind, string> = {
  // --- someone must act now → red -------------------------------------------
  conflict: AUTHOR_RED,
  "not-mergeable": AUTHOR_RED,
  requirements: AUTHOR_RED,
  "checks-failing": AUTHOR_RED,
  // --- waiting on something else → amber ------------------------------------
  blocked: WAITING_AMBER,
  "needs-rebase": WAITING_AMBER,
  // A true conflict, de-escalated because coord won't reach this PR for a
  // while: "resolve just-before-merge", not "act now".
  "conflict-deferred": WAITING_AMBER,
  // ...but only for so long. Once the deferral window lapses, coord is
  // demonstrably never reaching this PR and it goes back to red.
  "conflict-stranded": AUTHOR_RED,
  // The other two waiting promises with an expired premise: past the dwell
  // cap the wait is demonstrably not ending on its own — red.
  "needs-rebase-stale": AUTHOR_RED,
  "blocked-stale": AUTHOR_RED,
  // --- in flight / terminal, nobody is blocked → never red or amber ---------
  "awaiting-ci": CI_YELLOW,
  "checks-pending": CI_YELLOW,
  rebasing: "bg-purple-500/15 text-purple-200 border-purple-500/30",
  landing: "bg-blue-500/15 text-blue-200 border-blue-500/30",
  merged: "bg-green-500/15 text-green-200 border-green-500/30",
  ready: "bg-green-500/5 text-green-300 border-green-500/25",
  queued: INERT,
  unknown: INERT,
  draft: "bg-transparent text-muted-foreground border-border border-dashed",
};

/** Left-edge accent: red = the author must act, amber = waiting on others. */
function rowAccentClass(row: PipelineRow): string {
  if (row.status.attention === "author")
    return "border-l-2 border-l-red-500/80";
  if (row.status.attention === "waiting")
    return "border-l-2 border-l-amber-500/80";
  return "";
}

/**
 * The kinds whose badge carries the colourblind-safe `✕` glyph.
 *
 * The rule is deliberately total: EVERY kind whose `ATTENTION_BY_KIND` value
 * is `"author"` is listed — red ⇔ ✕, no hand-picked subset. The glyph is the
 * colourblind-safe marker for "the author must act", and a consistent
 * red-implies-✕ rule beats the previous curated conflict-only list (which
 * meant `checks-failing` / `requirements` rows were red with no glyph, and
 * which web#813 forgot to extend — this list is a string set TypeScript's
 * exhaustive `Record`s cannot check, so a unit test enforces the invariant
 * against `ATTENTION_BY_KIND` instead).
 */
export const AUTHOR_GLYPH_KINDS: ReadonlySet<UnifiedStatusKind> = new Set([
  "conflict",
  "not-mergeable",
  "conflict-stranded",
  "needs-rebase-stale",
  "blocked-stale",
  "checks-failing",
  "requirements",
]);

/**
 * The badge carries its own reason as a `title`, so the "why is this PR
 * blocked?" answer is one hover away on EVERY row — including the narrow
 * viewports where the inline reason is dropped and the wide ones where it is
 * truncated. A native title (rather than a JS tooltip) also survives in the
 * accessibility tree and needs no provider.
 */
function StatusBadge({ row }: { row: PipelineRow }) {
  const { kind, label, reason } = row.status;
  return (
    <Badge
      variant="outline"
      className={`text-[11px] font-semibold whitespace-nowrap ${STATUS_BADGE_CLASS[kind]}`}
      data-status-kind={kind}
      title={reason ? `${label} — ${reason}` : label}
    >
      {kind === "merged" && "✓ "}
      {AUTHOR_GLYPH_KINDS.has(kind) && "✕ "}
      {label}
    </Badge>
  );
}

/** Absolute local timestamp for a `title` — "unknown" reads better than "". */
function absoluteTime(iso: string | null): string {
  if (!iso) return "time unknown";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "time unknown" : d.toLocaleString();
}

/**
 * The right-hand timestamp. A merged row reports its LAND time (what the
 * merged tab is a record of); every other row reports its last state change.
 * A merged row from a coord deploy that does not project `merged_at` says so
 * rather than passing a refresh time off as a merge time.
 */
function RowTime({ row }: { row: PipelineRow }) {
  const isMerged = row.status.kind === "merged";
  if (isMerged && row.mergedAt === null) {
    return (
      <span
        className="text-xs text-muted-foreground/70 italic shrink-0"
        title="coord did not report a merge time for this PR"
        data-testid="row-time"
      >
        merged
      </span>
    );
  }
  const iso = isMerged ? row.mergedAt : row.updatedAt;
  return (
    <span
      className="text-xs text-muted-foreground tabular-nums shrink-0"
      title={`${isMerged ? "Merged" : "Updated"} ${absoluteTime(iso)}`}
      data-testid="row-time"
    >
      {isMerged && <span className="text-green-300/80">merged </span>}
      {relativeTime(iso)}
    </span>
  );
}

function prHref(repo: string, prNumber: number): string {
  return `https://github.com/${repo}/pull/${prNumber}`;
}

const log = createLogger("MergePipeline");

/**
 * Split a row's full `owner/name` repo string into `[owner, name]`.
 * The draft-state coord route addresses the repo by owner + name segments,
 * but the pipeline row carries them joined. Returns null when the string
 * isn't `owner/name` shaped, so the caller can hide the control rather than
 * POST a malformed path.
 */
function splitOwnerRepo(repo: string): [string, string] | null {
  const slash = repo.indexOf("/");
  if (slash <= 0 || slash >= repo.length - 1) return null;
  return [repo.slice(0, slash), repo.slice(slash + 1)];
}

/**
 * Operator draft-state toggle for a single PR row.
 *
 * Gated on the PR's `pr_state`:
 *   - `draft` → "Ready for review" (POST `{draft:false}`), which RELEASES the
 *     PR to coord's merge train. Because that consequence is a surprise for a
 *     draft-required (security-surface) PR, it's behind a confirm dialog that
 *     names the release-to-train outcome.
 *   - `open`  → "Convert to draft" (POST `{draft:true}`), the safe hold; no
 *     confirm needed.
 *   - anything else (merged / closed / unknown) → the control renders nothing.
 *
 * On success it fires a debounced `onActed` refetch so the row's status
 * follows the twin once the `ready_for_review` / `converted_to_draft` webhook
 * reconciles `pr_state`.
 */
function DraftStateButton({
  row,
  onActed,
}: {
  row: PipelineRow;
  onActed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const prState = row.pr?.pr_state;
  const owner = splitOwnerRepo(row.repo);

  const submit = useCallback(
    async (draft: boolean) => {
      if (row.prNumber === null || owner === null) return;
      const [ownerName, repoName] = owner;
      setBusy(true);
      try {
        const res = await httpClient.fetch(
          prDraftStateUrl(ownerName, repoName, row.prNumber),
          { method: "POST", body: JSON.stringify({ draft }) }
        );
        if (!res.ok) {
          const text = await res.text();
          log.warn("draft-state action failed", res.status, text);
          toast.error(
            draft
              ? `Couldn't convert #${row.prNumber} to draft (HTTP ${res.status})`
              : `Couldn't release #${row.prNumber} (HTTP ${res.status})`
          );
          return;
        }
        toast.success(
          draft
            ? `#${row.prNumber} converted to draft — held out of the merge train.`
            : `#${row.prNumber} marked ready for review — coord will land it once CI is green.`
        );
        onActed();
      } catch (err) {
        log.warn("draft-state action threw", err);
        toast.error(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [row.prNumber, owner, onActed]
  );

  // Only surface the toggle when we can act: a real PR number, a splittable
  // `owner/name`, and a draft/open state (never merged/closed).
  if (row.prNumber === null || owner === null) return null;

  if (prState === "draft") {
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
          data-testid="pr-ready-for-review"
        >
          <Send className="h-3.5 w-3.5" />
          Ready for review
        </Button>
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Release #{row.prNumber} to the merge train?
              </AlertDialogTitle>
              <AlertDialogDescription>
                Marking {row.repoShort}#{row.prNumber} ready for review removes
                the draft hold. Once CI is green, coord will land it
                automatically — there is no further review step.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={() => void submit(false)}
              >
                Release to merge train
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  if (prState === "open") {
    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void submit(true)}
        data-testid="pr-convert-to-draft"
      >
        <PenLine className="h-3.5 w-3.5" />
        Convert to draft
      </Button>
    );
  }

  return null;
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

      {/* which checks failed, with links to the runs */}
      <FailingChecks row={row} />

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
        <DraftStateButton row={row} onActed={onActed} />
      </div>

      {/* CI-on-candidate education — the #1 recurring confusion */}
      {row.status.kind === "awaiting-ci" && (
        <p className="text-[11px] text-muted-foreground m-0">
          Checks run on coord&rsquo;s merge candidate, not on your branch — your
          PR&rsquo;s own green checkmarks can be stale.
          {row.ciRunUrl
            ? " The candidate run linked above is the one that counts."
            : ""}
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
              {earlier.length} earlier attempt{earlier.length === 1 ? "" : "s"}:{" "}
              {earlier.map((a) => a.status).join(", ")}
            </p>
          )}
        </div>
      )}

      {/* raw state for support/debugging — the ONLY place internals show */}
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
  onActed,
}: {
  row: PipelineRow;
  expanded: boolean;
  onToggle: () => void;
  onActed: () => void;
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
              ·{" "}
              {row.members.map((m) => m.repo.repo.split("/").pop()).join(" + ")}
            </span>
          )}
        </span>
        <StatusBadge row={row} />
        {row.status.reason && !expanded && (
          // The reason rides beside the badge from `sm` up (it used to appear
          // only at `lg`, which hid the answer to "why?" on most laptops).
          // Below that, and whenever it truncates, the badge's title carries
          // the full text.
          <span
            className="hidden sm:inline text-xs text-muted-foreground truncate max-w-[22ch] lg:max-w-[40ch]"
            title={row.status.reason}
            data-testid="row-reason"
          >
            {row.status.reason}
          </span>
        )}
        <RowTime row={row} />
        <Chevron className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </button>
      {expanded && (
        <>
          <RowDetail row={row} onActed={onActed} />
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
  // Landing history, newest-merge-first. Populated from coord's
  // `?include_merged=<hours>` rows (see MERGED_LOOKBACK_HOURS).
  { id: "merged", label: "Merged" },
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
    economicsByRepo,
    suggestions,
    gateBlocks,
    gateTotalBlocks,
    error,
    suggestionBusy,
    onSuggestionAction,
    refetch,
  } = useMergePipelineData({ includeMerged: filter === "merged" });

  const [query, setQuery] = useState("");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const loaded = proposals !== null && prs !== null;
  const rows = useMemo(
    () =>
      buildPipelineRows(
        [...(prs ?? []), ...(mergedPrs ?? [])],
        proposals ?? [],
        economicsByRepo
      ),
    [prs, mergedPrs, proposals, economicsByRepo]
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
        economicsByRepo={economicsByRepo}
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
              {/* The merged set is only fetched while its tab is open, so
                  before that a count would be a lie ("0 merged") rather than
                  a fact. Show a dash until we've actually looked. */}
              {f.id === "merged" && mergedPrs === null ? "–" : counts[f.id]}
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
          {filter === "merged"
            ? `Nothing merged in the last ${MERGED_LOOKBACK_HOURS} hours.`
            : rows.length === 0
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
              onActed={refetch}
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
              <GateDecisionRow
                key={`${b.repo}#${b.pr_number}@${b.at}`}
                block={b}
              />
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
          <a
            href="#merge-dep-graph"
            className="underline hover:text-foreground"
          >
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
