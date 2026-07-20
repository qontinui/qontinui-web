"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { relativeTime } from "./utils";
import type { CiRunnerInfo, CiRunnerStatus } from "./types";

interface CiRunnerBadgeProps {
  ciRunner: CiRunnerInfo;
  className?: string;
}

const statusStyles: Record<CiRunnerStatus, string> = {
  idle: "border-emerald-500/50 text-emerald-400",
  busy: "border-yellow-500/50 text-yellow-400",
  offline: "border-zinc-500/50 text-zinc-400",
};

const statusLabels: Record<CiRunnerStatus, string> = {
  idle: "CI Runner: Idle",
  busy: "CI Runner: Busy",
  offline: "CI Runner: Offline",
};

const dotColors: Record<CiRunnerStatus, string> = {
  idle: "bg-emerald-400",
  busy: "bg-yellow-400",
  offline: "bg-zinc-400",
};

/**
 * CiRunnerBadge -- renders CI runner status for a machine.
 *
 * Follows the same pattern as `RunnerStatusBadge` (colored dot + label
 * inside a Badge). Shows labels as small chips below the status line.
 *
 * Phase 4c of the self-hosted CI runners plan.
 */
export function CiRunnerBadge({ ciRunner, className }: CiRunnerBadgeProps) {
  const { status, labels, lastJobAt } = ciRunner;

  const tooltipText = lastJobAt
    ? `Last job: ${relativeTime(lastJobAt)}`
    : "No jobs run yet";

  return (
    <div className={cn("space-y-1.5", className)}>
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
              className="text-[10px] px-1.5 py-0 text-muted-foreground"
            >
              {label}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
