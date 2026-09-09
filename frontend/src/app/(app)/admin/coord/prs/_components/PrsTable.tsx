"use client";

/**
 * PrsTable — one row per open PR.
 *
 * Columns: Repo · PR# (→ GitHub) · branch→base · State · CI badge ·
 * Mergeable / merge_state · Blocking reason badge (colored by merge_status,
 * tooltip = blocking_summary) · Age (relative, from last_refreshed_at).
 *
 * Controls: filter by repo, filter by merge_status, sort by age.
 *
 * ## Console style (Phase 3 Wave 4) — D2, on a shadcn `<Table>`
 *
 * Plan `2026-08-16-coord-console-ui-unification-pipeline-style.md` keeps the
 * table: an 8-column (10 on the merged tab) comparison is a legitimate dense
 * form and the column comparison is the job this page exists for. What it
 * gains is a clickable row expanding a full-width `<tr><td colSpan>`
 * `<RecordDetail>` beneath it — the same primitive the row lists use, not a
 * slide-over — plus the attention palette.
 *
 * **The one tooltip on this page STAYS.** `MergeStateHeader` is a
 * COLUMN-HEADER LEGEND explaining what the "Merge state" column means, not
 * per-record detail. The plan's D2 amendment is explicit that deleting it
 * would lose information the expanded row does not carry.
 *
 * **The two links inside the row stop propagation.** `#123` and the blocking
 * badge deep-link to GitHub / the alerts rollup; a click on either must
 * navigate, not toggle the row.
 */

import { Fragment, useMemo, useState } from "react";
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
import { ChevronDown, ChevronRight } from "lucide-react";
import type { PrRow, PrDeployState } from "@/services/admin-dev-service";
import {
  formatContextNames,
  proposalIsActive,
  unstableHasFailure,
} from "@/components/operations/prPipeline";
import { PrDraftStateControl } from "@/components/operations/PrDraftStateControl";
import {
  RecordDetail,
  StatusBadge,
  rowAccentProps,
} from "@/components/console";
import {
  derivePrStatus,
  mergeStatusLabel,
  PR_STATUS_PALETTE,
} from "../prStatus";

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

// The merge_status severity map MOVED to `../prStatus.ts` (R8 — status
// derivation lives in a pure, unit-tested module; R3 — one audited
// kind→attention table decides the hue, and a unit test asserts the two agree).
// The map that used to live here described its own picks as "deliberately
// LOUD", i.e. chosen by how alarming the state sounds — see `prStatus.ts` for
// the four rows that reading got wrong.
// `required-checks-missing` post-dates this move: it reached `PrMergeStatus`
// while Wave 4 was in flight, so `prStatus.ts` is where its row was added, not
// here. It grades as `ci-failed`'s sibling — see that row's note.

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
type MergeStateMeta = { tone: BadgeTone; label?: string; hint: string };

