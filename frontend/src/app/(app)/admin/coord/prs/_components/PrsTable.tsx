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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  PrRow,
  PrMergeStatus,
  PrDeployState,
} from "@/services/admin-dev-service";

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

/**
 * GitHub's merge_state_status, normalized for display. The value reaches us
 * verbatim from coord, which sources it from BOTH the GraphQL `mergeStateStatus`
 * (UPPERCASE) and the REST `mergeable_state` (lowercase) APIs — so we uppercase
 * before mapping to keep casing + color consistent regardless of which path
 * populated it. `label` overrides the raw enum where a plain-English word reads
 * better than GitHub's jargon (notably UNKNOWN → "Recalibrating", the transient
 * window where GitHub is still recomputing mergeability after `main` moved).
 * Keys mirror the full GitHub enum.
 */
const MERGE_STATE_META: Record<
  string,
  { tone: BadgeTone; label?: string; hint: string }
> = {
  CLEAN: {
    tone: "success",
    hint: "Mergeable and all required checks pass — ready to merge.",
  },
  UNSTABLE: {
    tone: "warning",
    hint: "Mergeable, but a non-required check is failing or still running.",
  },
  BEHIND: {
    tone: "warning",
    hint: "Head is behind the base branch — update/rebase before merging.",
  },
  BLOCKED: {
    tone: "destructive",
    hint: "Blocked by branch protection (required review or check not satisfied).",
  },
  DIRTY: {
    tone: "destructive",
    hint: "Merge conflict with the base branch — rebase and resolve.",
  },
  HAS_HOOKS: {
    tone: "info",
    hint: "Mergeable, with pre-receive hooks configured.",
  },
  DRAFT: {
    tone: "secondary",
    hint: "PR is a draft — not mergeable until marked ready.",
  },
  UNKNOWN: {
    tone: "info",
    label: "Recalibrating",
    hint: "GitHub is still recomputing mergeability (it resets every time the base branch moves). This resolves on its own; the row auto-refreshes until it settles.",
  },
};

/** Order for the header legend — calm → loud → transient. */
const MERGE_STATE_LEGEND: readonly string[] = [
  "CLEAN",
  "UNSTABLE",
  "BEHIND",
  "BLOCKED",
  "DIRTY",
  "HAS_HOOKS",
  "DRAFT",
  "UNKNOWN",
];

/** Normalize the raw wire value to an uppercase enum key (UNKNOWN when null). */
function normalizeMergeState(raw: string | null): string {
  return raw ? raw.toUpperCase() : "UNKNOWN";
}

/**
 * True when the PR's merge state is the transient "Recalibrating" (UNKNOWN)
 * window — GitHub hasn't finished recomputing mergeability. Exported so the
 * page can force a fast re-read (`?refresh=1`) until it settles, instead of
 * leaving the row stuck on the muted cache value.
 */
export function isMergeStateRecalibrating(
  pr: Pick<PrRow, "merge_state_status">,
): boolean {
  return normalizeMergeState(pr.merge_state_status) === "UNKNOWN";
}

function MergeStateCell({ pr }: { pr: PrRow }) {
  const state = normalizeMergeState(pr.merge_state_status);
  const meta = MERGE_STATE_META[state] ?? {
    tone: "outline" as BadgeTone,
    hint: "Unrecognized merge state reported by GitHub.",
  };

  return (
    <div className="flex flex-col gap-0.5">
      <Badge
        variant={meta.tone}
        title={`${meta.hint}\nmergeable: ${String(pr.mergeable)}`}
      >
        {meta.label ?? state}
      </Badge>
      {pr.review_decision && (
        <span className="text-[11px] text-muted-foreground">
          {pr.review_decision.replace(/_/g, " ").toLowerCase()}
        </span>
      )}
    </div>
  );
}

/** The "Merge state" column header + a hover legend explaining each tag. */
function MergeStateHeader() {
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 cursor-help">
            Merge state
            <span
              aria-hidden
              className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-border text-[10px] leading-none text-muted-foreground"
            >
              i
            </span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <p className="mb-1.5 font-medium">
            GitHub merge state (from mergeStateStatus)
          </p>
          <ul className="space-y-1.5">
            {MERGE_STATE_LEGEND.map((state) => {
              const meta = MERGE_STATE_META[state];
              if (!meta) return null;
              return (
                <li key={state} className="flex items-start gap-2">
                  <Badge variant={meta.tone} className="shrink-0">
                    {meta.label ?? state}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {meta.hint}
                  </span>
                </li>
              );
            })}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ---- deploy-state badge (merged tab) ------------------------------------

/**
 * Maps the coord deploy_state to a badge tone + label answering "has my PR
 * deployed yet?". `deployed` reads calm-green; the actionable-stuck states
 * (`stale`/`rolled-back`) are LOUD red; `in-flight` is amber ("not yet");
 * `unknown` is muted grey.
 */
const DEPLOY_STATE_META: Record<
  PrDeployState,
  { tone: BadgeTone; label: string }
> = {
  deployed: { tone: "success", label: "Deployed ✓" },
  "in-flight": { tone: "warning", label: "Not deployed yet" },
  stale: { tone: "destructive", label: "Stale" },
  "rolled-back": { tone: "destructive", label: "Rolled back" },
  unknown: { tone: "secondary", label: "Unknown" },
};

function DeployCell({ pr }: { pr: PrRow }) {
  const state = pr.deploy_state;
  // Open/draft rows (or coord with no signal) carry no deploy_state → em-dash.
  if (!state) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const meta = DEPLOY_STATE_META[state] ?? DEPLOY_STATE_META.unknown;

  // Suffix context: in-flight → lag; deployed → "Nm ago" from merged_at.
  let suffix = "";
  if (state === "in-flight" && typeof pr.deploy_lag_secs === "number") {
    suffix = `(lag ${formatAge(pr.deploy_lag_secs)})`;
  } else if (state === "deployed" && pr.merged_at) {
    const rel = formatRelative(pr.merged_at);
    if (rel !== "—") suffix = rel;
  }

  const title = [
    `deploy: ${state}`,
    pr.deployed_surface ? `surface: ${pr.deployed_surface}` : null,
    typeof pr.deploy_lag_secs === "number"
      ? `lag: ${formatAge(pr.deploy_lag_secs)}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <Badge variant={meta.tone} title={title} data-testid="deploy-badge">
          {meta.label}
        </Badge>
        {pr.deployed_surface && (
          <span className="text-[11px] text-muted-foreground">
            {pr.deployed_surface}
          </span>
        )}
      </div>
      {suffix && (
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {suffix}
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

export function PrsTable({
  prs,
  merged = false,
}: {
  prs: PrRow[];
  /** When true (the "Recently merged" tab) show the Deploy + Merged columns. */
  merged?: boolean;
}) {
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
              <TableHead>
                <MergeStateHeader />
              </TableHead>
              <TableHead>Blocking reason</TableHead>
              {merged && <TableHead>Deploy</TableHead>}
              {merged && <TableHead>Merged</TableHead>}
              <TableHead>Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={merged ? 10 : 8}
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
                  {merged && (
                    <TableCell>
                      <DeployCell pr={p} />
                    </TableCell>
                  )}
                  {merged && (
                    <TableCell className="whitespace-nowrap">
                      <span
                        className="text-sm text-muted-foreground tabular-nums"
                        title={formatAbsolute(p.merged_at ?? null)}
                      >
                        {formatRelative(p.merged_at ?? null)}
                      </span>
                    </TableCell>
                  )}
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
