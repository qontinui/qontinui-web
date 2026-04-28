"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RunnerStatus } from "@qontinui/shared-types";

interface RunnerStatusBadgeProps {
  /** Runner-derived overall status from the canonical Runner entity. */
  derivedStatus: RunnerStatus;
  className?: string;
}

/**
 * Color-coded status pill for a runner.
 *
 * Color map:
 *   healthy  = green
 *   degraded = yellow
 *   errored  = red
 *   starting = blue
 *   offline  = zinc
 */
export function RunnerStatusBadge({
  derivedStatus,
  className,
}: RunnerStatusBadgeProps) {
  const styles: Record<RunnerStatus, string> = {
    healthy: "border-emerald-500/50 text-emerald-400",
    degraded: "border-yellow-500/50 text-yellow-400",
    errored: "border-red-500/50 text-red-400",
    starting: "border-blue-500/50 text-blue-400",
    offline: "border-zinc-500/50 text-zinc-400",
  };

  const label: Record<RunnerStatus, string> = {
    healthy: "Healthy",
    degraded: "Degraded",
    errored: "Errored",
    starting: "Starting",
    offline: "Offline",
  };

  const dotColors: Record<RunnerStatus, string> = {
    healthy: "bg-emerald-400",
    degraded: "bg-yellow-400",
    errored: "bg-red-400",
    starting: "bg-blue-400",
    offline: "bg-zinc-400",
  };

  return (
    <Badge
      variant="outline"
      aria-label={`Status: ${label[derivedStatus]}`}
      className={cn(styles[derivedStatus], className)}
    >
      <span
        className={cn(
          "inline-block w-2 h-2 rounded-full mr-2",
          dotColors[derivedStatus]
        )}
        aria-hidden
      />
      {label[derivedStatus]}
    </Badge>
  );
}
