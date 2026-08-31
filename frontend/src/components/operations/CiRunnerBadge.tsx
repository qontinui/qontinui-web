"use client";

import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { relativeTime } from "./utils";
import { CI_ROUTING_LABELS, missingRoutingLabels } from "./ciRunnerMirror";
import type { CiRunnerInfo, CiRunnerStatus } from "./types";

interface CiRunnerBadgeProps {
  ciRunner: CiRunnerInfo;
  className?: string;
}

const statusStyles: Record<CiRunnerStatus, string> = {
  idle: "border-emerald-500/50 text-emerald-400",
  busy: "border-yellow-500/50 text-yellow-400",
  offline: "border-zinc-500/50 text-zinc-400",
  unknown: "border-amber-500/50 text-amber-400",
};

const statusLabels: Record<CiRunnerStatus, string> = {
  idle: "CI Runner: Idle",
  busy: "CI Runner: Busy",
  offline: "CI Runner: Offline",
  unknown: "CI Runner: status unknown",
};

const dotColors: Record<CiRunnerStatus, string> = {
  idle: "bg-emerald-400",
  busy: "bg-yellow-400",
  offline: "bg-zinc-400",
  unknown: "bg-amber-400",
};

/** Case-insensitive, matching how GitHub compares runner labels. */
function isRoutingLabel(label: string): boolean {
  const l = label.trim().toLowerCase();
  return CI_ROUTING_LABELS.some((r) => r.toLowerCase() === l);
}

/**
 * CiRunnerBadge -- renders CI runner status for a machine.
 *
 * Follows the same pattern as `RunnerStatusBadge` (colored dot + label
 * inside a Badge). Shows labels as small chips below the status line.
 *
 * Phase 4c of the self-hosted CI runners plan.
 *
 * ## The routing verdict (plan `2026-08-20-fleet-page-runner-enable-disable-
 * switch` Phase 2)
 *
 * When the labels came from coord's GitHub mirror (`source === "coord-mirror"`)
 * they ARE the set GitHub matches `runs-on` against, so this badge says whether
 * the host is routable and renders the two routing labels differently from the
 * decorative ones. A host missing `qontinui` therefore looks unmistakably
 * unlike one that has it — which is the whole point: the incident this came
 * from was a host that looked online on this page while GitHub was refusing to
 * send it work (and, later, the reverse).
 *
 * When the labels came from anywhere else, NO routing verdict is rendered. A
 * user-paired device's `ci_runner_labels` are not evidence about GitHub, and a
 * "not routable" chip derived from them would be a confident wrong answer.
 *
 * The freshness line is not decoration either. This is a mirror up to a
 * registrar poll old; a page that implies live GitHub truth will eventually
 * tell an operator a delabelled host is fine.
 */
export function CiRunnerBadge({ ciRunner, className }: CiRunnerBadgeProps) {
  const { status, labels, lastJobAt } = ciRunner;
  const mirrored = ciRunner.source === "coord-mirror";
  const missing = mirrored ? missingRoutingLabels(labels) : [];
  const routable = mirrored && missing.length === 0;

  const tooltipText = lastJobAt
    ? `Last job: ${relativeTime(lastJobAt)}`
    : "No jobs run yet";

  return (
    <div
      className={cn("space-y-1.5", className)}
      data-ci-runner-source={ciRunner.source ?? "device-registry"}
      data-ci-runner-routable={mirrored ? (routable ? "yes" : "no") : "unknown"}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            aria-label={`${statusLabels[status]} -- ${tooltipText}`}
            className={cn(statusStyles[status])}
          >
            <span
              className={cn(
                "inline-block w-2 h-2 rounded-full mr-2",
                dotColors[status]
              )}
              aria-hidden
            />
            {statusLabels[status]}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipText}</TooltipContent>
      </Tooltip>

      {labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {labels.map((label) => (
            <Badge
              key={label}
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0",
                // The routing labels are the two that decide whether GitHub
                // sends this host work; `Linux`, `X64` and the per-machine
                // names do not. Rendering all five identically is what made
                // the delabelled host indistinguishable in the first place.
                mirrored && isRoutingLabel(label)
                  ? "border-sky-500/60 font-semibold text-sky-500 dark:text-sky-300"
                  : "text-muted-foreground"
              )}
              data-ci-runner-label={label}
              data-ci-runner-label-routing={
                mirrored && isRoutingLabel(label) ? "true" : "false"
              }
            >
              {label}
            </Badge>
          ))}
        </div>
      )}

      {mirrored && !routable && (
        <p
          className="flex items-start gap-1 text-[11px] text-amber-600 dark:text-amber-400"
          role="status"
          data-testid="ci-runner-not-routable"
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            <strong>GitHub will not route fleet CI here.</strong> Missing{" "}
            {missing.map((m) => (
              <code key={m} className="font-mono">
                {m}
              </code>
            ))}
            , and <code className="font-mono">runs-on</code> matches every label
            or none.
          </span>
        </p>
      )}

      {mirrored && routable && (
        <p
          className="text-[11px] text-muted-foreground"
          data-testid="ci-runner-routable"
        >
          Carries both routing labels, so GitHub matches{" "}
          <code className="font-mono">[self-hosted, qontinui]</code> jobs here.
        </p>
      )}
    </div>
  );
}
