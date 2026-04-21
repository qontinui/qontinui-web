"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  ServerRunnerDerivedStatus,
  ServerRunnerStatus,
} from "@/types/server-runner";

interface RunnerStatusBadgeProps {
  /**
   * Runner's self-reported liveness status (always present).
   */
  status: ServerRunnerStatus;
  /**
   * Runner-derived overall status (Phase 3J). When present it takes
   * precedence over ``status`` because it reflects the runner's computed
   * view of health (including sub-signals like UI errors). ``null`` or
   * omitted = pre-Phase-3J runner, fall back to ``status``.
   */
  derivedStatus?: ServerRunnerDerivedStatus | null;
  className?: string;
}

type BadgeStyleKey = ServerRunnerStatus | ServerRunnerDerivedStatus;

/**
 * Color-coded status pill for a server-mode runner.
 *
 * Color map:
 *   healthy  = green
 *   degraded = yellow
 *   errored  = red
 *   starting = blue
 *   offline / unhealthy = zinc / amber
 *
 * Prefers ``derivedStatus`` when present (Phase 3J).
 */
export function RunnerStatusBadge({
  status,
  derivedStatus,
  className,
}: RunnerStatusBadgeProps) {
  const effective: BadgeStyleKey = derivedStatus ?? status;

  const styles: Record<BadgeStyleKey, string> = {
    healthy: "border-emerald-500/50 text-emerald-400",
    unhealthy: "border-amber-500/50 text-amber-400",
    degraded: "border-yellow-500/50 text-yellow-400",
    errored: "border-red-500/50 text-red-400",
    starting: "border-blue-500/50 text-blue-400",
    offline: "border-zinc-500/50 text-zinc-400",
  };

  const label: Record<BadgeStyleKey, string> = {
    healthy: "Healthy",
    unhealthy: "Unhealthy",
    degraded: "Degraded",
    errored: "Errored",
    starting: "Starting",
    offline: "Offline",
  };

  const dotColors: Record<BadgeStyleKey, string> = {
    healthy: "bg-emerald-400",
    unhealthy: "bg-amber-400",
    degraded: "bg-yellow-400",
    errored: "bg-red-400",
    starting: "bg-blue-400",
    offline: "bg-zinc-400",
  };

  return (
    <Badge
      variant="outline"
      aria-label={`Status: ${label[effective]}`}
      className={cn(styles[effective], className)}
    >
      <span
        className={cn(
          "inline-block w-2 h-2 rounded-full mr-2",
          dotColors[effective]
        )}
        aria-hidden
      />
      {label[effective]}
    </Badge>
  );
}
