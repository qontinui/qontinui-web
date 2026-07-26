"use client";

// ============================================================================
// MergeTrainActivity — the pipeline's "Train" tab.
// ============================================================================
//
// The other tabs are filters over one row-per-PR list. This one is not: it is
// row-per-REPO, because the question it answers ("what is the merge train
// doing, and why are the gaps between merges so long?") is a property of the
// train, not of any PR. A PR row can say "I am green and unlanded"; only this
// view can say "…because the leader lease lapsed 20 minutes ago", or
// "…because this repo is frozen in dry_run", or "…because another proposal
// touching the same files is holding the slot".
//
// Reading order is deliberate and top-down by altitude:
//   1. The pause clock — how long since ANYTHING landed, fleet-wide.
//   2. Fleet banners — causes that stall every repo at once. If one is
//      present, the per-repo rows below it are consequences, not causes.
//   3. Per-repo rows — current phase + dwell, then the ranked reasons.
//
// Colour follows the palette rule this file's sibling documents at length:
// **colour encodes who has to do something.** Red = someone must act (coord is
// stalled, CI is red, a PR is stranded). Amber = waiting on something that
// will clear itself. In-flight phases get the calm hues (purple rebasing,
// yellow CI, blue landing) and are never red, because a busy train is not a
// problem.

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  GitMerge,
  Info,
  Pause,
  Snowflake,
} from "lucide-react";
import { relativeTime } from "./utils";
import {
  formatDuration,
  type PauseReason,
  type PauseSeverity,
  type RepoTrainRow,
  type TrainActivityKind,
  type TrainBanner,
  type TrainSummary,
} from "./trainActivity";

// ----------------------------------------------------------------------------
// Visuals
// ----------------------------------------------------------------------------

const ACTIVITY_BADGE: Record<TrainActivityKind, string> = {
  landing: "bg-blue-500/15 text-blue-200 border-blue-500/35",
  "awaiting-ci": "bg-yellow-500/15 text-yellow-200 border-yellow-500/30",
  "speculative-ci": "bg-purple-500/15 text-purple-200 border-purple-500/30",
  "dry-rebasing": "bg-purple-500/15 text-purple-200 border-purple-500/30",
  // Serialized behind another proposal: waiting on something else → amber.
  "blocked-by-overlap": "bg-amber-500/15 text-amber-200 border-amber-500/30",
  queued: "bg-muted text-muted-foreground border-border",
  conflict: "bg-red-500/15 text-red-200 border-red-500/35",
  "shadow-landed": "bg-muted text-muted-foreground border-border",
  merged: "bg-green-500/15 text-green-200 border-green-500/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  idle: "bg-transparent text-muted-foreground border-border border-dashed",
};

const SEVERITY_TEXT: Record<PauseSeverity, string> = {
  blocking: "text-red-200",
  waiting: "text-amber-200",
  info: "text-muted-foreground",
};

const SEVERITY_CHIP: Record<PauseSeverity, string> = {
  blocking: "bg-red-500/15 text-red-200 border-red-500/35",
  waiting: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  info: "bg-muted text-muted-foreground border-border",
};

function rowAccent(severity: PauseSeverity, active: boolean): string {
  if (severity === "blocking") return "border-l-2 border-l-red-500/80";
  if (severity === "waiting") return "border-l-2 border-l-amber-500/80";
  if (active) return "border-l-2 border-l-blue-500/60";
  return "border-l-2 border-l-transparent";
}

/**
 * The pause clock's own colour ramp. Deliberately generous: merges are minutes
 * apart at best, so a 20-minute gap is normal and only an hour-plus gap is
 * worth alarming about.
 */
function pauseTone(secs: number | null): string {
  if (secs === null) return "text-muted-foreground";
  if (secs > 3 * 3600) return "text-red-200";
  if (secs > 3600) return "text-amber-200";
  return "text-foreground";
}

// ----------------------------------------------------------------------------
// Fleet header
// ----------------------------------------------------------------------------

function BannerIcon({ severity }: { severity: PauseSeverity }) {
  const cls = `h-3.5 w-3.5 shrink-0 ${SEVERITY_TEXT[severity]}`;
  if (severity === "blocking") return <AlertTriangle className={cls} />;
  if (severity === "waiting") return <Clock className={cls} />;
  return <Info className={cls} />;
}

function BannerRow({ banner }: { banner: TrainBanner }) {
  return (
    <div
      className="flex items-start gap-2 rounded-md border border-border bg-card/50 px-2.5 py-2"
      data-testid={`train-banner-${banner.code}`}
      data-severity={banner.severity}
    >
      <div className="mt-0.5">
        <BannerIcon severity={banner.severity} />
      </div>
      <div className="min-w-0">
        <p
          className={`text-xs font-semibold ${SEVERITY_TEXT[banner.severity]}`}
        >
          {banner.label}
        </p>
        <p className="text-xs text-muted-foreground">{banner.detail}</p>
      </div>
    </div>
  );
}