const STATIC_MERGE_STATE_META = {
  CLEAN: {
    tone: "success",
    hint: "Mergeable and all required checks pass — ready to merge.",
  },
  // UNSTABLE deliberately absent: it has TWO honest meanings and is derived
  // per-row by `unstableMeta` below (failed non-required check vs checks
  // still running).
  BEHIND: {
    tone: "warning",
    hint: "Head is behind the base branch — update/rebase before merging.",
  },
  BLOCKED: {
    tone: "destructive",
    hint: "Blocked by ruleset/branch-protection requirements (required review or required check not satisfied).",
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
} satisfies Record<string, MergeStateMeta>;

const MERGE_STATE_META: Record<string, MergeStateMeta | undefined> =
  STATIC_MERGE_STATE_META;

/**
 * UNSTABLE is the one merge state whose meaning is DERIVED from the row, not
 * looked up statically: GitHub reports UNSTABLE both when a non-required
 * check FAILED (worth a look — warning) and when non-required checks are
 * merely STILL RUNNING (just wait — muted info). The split predicate is
 * shared with prPipeline/MergePipeline via `unstableHasFailure` so the surfaces
 * never drift. Exported for PrsTable.test.tsx.
 */
export const UNSTABLE_FAILED_META = {
  tone: "warning" as BadgeTone,
  hint: "Mergeable, but a non-required check failed — worth a look; it does not block the merge.",
};
export const UNSTABLE_PENDING_META = {
  tone: "info" as BadgeTone,
  hint: "Mergeable; non-required checks still running — no action needed.",
};

function unstableMeta(
  pr: Pick<PrRow, "failing_contexts" | "ci_conclusion">,
): MergeStateMeta {
  return unstableHasFailure(pr) ? UNSTABLE_FAILED_META : UNSTABLE_PENDING_META;
}

/**
 * Order for the header legend — calm → loud → transient. The legend is the
 * operator's contract: BOTH derived UNSTABLE variants appear even though
 * only one renders per row. Exported for PrsTable.test.tsx.
 */
export const MERGE_STATE_LEGEND: readonly {
  key: string;
  badge: string;
  tone: BadgeTone;
  hint: string;
  label?: string;
}[] = [
  { key: "CLEAN", badge: "CLEAN", ...STATIC_MERGE_STATE_META.CLEAN },
  {
    key: "UNSTABLE-failed",
    badge: "UNSTABLE",
    ...UNSTABLE_FAILED_META,
  },
  {
    key: "UNSTABLE-pending",
    badge: "UNSTABLE",
    ...UNSTABLE_PENDING_META,
  },
  { key: "BEHIND", badge: "BEHIND", ...STATIC_MERGE_STATE_META.BEHIND },
  { key: "BLOCKED", badge: "BLOCKED", ...STATIC_MERGE_STATE_META.BLOCKED },
  { key: "DIRTY", badge: "DIRTY", ...STATIC_MERGE_STATE_META.DIRTY },
  {
    key: "HAS_HOOKS",
    badge: "HAS_HOOKS",
    ...STATIC_MERGE_STATE_META.HAS_HOOKS,
  },
  { key: "DRAFT", badge: "DRAFT", ...STATIC_MERGE_STATE_META.DRAFT },
  {
    key: "UNKNOWN",
    badge: STATIC_MERGE_STATE_META.UNKNOWN.label,
    ...STATIC_MERGE_STATE_META.UNKNOWN,
  },
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
  const meta =
    state === "UNSTABLE"
      ? unstableMeta(pr)
      : (MERGE_STATE_META[state] ?? {
          tone: "outline" as BadgeTone,
          hint: "Unrecognized merge state reported by GitHub.",
        });

  // Tooltip = GitHub's lens (hint + named failing checks + mergeable) plus
  // coord's lens (blocking_summary) side by side. The coord-lens BADGE is
  // already the neighboring "Blocking reason" column — only the summary text
  // rides along here, never a duplicate badge.
  const failing = pr.failing_contexts ?? [];
  const titleLines = [meta.hint];
  if (failing.length > 0) {
    titleLines.push(`failing checks: ${formatContextNames(failing)}`);
  }
  if (pr.blocking_summary) {
    titleLines.push(`coord: ${pr.blocking_summary}`);
  }
  titleLines.push(`mergeable: ${String(pr.mergeable)}`);

  return (
    <div className="flex flex-col gap-0.5">
      <Badge variant={meta.tone} title={titleLines.join("\n")}>
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
            {MERGE_STATE_LEGEND.map((entry) => (
              <li key={entry.key} className="flex items-start gap-2">
                <Badge variant={entry.tone} className="shrink-0">
                  {entry.badge}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {entry.hint}
                </span>
              </li>
            ))}
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
  onActed,
}: {
  prs: PrRow[];
  /** When true (the "Recently merged" tab) show the Deploy + Merged columns. */
  merged?: boolean;
  /**
   * FORCED refetch after a row action (the draft-state toggle) succeeds.
   * Must be a forced (`?refresh=1`) reload, not the plain auto-refresh:
   * coord's cached `pr_state` only reconciles when the `ready_for_review` /
   * `converted_to_draft` webhook lands, so an unforced poll can keep serving
   * the pre-flip state. Omitted on the merged tab, where no action renders.
   */
  onActed?: () => void;
}) {
  const [repoFilter, setRepoFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  // R5 — one row open at a time, the same model `<RecordList>` holds for a row
  // list, spelled out here because a `<TableBody>` cannot host that primitive.
  const [openKey, setOpenKey] = useState<string | null>(null);

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
              {!merged && (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={merged ? 10 : 9}
                  className="text-center text-sm text-muted-foreground italic py-6"
                >
                  No PRs match the current filters.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => {
                const key = `${p.repo}#${p.pr_number}`;
                const expanded = openKey === key;
                const status = derivePrStatus(p);
                const Chevron = expanded ? ChevronDown : ChevronRight;
                return (
                  <Fragment key={key}>
                <TableRow
                  data-testid={`pr-row-${p.repo}-${p.pr_number}`}
                  data-expanded={expanded ? "true" : "false"}
                  onClick={() => setOpenKey(expanded ? null : key)}
                  // R4 — the accent is a left border; the row body stays
                  // neutral, which is what keeps 40 rows readable when 6 are red.
                  {...rowAccentProps(status, "cursor-pointer")}
                >
                  <TableCell className="max-w-[14rem]">
                    <span className="inline-flex max-w-full items-center gap-1.5 align-bottom">
                      <Chevron
                        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                        aria-hidden
                      />
                      <span
                        className="truncate text-sm text-muted-foreground"
                        title={p.repo}
                      >
                        {p.repo}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <Link
                      href={prGithubUrl(p)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-primary hover:underline"
                      title={`Open ${p.repo}#${p.pr_number} on GitHub`}
                      // A deep link inside a clickable row must navigate, not
                      // toggle the row underneath it.
                      onClick={(e) => e.stopPropagation()}
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
                  {!merged && (
                    <TableCell className="whitespace-nowrap text-right">
                      <PrDraftStateControl
                        repo={p.repo}
                        prNumber={p.pr_number}
                        prState={p.pr_state}
                        hasActiveProposal={proposalIsActive(p.proposal_status)}
                        onActed={onActed}
                      />
                    </TableCell>
                  )}
                </TableRow>
                {expanded && (
                  // D2 — a full-width cell spanning every column, so it hosts
                  // everything a fixed-width sheet could and keeps its width
                  // as the merged tab adds two more columns.
                  <TableRow
                    data-testid={`pr-row-detail-${p.repo}-${p.pr_number}`}
                    className="hover:bg-transparent"
                  >
                    <TableCell colSpan={merged ? 10 : 8} className="p-0">
                      <PrDetail pr={p} />
                    </TableCell>
                  </TableRow>
                )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * R5's detail, in the shared host and the fixed slot order.
 *
 * The material here previously existed only as `title` attributes on three
 * different badges — invisible on touch, unselectable, and impossible to read
 * two of at once. `why` is coord's own sentence about the row; `problems`
 * names the failing checks; `actions` carries the deep links (D1's "Open full
 * page ↗", in this surface's terms); `raw` carries the ids and the enum, which
 * is the only place R8 allows them.
 */
function PrDetail({ pr }: { pr: PrRow }) {
  const status = derivePrStatus(pr);
  const failing = pr.failing_contexts ?? [];
  const state = normalizeMergeState(pr.merge_state_status);
  const meta =
    state === "UNSTABLE"
      ? unstableMeta(pr)
      : MERGE_STATE_META[state];
  return (
    <RecordDetail
      className="rounded-none border-x-0 border-b-0"
      data-testid="pr-row-detail"
      why={
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {pr.blocking_summary ||
              `coord reports this PR as “${mergeStatusLabel(pr.merge_status)}”.`}
          </p>
          {meta && (
            <p className="text-xs text-muted-foreground/80">{meta.hint}</p>
          )}
        </div>
      }
      problems={
        failing.length > 0 ? (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">
              Failing checks:
            </p>
            <p className="text-xs text-red-200">
              {formatContextNames(failing)}
            </p>
          </div>
        ) : undefined
      }
      actions={
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <Link
            href={prGithubUrl(pr)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary hover:underline"
          >
            Open {pr.repo}#{pr.pr_number} on GitHub ↗
          </Link>
          {pr.escalation_alert_id != null && (
            <Link
              href="/admin/coord/alerts"
              className="font-medium text-primary hover:underline"
            >
              Open the escalation ↗
            </Link>
          )}
        </div>
      }
      raw={
        <div className="break-all font-mono text-[10px] text-muted-foreground/60">
          {pr.branch} → {pr.base_branch} · head {pr.head_sha.slice(0, 8)} ·
          merge_status: {status.kind} · merge_state_status: {state} · mergeable:{" "}
          {String(pr.mergeable)}
          {pr.escalation_alert_id != null
            ? ` · escalation: ${pr.escalation_alert_id}`
            : ""}
        </div>
      }
    />
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
  const status = derivePrStatus(pr);
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
      // The badge is a deep link inside a clickable row: it must navigate,
      // not toggle the row underneath it.
      onClick={(e) => e.stopPropagation()}
    >
      {/* R3 — the hue comes from `prStatus`'s audited table, and `StatusBadge`
          carries the reason as a native `title` plus the colourblind-safe `✕`
          on every author-action kind. The wrapping span keeps the authored
          `blocking-badge` testid resolvable (D4a) without widening the shared
          primitive's props for one surface. */}
      <span data-testid="blocking-badge" className="contents">
        <StatusBadge
          status={status}
          palette={PR_STATUS_PALETTE}
          className="cursor-pointer"
        />
      </span>
    </Link>
  );
}
