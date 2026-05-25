"use client";

import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ExternalLink,
  GitPullRequest,
} from "lucide-react";
import { createLogger } from "@/lib/logger";
import { httpClient } from "@/services/service-factory";
import { CI_STATUS_NOTIFY_API } from "./utils";
import { useCiStatusStream } from "./useCiStatusStream";
import type { NotifyWhenGreenResponse, RepoCiRow } from "./types";

const log = createLogger("CiStatusPanel");

// ----------------------------------------------------------------------------
// Status classification (frontend-derived tri-state dot)
//
// The backend `main_verdict` is a 3-state enum (green / red / unknown) with no
// amber. Amber is a *frontend* tone derived purely from open-PR-check counts:
// "main is fine but a PR has CI in flight." Per the plan, the dot is:
//   red   — main is red OR any open-PR check failed (most urgent → wins)
//   amber — main is green/unknown but an open-PR check is still pending
//   green — main is green AND no open-PR failures (and nothing pending)
// ----------------------------------------------------------------------------

type DotTone = "green" | "amber" | "red" | "unknown";

function deriveDotTone(row: RepoCiRow): DotTone {
  const { main_verdict, open_pr_checks } = row;
  // Red dominates: an actual failure (main or any open PR) is the headline.
  if (main_verdict === "red" || open_pr_checks.failure > 0) {
    return "red";
  }
  // Amber: main isn't red, but a PR check is still running.
  if (open_pr_checks.pending > 0) {
    return "amber";
  }
  if (main_verdict === "green") {
    return "green";
  }
  // Main unknown, nothing failing or pending → genuinely unknown.
  return "unknown";
}

function dotClass(tone: DotTone): string {
  switch (tone) {
    case "green":
      return "bg-green-500";
    case "amber":
      return "bg-yellow-500";
    case "red":
      return "bg-red-500";
    case "unknown":
      return "bg-muted-foreground/50";
  }
}

function dotLabel(tone: DotTone, row: RepoCiRow): string {
  switch (tone) {
    case "green":
      return "Main green, no open-PR failures";
    case "amber":
      return `Main ${row.main_verdict}; ${row.open_pr_checks.pending} open-PR check(s) pending`;
    case "red":
      return row.main_verdict === "red"
        ? "Main branch CI is red"
        : `${row.open_pr_checks.failure} open-PR check(s) failing`;
    case "unknown":
      return "No CI verdict yet for main";
  }
}

/** GitHub pull-requests page for a repo, filtered to the open queue.
 *  The CI rows carry no PR number, so we link to the repo's open-PR
 *  list (the queue that a red row blocks) rather than inventing a
 *  cross-reference data dependency — see plan Phase 4. The on-page
 *  Merge train card holds the live per-PR state. */
function repoPrQueueHref(repo: string): string {
  return `https://github.com/${repo}/pulls?q=is%3Apr+is%3Aopen`;
}

// ----------------------------------------------------------------------------
// Per-repo row
// ----------------------------------------------------------------------------

/** Transient outcome of a "Notify when green" click, per repo. */
type ArmState =
  | { kind: "idle" }
  | { kind: "arming" }
  | { kind: "armed"; gateId: string }
  | { kind: "error"; message: string };