function TrainHeader({
  summary,
  healthLoaded,
}: {
  summary: TrainSummary;
  healthLoaded: boolean;
}) {
  return (
    <div className="space-y-2" data-testid="train-header">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 rounded-md border border-border bg-card/50 px-3 py-2.5">
        {/* The hero number: the gap this tab exists to explain. */}
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Since last land
          </p>
          <p
            className={`text-lg font-semibold tabular-nums ${pauseTone(
              summary.sinceLastMergeSecs
            )}`}
            title={
              summary.lastMergedAt
                ? `Last land ${new Date(summary.lastMergedAt).toLocaleString()}`
                : "coord reported no land time"
            }
            data-testid="train-pause-clock"
          >
            {summary.sinceLastMergeSecs === null
              ? "—"
              : formatDuration(summary.sinceLastMergeSecs)}
          </p>
        </div>

        <Stat
          label="In flight"
          value={String(summary.inFlightCount)}
          hint={`${summary.activeRepoCount} repo${
            summary.activeRepoCount === 1 ? "" : "s"
          } actively being worked`}
        />
        <Stat
          label="Ready, unlanded"
          // "—", not "0", when health is unavailable: this is the stat most
          // likely to be misread as "nothing is stuck", and a hard zero from a
          // failed read is a false all-clear.
          value={
            summary.healthMissing
              ? "—"
              : String(summary.readyUnmergedCount)
          }
          // Colour by AGE, not by count. A PR that went green ten seconds ago
          // is legitimately "ready, unlanded"; painting that red would make the
          // tab red during normal operation, which is exactly the alarm-by-
          // count habit this file's palette rule exists to prevent.
          tone={
            (summary.readyUnmergedMaxAgeSecs ?? 0) > 30 * 60
              ? "text-red-200"
              : undefined
          }
          hint={
            summary.readyUnmergedMaxAgeSecs != null
              ? `oldest ready ${formatDuration(summary.readyUnmergedMaxAgeSecs)} ago`
              : "PRs coord judges landable that have not landed"
          }
        />
        {/* Capacity. Rendered as occupied/cap so a full train is legible at a
            glance, with the queue depth beside it — saturation only matters
            when something is actually waiting. */}
        {summary.slots && (
          <>
            <Stat
              label="Slots"
              value={`${summary.slots.occupied}/${summary.slots.effective_cap}`}
              tone={
                summary.slots.saturated && summary.slots.queued_depth > 0
                  ? "text-amber-200"
                  : undefined
              }
              hint={
                summary.slots.dynamic
                  ? `Cap clamped to ${summary.slots.online_ci_runners ?? "?"} online CI runners (configured ${summary.slots.configured_cap})`
                  : `COORD_MERGE_SLOTS=${summary.slots.configured_cap}; per-repo cap ${summary.slots.per_repo_cap}`
              }
            />
            <Stat
              label="Queued for a slot"
              value={String(summary.slots.queued_depth)}
              tone={summary.slots.queued_depth > 0 ? "text-amber-200" : undefined}
              hint={
                summary.slots.oldest_queued_wait_seconds != null
                  ? `oldest has waited ${formatDuration(summary.slots.oldest_queued_wait_seconds)}`
                  : "nothing waiting on capacity"
              }
            />
          </>
        )}
        <Stat
          label="Leader lease"
          value={
            summary.leaseFresh === null
              ? "—"
              : summary.leaseFresh
                ? "fresh"
                : "STALE"
          }
          tone={summary.leaseFresh === false ? "text-red-200" : undefined}
          hint={
            summary.leaseAgeSecs != null
              ? `heartbeat ${formatDuration(Math.floor(summary.leaseAgeSecs))} old`
              : "no lease row"
          }
        />
        <Stat
          label="Last eval"
          value={
            summary.lastPredicateEvalAt
              ? relativeTime(summary.lastPredicateEvalAt)
              : "—"
          }
          hint="engine liveness — advancing while nothing lands means the train is suppressed"
        />
      </div>

      {summary.healthMissing && !healthLoaded ? (
        <div
          className="flex items-start gap-2 rounded-md border border-dashed border-border px-2.5 py-2"
          data-testid="train-health-pending"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Reading coord&apos;s merge-train health…
          </p>
        </div>
      ) : summary.healthMissing ? (
        <div
          className="flex items-start gap-2 rounded-md border border-dashed border-border px-2.5 py-2"
          data-testid="train-health-missing"
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            coord&apos;s <code>/pr-merge/health</code> read is unavailable, so
            every fleet-level signal above is missing, not zero — the pause
            clock, leader lease, dry-run freeze, slot saturation and the
            ready-but-unlanded backlog all read &ldquo;—&rdquo;. Per-repo
            activity below is still derived from the merge queue and PR list.
          </p>
        </div>
      ) : (
        summary.banners.map((b) => <BannerRow key={b.code} banner={b} />)
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <div title={hint}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`text-sm font-semibold tabular-nums ${tone ?? "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Per-repo row
// ----------------------------------------------------------------------------

function ReasonChip({ reason }: { reason: PauseReason }) {
  return (
    <Badge
      variant="outline"
      className={`text-[11px] font-medium whitespace-nowrap ${SEVERITY_CHIP[reason.severity]}`}
      title={reason.detail}
      data-testid={`reason-chip-${reason.code}`}
    >
      {reason.label}
      {reason.prCount > 0 && (
        <span className="ml-1 opacity-70">{reason.prCount}</span>
      )}
      {reason.oldestSecs != null && (
        <span className="ml-1 opacity-70 tabular-nums">
          {formatDuration(reason.oldestSecs)}
        </span>
      )}
    </Badge>
  );
}

function RepoDetail({ row }: { row: RepoTrainRow }) {
  const a = row.activity;
  return (
    <div
      className="mt-2 space-y-3 border-t border-border pt-2 pl-6"
      data-testid={`train-detail-${row.repo}`}
    >
      {/* What the train is doing, in full. */}
      {a.kind !== "idle" && (
        <Section title="Current phase">
          <dl className="space-y-1 text-xs">
            <Field label="Phase">
              {a.label} — {a.detail}
            </Field>
            {a.dwellSecs != null && (
              <Field label="In this phase">
                {formatDuration(a.dwellSecs)}{" "}
                <span className="text-muted-foreground">
                  (since {relativeTime(a.since)})
                </span>
              </Field>
            )}
            {a.branch && <Field label="Branch">{a.branch}</Field>}
            {a.behind > 0 && (
              <Field label="Behind it">
                {a.behind} more proposal{a.behind === 1 ? "" : "s"} for this repo
                waiting on this one
              </Field>
            )}
            {a.requeueCount > 0 && (
              <Field label="Requeues">
                <span className="text-amber-200">
                  {a.requeueCount} leader-takeover requeue
                  {a.requeueCount === 1 ? "" : "s"} — this proposal is being
                  churned, which is its own source of delay
                </span>
              </Field>
            )}
            {a.overlapPaths.length > 0 && (
              <Field label="Overlapping files">
                <span className="font-mono text-[11px]">
                  {a.overlapPaths.slice(0, 8).join(", ")}
                  {a.overlapPaths.length > 8 &&
                    ` +${a.overlapPaths.length - 8} more`}
                </span>
              </Field>
            )}
            {a.ciRunUrl && (
              <Field label="Candidate CI">
                <a
                  href={a.ciRunUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-blue-300 hover:underline"
                >
                  view run <ExternalLink className="h-3 w-3" />
                </a>
              </Field>
            )}
            {a.proposalId && (
              <Field label="Proposal">
                <span className="font-mono text-[11px] text-muted-foreground">
                  {a.proposalId}
                </span>
              </Field>
            )}
          </dl>
        </Section>
      )}

      {/* Why it is paused — the ranked reasons, in full prose. */}
      {row.reasons.length > 0 && (
        <Section title="Why it is waiting">
          <ul className="space-y-1.5">
            {row.reasons.map((r) => (
              <li key={r.code} className="text-xs">
                <span className={`font-semibold ${SEVERITY_TEXT[r.severity]}`}>
                  {r.label}
                </span>
                <span className="text-muted-foreground"> — {r.detail}</span>
                {r.prNumbers.length > 0 && (
                  <span className="ml-1 font-mono text-[11px] text-muted-foreground/80">
                    (
                    {r.prNumbers
                      .slice(0, 10)
                      .map((n) => `#${n}`)
                      .join(" ")}
                    {r.prNumbers.length > 10 &&
                      ` +${r.prNumbers.length - 10}`}
                    )
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Green-but-unlanded backlog, oldest first — coord's own readiness clock. */}
      {row.readyUnmerged.length > 0 && (
        <Section title="Ready but unlanded">
          <ul className="space-y-1">
            {row.readyUnmerged.slice(0, 10).map((p) => (
              <li key={p.pr_number} className="text-xs">
                <a
                  href={`https://github.com/${row.repo}/pull/${p.pr_number}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-blue-300 hover:underline"
                >
                  #{p.pr_number}
                </a>
                <span className="text-muted-foreground">
                  {" "}
                  ready {formatDuration(p.age_seconds ?? null)}
                  {p.latest_proposal_status
                    ? ` · latest proposal: ${p.latest_proposal_status}`
                    : " · no proposal cut at this head"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* The rawest signal: coord's own error text for this repo. */}
      {row.lastError && (
        <Section title="Latest proposal error">
          <p className="whitespace-pre-wrap break-words font-mono text-[11px] text-red-200/90">
            {row.lastError}
          </p>
        </Section>
      )}

      <p className="text-[11px] text-muted-foreground">
        {row.openPrCount} open PR{row.openPrCount === 1 ? "" : "s"} ·{" "}
        {row.inFlightCount} in flight · {row.conflictCount} parked in conflict ·
        last train activity{" "}
        {row.lastActivityAt ? relativeTime(row.lastActivityAt) : "unknown"}
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h5 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h5>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

function RepoRow({
  row,
  expanded,
  onToggle,
}: {
  row: RepoTrainRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const active = row.activity.kind !== "idle";
  return (
    <div
      className={`rounded-md border border-border bg-card px-2.5 py-2 ${rowAccent(
        row.severity,
        active
      )}`}
      data-testid={`train-row-${row.repo}`}
      data-activity={row.activity.kind}
      data-severity={row.severity}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}

        <span
          className="min-w-0 shrink-0 truncate text-sm font-medium text-foreground"
          title={row.repo}
        >
          {row.repoShort}
        </span>

        {row.frozenDryRun && (
          <Snowflake
            className="h-3.5 w-3.5 shrink-0 text-red-200"
            aria-label="frozen in dry-run"
          />
        )}

        <Badge
          variant="outline"
          className={`shrink-0 text-[11px] font-semibold whitespace-nowrap ${
            // `?? INERT`: coord owns this enum, and an unmapped status must
            // render inertly rather than emit `class="… undefined"`.
            ACTIVITY_BADGE[row.activity.kind] ??
            "bg-muted text-muted-foreground border-border"
          }`}
          title={row.activity.detail}
        >
          {active ? (
            <GitMerge className="mr-1 h-3 w-3" />
          ) : (
            <Pause className="mr-1 h-3 w-3" />
          )}
          {row.activity.label}
          {row.activity.dwellSecs != null && (
            <span className="ml-1 tabular-nums opacity-80">
              {formatDuration(row.activity.dwellSecs)}
            </span>
          )}
        </Badge>

        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {row.activity.kind !== "idle" ? row.activity.detail : row.headline}
        </span>

        <span className="flex shrink-0 flex-wrap items-center gap-1">
          {row.reasons
            .filter((r) => r.code !== "no-candidates")
            .slice(0, 3)
            .map((r) => (
              <ReasonChip key={r.code} reason={r} />
            ))}
        </span>
      </button>

      {expanded && <RepoDetail row={row} />}
    </div>
  );
}

// ----------------------------------------------------------------------------
// The tab
// ----------------------------------------------------------------------------

export interface MergeTrainActivityProps {
  summary: TrainSummary;
  rows: RepoTrainRow[];
  /** False while the first queue/PR fetch is in flight. */
  loaded: boolean;
  /**
   * Whether the health read has actually COMPLETED (successfully or not).
   *
   * Distinguishes "coord is unavailable" from "we have not asked yet" — the
   * hook does not fetch while the document is hidden, so opening this tab in a
   * background window would otherwise assert a coord outage that was never
   * observed. False here renders a neutral "not read yet" instead.
   */
  healthLoaded?: boolean;
  /** Free-text filter shared with the other tabs (matches repo name). */
  query?: string;
}

export function MergeTrainActivity({
  summary,
  rows,
  loaded,
  healthLoaded = true,
  query = "",
}: MergeTrainActivityProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = q ? rows.filter((r) => r.repo.toLowerCase().includes(q)) : rows;

  if (!loaded) {
    return (
      <div className="space-y-2" data-testid="train-loading">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="merge-train-activity">
      <TrainHeader summary={summary} healthLoaded={healthLoaded} />

      {visible.length === 0 ? (
        <p
          className="py-4 text-center text-sm italic text-muted-foreground"
          data-testid="train-empty"
        >
          {rows.length === 0
            ? "No repo has any merge-train activity, open PR, or ready backlog."
            : "No repo matches this filter."}
        </p>
      ) : (
        <div className="space-y-1.5">
          {visible.map((row) => (
            <RepoRow
              key={row.repo}
              row={row}
              expanded={expanded === row.repo}
              onToggle={() =>
                setExpanded((k) => (k === row.repo ? null : row.repo))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
