"use client";

/**
 * PrsTable — one row per open PR.
 *
 * Columns: Repo · PR# (→ GitHub) · branch→base · State · CI badge ·
 * Mergeable / merge_state · Blocking reason badge (colored by merge_status,
 * tooltip = blocking_summary) · Age (relative, from last_refreshed_at).
 *
 * Controls: filter by repo, filter by merge_status, sort by age.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PrRow, PrMergeStatus } from "@/services/admin-dev-service";

// ---- formatting helpers --------------------------------------------------

/** Human-readable duration from seconds (e.g. "3h 12m", "45s", "2d 4h"). */
function formatAge(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "—";
  const s = Math.floor(secs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  if (h < 24) return remM ? `${h}h ${remM}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

/** Relative time from an ISO timestamp to now (past → "ago"). */
function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const deltaSecs = (Date.now() - t) / 1000;
  const mag = formatAge(Math.abs(deltaSecs));
  if (mag === "—") return "—";
  return `${mag} ago`;
}

function formatAbsolute(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

/** Seconds-since for sorting; missing/invalid timestamps sort oldest-last. */
function ageSecs(iso: string | null): number {
  if (!iso) return -1;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return -1;
  return Math.max(0, (Date.now() - t) / 1000);
}

// ---- blocking-reason badge ----------------------------------------------

type BadgeTone =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

/**
 * Severity/color map by merge_status. The "stuck" states the operator most
 * needs to see — `ready-but-unlanded` and `awaiting-specialist-review` — are
 * deliberately LOUD (destructive red / warning orange). Calm states
 * (`ready`/`queued`) read green/blue; `draft` and `unknown` are muted; the
 * actionable-but-not-stuck blockers (ci/conflicts/behind/review/blast-radius)
 * are warning-colored.
 */
const MERGE_STATUS_TONE: Record<PrMergeStatus, BadgeTone> = {
  // LOUD — genuinely stuck, needs an operator.
  "ready-but-unlanded": "destructive",
  "awaiting-specialist-review": "warning",
  // Warning — a concrete blocker the PR author can act on.
  "ci-failed": "destructive",
  conflicts: "warning",
  "behind-base": "warning",
  "review-required": "warning",
  "blast-radius-block": "warning",
  // In-progress / calm.
  "ci-pending": "info",
  queued: "info",
  ready: "success",
  // Muted.
  draft: "secondary",
  unknown: "outline",
};

/** Short human label for the merge_status (the badge text). */
function mergeStatusLabel(status: PrMergeStatus): string {
  return status.replace(/-/g, " ");
}

function badgeTone(status: string): BadgeTone {
  return MERGE_STATUS_TONE[status as PrMergeStatus] ?? "outline";
}

// ---- CI badge ------------------------------------------------------------

function CiCell({ pr }: { pr: PrRow }) {
  const { ci_lifecycle, ci_conclusion } = pr;
  if (!ci_lifecycle && !ci_conclusion) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  let tone: BadgeTone = "secondary";
  let label = ci_lifecycle ?? "ci";
  if (ci_lifecycle === "complete" && ci_conclusion) {
    label = ci_conclusion;
    tone =
      ci_conclusion === "success"
        ? "success"
        : ci_conclusion === "failure"
          ? "destructive"
          : "warning";
  } else if (ci_lifecycle === "pending") {
    tone = "info";
    label = "pending";
  }
  return (
    <Badge
      variant={tone}
      title={
        ci_conclusion
          ? `${ci_lifecycle ?? "ci"} · ${ci_conclusion}`
          : (ci_lifecycle ?? undefined)
      }
    >
      {label}
    </Badge>
  );
}

// ---- mergeable / merge_state cell ---------------------------------------

function MergeStateCell({ pr }: { pr: PrRow }) {
  const state = pr.merge_state_status;
  const mergeable = pr.mergeable;
  let tone: BadgeTone = "outline";
  if (state === "CLEAN") tone = "success";
  else if (state === "DIRTY" || state === "BLOCKED") tone = "destructive";
  else if (state === "BEHIND") tone = "warning";
  else if (state === "UNKNOWN" || state === null) tone = "secondary";

  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant={tone} title={`mergeable: ${String(mergeable)}`}>
        {state ?? "unknown"}
      </Badge>
      {pr.review_decision && (
        <span className="text-[11px] text-muted-foreground">
          {pr.review_decision.replace(/_/g, " ").toLowerCase()}
        </span>
      )}
    </div>
  );
}

// ---- table ---------------------------------------------------------------

const ALL = "__all__";

function prGithubUrl(pr: PrRow): string {
  return `https://github.com/${pr.repo}/pull/${pr.pr_number}`;
}

export function PrsTable({ prs }: { prs: PrRow[] }) {
  const [repoFilter, setRepoFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);

  const repoOptions = useMemo(
    () => Array.from(new Set(prs.map((p) => p.repo))).sort(),
    [prs],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(prs.map((p) => p.merge_status))).sort(),
    [prs],
  );

  const rows = useMemo(() => {
    let r = prs;
    if (repoFilter !== ALL) r = r.filter((p) => p.repo === repoFilter);
    if (statusFilter !== ALL)
      r = r.filter((p) => p.merge_status === statusFilter);

    // Default sort: oldest last_refreshed_at first (most-stale PRs surface at
    // the top — these are the rows most likely wedged and needing attention).
    const sorted = [...r];
    sorted.sort((a, b) => ageSecs(b.last_refreshed_at) - ageSecs(a.last_refreshed_at));
    return sorted;
  }, [prs, repoFilter, statusFilter]);

  return (
    <div className="space-y-3" data-testid="prs-table-wrap">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Repo
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={repoFilter}
            onChange={(e) => setRepoFilter(e.target.value)}
            data-testid="prs-filter-repo"
          >
            <option value={ALL}>All repos</option>
            {repoOptions.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Blocking reason
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            data-testid="prs-filter-status"
          >
            <option value={ALL}>All</option>
            {statusOptions.map((v) => (
              <option key={v} value={v}>
                {v.replace(/-/g, " ")}
              </option>
            ))}
          </select>
        </label>

        <div className="ml-auto text-xs text-muted-foreground self-center">
          {rows.length} of {prs.length} PRs
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <Table data-testid="prs-table">
          <TableHeader>
            <TableRow>
              <TableHead>Repo</TableHead>
              <TableHead>PR</TableHead>
              <TableHead>Branch → base</TableHead>
              <TableHead>State</TableHead>
              <TableHead>CI</TableHead>
              <TableHead>Merge state</TableHead>
              <TableHead>Blocking reason</TableHead>
              <TableHead>Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-sm text-muted-foreground italic py-6"
                >
                  No PRs match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => (
                <TableRow
                  key={`${p.repo}#${p.pr_number}`}
                  data-testid={`pr-row-${p.repo}-${p.pr_number}`}
                >
                  <TableCell className="max-w-[14rem]">
                    <span
                      className="text-sm text-muted-foreground truncate inline-block max-w-full align-bottom"
                      title={p.repo}
                    >
                      {p.repo}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Link
                      href={prGithubUrl(p)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary hover:underline"
                      title={`Open ${p.repo}#${p.pr_number} on GitHub`}
                    >
                      #{p.pr_number}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[18rem]">
                    <div
                      className="text-xs text-muted-foreground truncate"
                      title={`${p.branch} → ${p.base_branch}`}
                    >
                      <span className="font-medium text-foreground">
                        {p.branch}
                      </span>
                      <span className="mx-1">→</span>
                      {p.base_branch}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={p.pr_state === "draft" ? "secondary" : "outline"}
                    >
                      {p.pr_state}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <CiCell pr={p} />
                  </TableCell>
                  <TableCell>
                    <MergeStateCell pr={p} />
                  </TableCell>
                  <TableCell>
                    <BlockingBadge pr={p} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span
                      className="text-sm text-muted-foreground tabular-nums"
                      title={formatAbsolute(p.last_refreshed_at)}
                    >
                      {formatRelative(p.last_refreshed_at)}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * The centerpiece: the colored blocking-reason badge.
 *
 * Deep-link decision: when `escalation_alert_id != null` (the PR is parked in
 * `awaiting-specialist-review` behind an escalation), link to the escalations
 * surface `/admin/coord/alerts`. There is no per-alert deep-link route in
 * CoordNav (the alerts page is a filterable rollup, not /alerts/:id), so we
 * link the rollup. Otherwise the badge deep-links to the GitHub PR so the
 * operator lands one click from the actual blocker.
 */
function BlockingBadge({ pr }: { pr: PrRow }) {
  const tone = badgeTone(pr.merge_status);
  const label = mergeStatusLabel(pr.merge_status);
  const href =
    pr.escalation_alert_id != null
      ? "/admin/coord/alerts"
      : prGithubUrl(pr);
  const isExternal = pr.escalation_alert_id == null;

  return (
    <Link
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className="inline-block"
      data-testid="blocking-badge-link"
    >
      <Badge
        variant={tone}
        title={pr.blocking_summary || label}
        data-testid="blocking-badge"
        className="cursor-pointer"
      >
        {label}
      </Badge>
    </Link>
  );
}