function CiStatusRow({ row }: { row: RepoCiRow }) {
  const [arm, setArm] = useState<ArmState>({ kind: "idle" });

  const tone = useMemo(() => deriveDotTone(row), [row]);
  const repoShort = row.repo.includes("/")
    ? row.repo.split("/").slice(1).join("/")
    : row.repo;

  // The "Notify when green" action only makes sense when main is NOT
  // already green, and it needs a concrete head SHA to bind the
  // SHA-keyed CiGreen gate (plan Phase 5).
  const canArm = row.main_verdict !== "green" && row.main_head_sha !== null;
  const noSha = row.main_head_sha === null;

  const onArm = useCallback(async () => {
    if (!row.main_head_sha) return;
    setArm({ kind: "arming" });
    try {
      const res = await httpClient.fetch(CI_STATUS_NOTIFY_API, {
        method: "POST",
        body: JSON.stringify({
          repo: row.repo,
          head_sha: row.main_head_sha,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        log.warn("notify-when-green failed", res.status, text);
        setArm({ kind: "error", message: `HTTP ${res.status}` });
        return;
      }
      const body = (await res.json()) as NotifyWhenGreenResponse;
      setArm({ kind: "armed", gateId: body.gate_id });
    } catch (err) {
      log.warn("notify-when-green threw", err);
      setArm({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [row.repo, row.main_head_sha]);

  return (
    <div
      className="flex items-center gap-3 px-3 py-2 border rounded-md transition-colors"
      data-ci-repo={row.repo}
      data-ci-tone={tone}
      data-ci-main-verdict={row.main_verdict}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            className={`h-2.5 w-2.5 rounded-full shrink-0 ${dotClass(tone)}`}
            aria-label={dotLabel(tone, row)}
          />
        </TooltipTrigger>
        <TooltipContent side="top">{dotLabel(tone, row)}</TooltipContent>
      </Tooltip>

      <div className="flex-1 min-w-0">
        <p className="text-sm truncate font-mono">{repoShort}</p>
        <div className="flex gap-2 mt-0.5 flex-wrap items-center">
          <Badge
            variant="outline"
            className="font-mono text-[10px] uppercase tracking-wide"
          >
            main: {row.main_verdict}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums flex items-center gap-1.5">
            <span className="text-green-400">
              {row.open_pr_checks.success}✓
            </span>
            <span className="text-red-400">
              {row.open_pr_checks.failure}✗
            </span>
            <span className="text-yellow-400">
              {row.open_pr_checks.pending}⋯
            </span>
            <span className="text-muted-foreground/70">PR checks</span>
          </span>
          {arm.kind === "armed" && (
            <span className="text-xs text-green-300 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />
              gate armed
            </span>
          )}
          {arm.kind === "error" && (
            <span className="text-xs text-red-300 flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {arm.message}
            </span>
          )}
        </div>
      </div>

      {/* Link to the repo's open-PR queue (the work a red row blocks). */}
      <a
        href={repoPrQueueHref(row.repo)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-muted-foreground hover:text-foreground"
        aria-label="Open PR queue for this repo"
      >
        <GitPullRequest className="h-3.5 w-3.5" />
      </a>

      {/* Deep-link to the GitHub run, when a details URL is known. */}
      {row.latest_details_url && (
        <a
          href={row.latest_details_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Open latest GitHub run"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}

      {/* "Notify when green" — arms a CiGreen gate for main's tip. */}
      {noSha ? (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* span wrapper so the tooltip fires on a disabled button. */}
            <span tabIndex={0}>
              <Button size="sm" variant="outline" disabled>
                <Bell className="h-3.5 w-3.5" />
                Notify
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">
            Waiting for first push to main
          </TooltipContent>
        </Tooltip>
      ) : (
        <Button
          size="sm"
          variant="outline"
          disabled={!canArm || arm.kind === "arming" || arm.kind === "armed"}
          onClick={onArm}
          data-action="notify-when-green"
        >
          <Bell className="h-3.5 w-3.5" />
          {arm.kind === "arming"
            ? "Arming…"
            : arm.kind === "armed"
              ? "Armed"
              : "Notify when green"}
        </Button>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Panel
// ----------------------------------------------------------------------------

/**
 * CI Status Dashboard panel. Renders one row per repo in the caller's
 * `coord.tenant_repos`, fed by `useCiStatusStream` (REST seed + WS
 * push, polling fallback). Plan `2026-05-25-ci-status-dashboard-plan.md`
 * Phase 4 (panel) + Phase 5 (notify-when-green gate action).
 */
export function CiStatusPanel() {
  const { byRepo, connected, error } = useCiStatusStream();

  const rows = useMemo(() => {
    return Array.from(byRepo.values()).sort((a, b) =>
      a.repo.localeCompare(b.repo),
    );
  }, [byRepo]);

  return (
    <Card className="mb-4">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4" />
          CI status
          <Badge variant="outline" className="ml-2 font-mono text-xs">
            {rows.length}
          </Badge>
          <span
            className={`ml-auto h-2 w-2 rounded-full ${
              connected ? "bg-green-500" : "bg-muted-foreground/40"
            }`}
            aria-label={connected ? "Live (WS connected)" : "Polling"}
            title={connected ? "Live (WS connected)" : "Polling"}
          />
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No repos registered for this tenant.
          </p>
        ) : (
          <div className="space-y-2">
            {rows.map((row) => (
              <CiStatusRow key={row.repo} row={row} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
