"use client";

/**
 * PullDecisionCard — render a single `repo_pull` decision audit row.
 *
 * Plan `2026-05-30-coord-pull-decision-ui.md` Phase 2 (Feature A).
 *
 * The row is coord's `PullDecisionRow` DTO (coord parses the nested
 * `coord.policy_rule_resolutions.resolution_payload` shape server-side, so
 * this component is a dumb renderer — see plan §4.1 "Decision (robustness)").
 *
 * Visual rules per row:
 *  - a verdict badge, colored by safety class
 *    (pull=green, default_ref_sync=blue, hold=amber, diverged=red,
 *     up_to_date=muted);
 *  - repo + device (short);
 *  - timing (Now / Defer{reason});
 *  - an autonomy chip;
 *  - the rationale;
 *  - an outcome chip when `outcome` is present, else a muted
 *    "no outcome recorded yet" (Q1 resolution — honest about uncertainty);
 *  - a short Mode-C evidence summary when `timing_evidence` is present.
 */

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { GitPullRequest, Bot, Hand } from "lucide-react";

export interface PullDecisionOutcome {
  chosen_option?: string | null;
  reasoning?: string | null;
  recorded_at?: string | null;
}

export interface PullDecisionRow {
  resolution_id: string;
  resolved_at?: string | null;
  device_id?: string | null;
  repo?: string | null;
  kind?: "decision" | "escalate" | string | null;
  verdict?:
    | "pull"
    | "default_ref_sync"
    | "hold"
    | "up_to_date"
    | "diverged"
    | string
    | null;
  timing?: "now" | "defer" | string | null;
  defer_reason?: string | null;
  hold_reason?: string | null;
  autonomy?: "auto_decide" | "guidance_only" | string | null;
  behind?: number | null;
  ahead?: number | null;
  rationale?: string | null;
  outcome?: PullDecisionOutcome | null;
  // `timing_evidence` is the Mode-C `pull_timing_evidence` blob — shape is
  // an internal coord detail; we render a couple of well-known keys when
  // present and otherwise stay silent.
  timing_evidence?: Record<string, unknown> | null;
}

type BadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"
  | "success"
  | "warning"
  | "info";

/** Map a verdict class → (badge variant, human label). */
function verdictBadge(
  verdict?: string | null
): { variant: BadgeVariant; label: string } {
  switch (verdict) {
    case "pull":
      return { variant: "success", label: "pull" };
    case "default_ref_sync":
      return { variant: "info", label: "default ref sync" };
    case "hold":
      return { variant: "warning", label: "hold" };
    case "diverged":
      return { variant: "destructive", label: "diverged" };
    case "up_to_date":
      return { variant: "secondary", label: "up to date" };
    default:
      return { variant: "outline", label: verdict || "unknown" };
  }
}

function formatRelative(iso?: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const deltaSec = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const m = Math.round(deltaSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

/** Build a short Mode-C evidence summary from the (opaque) evidence blob. */
function evidenceSummary(
  ev?: Record<string, unknown> | null
): string | null {
  if (!ev || typeof ev !== "object") return null;
  const parts: string[] = [];
  const posture = ev["posture"];
  if (typeof posture === "string" && posture) parts.push(`posture: ${posture}`);
  const rate = ev["rate"] ?? ev["land_rate"] ?? ev["recent_rate"];
  if (typeof rate === "number") parts.push(`rate: ${rate}`);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function PullDecisionCard({ row }: { row: PullDecisionRow }) {
  const verdict = verdictBadge(row.verdict);
  const deviceShort = row.device_id ? row.device_id.slice(0, 8) : null;
  const timingLabel =
    row.timing === "defer"
      ? `Defer${row.defer_reason ? ` (${row.defer_reason})` : ""}`
      : row.timing === "now"
        ? "Now"
        : null;
  const evidence = evidenceSummary(row.timing_evidence);

  return (
    <Card data-testid="coord-pull-decision-card">
      <CardContent className="p-4 space-y-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <GitPullRequest className="h-3.5 w-3.5 text-muted-foreground" />
          <Badge
            variant={verdict.variant}
            data-testid="coord-pull-decision-verdict"
          >
            {verdict.label}
          </Badge>
          {row.hold_reason && (
            <Badge variant="outline" className="text-xs">
              {row.hold_reason}
            </Badge>
          )}
          {timingLabel && (
            <Badge
              variant="outline"
              className="text-xs"
              data-testid="coord-pull-decision-timing"
            >
              {timingLabel}
            </Badge>
          )}
          {row.autonomy && (
            <Badge
              variant="secondary"
              className="gap-1 text-xs"
              data-testid="coord-pull-decision-autonomy"
            >
              {row.autonomy === "auto_decide" ? (
                <Bot className="h-3 w-3" />
              ) : (
                <Hand className="h-3 w-3" />
              )}
              {row.autonomy}
            </Badge>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatRelative(row.resolved_at)}
          </span>
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono flex-wrap">
          {row.repo && <span className="text-foreground">{row.repo}</span>}
          {deviceShort && <span>device: {deviceShort}…</span>}
          {(row.behind ?? null) !== null && <span>↓{row.behind} behind</span>}
          {(row.ahead ?? 0) > 0 && <span>↑{row.ahead} ahead</span>}
        </div>

        {row.rationale && (
          <p className="text-sm text-foreground">{row.rationale}</p>
        )}

        {row.outcome && row.outcome.chosen_option ? (
          <p
            className="text-xs text-muted-foreground"
            data-testid="coord-pull-decision-outcome"
          >
            <Badge variant="outline" className="text-xs mr-1">
              {row.outcome.chosen_option}
            </Badge>
            {row.outcome.reasoning ? (
              <span className="italic">{row.outcome.reasoning}</span>
            ) : null}
            {row.outcome.recorded_at ? (
              <span className="ml-1">
                ({formatRelative(row.outcome.recorded_at)})
              </span>
            ) : null}
          </p>
        ) : (
          <p
            className="text-xs text-muted-foreground italic"
            data-testid="coord-pull-decision-no-outcome"
          >
            no outcome recorded yet
          </p>
        )}

        {evidence && (
          <p className="text-xs text-muted-foreground" data-testid="coord-pull-decision-evidence">
            {evidence}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
