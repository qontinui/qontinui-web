"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ServerRunnerStatus } from "@/types/server-runner";

interface RunnerStatusBadgeProps {
  status: ServerRunnerStatus;
  className?: string;
}

/**
 * Color-coded status pill for a server-mode runner.
 * Healthy = green, unhealthy = amber, offline = zinc.
 */
export function RunnerStatusBadge({
  status,
  className,
}: RunnerStatusBadgeProps) {
  const styles: Record<ServerRunnerStatus, string> = {
    healthy: "border-emerald-500/50 text-emerald-400",
    unhealthy: "border-amber-500/50 text-amber-400",
    offline: "border-zinc-500/50 text-zinc-400",
  };

  const label: Record<ServerRunnerStatus, string> = {
    healthy: "Healthy",
    unhealthy: "Unhealthy",
    offline: "Offline",
  };

  return (
    <Badge
      variant="outline"
      aria-label={`Status: ${label[status]}`}
      className={cn(styles[status], className)}
    >
      <span
        className={cn(
          "inline-block w-2 h-2 rounded-full mr-2",
          status === "healthy"
            ? "bg-emerald-400"
            : status === "unhealthy"
              ? "bg-amber-400"
              : "bg-zinc-400"
        )}
        aria-hidden
      />
      {label[status]}
    </Badge>
  );
}
