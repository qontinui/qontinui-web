"use client";

import {
  Clock,
  RotateCcw,
  Timer,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TimelineStats } from "../execution-timeline-types";
import { formatDuration, formatTime } from "../execution-timeline-utils";

export function TimelineStatsBar({
  stats,
  totalSteps,
  completedSteps,
  failedSteps,
}: {
  stats: TimelineStats;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
}) {
  let ImprovementIcon = Minus;
  let improvementColor = "text-text-muted";
  if (stats.improvement) {
    if (stats.improvement.delta > 0) {
      ImprovementIcon = TrendingUp;
      improvementColor = "text-green-400";
    } else if (stats.improvement.delta < 0) {
      ImprovementIcon = TrendingDown;
      improvementColor = "text-red-400";
    }
  }

  const progressPercent =
    totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
  const progressColor =
    failedSteps > 0
      ? "bg-red-500"
      : completedSteps === totalSteps && totalSteps > 0
        ? "bg-green-500"
        : "bg-blue-500";

  return (
    <div className="border-b border-border-subtle/30 px-4 py-2.5 bg-white/[0.02]">
      {/* Progress bar */}
      {totalSteps > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
            <span>
              {completedSteps}/{totalSteps} steps
            </span>
            {failedSteps > 0 && (
              <span className="text-red-400">{failedSteps} failed</span>
            )}
          </div>
          <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                progressColor
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-5 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Clock className="size-3.5 text-text-muted" />
          <div>
            <p className="text-[10px] text-text-muted leading-none">Elapsed</p>
            <p className="font-mono text-xs text-text-primary">
              {formatTime(stats.elapsedTime)}
            </p>
          </div>
        </div>
        {stats.maxIteration > 0 && (
          <div className="flex items-center gap-1.5">
            <RotateCcw className="size-3.5 text-text-muted" />
            <div>
              <p className="text-[10px] text-text-muted leading-none">
                Iteration
              </p>
              <p className="font-mono text-xs text-text-primary">
                {stats.currentIteration ?? stats.maxIteration}
              </p>
            </div>
          </div>
        )}
        {stats.avgIterationDurationMs !== null && (
          <div className="flex items-center gap-1.5">
            <Timer className="size-3.5 text-text-muted" />
            <div>
              <p className="text-[10px] text-text-muted leading-none">
                Avg Iteration
              </p>
              <p className="font-mono text-xs text-text-primary">
                {formatDuration(stats.avgIterationDurationMs)}
              </p>
            </div>
          </div>
        )}
        {stats.improvement && (
          <div className="flex items-center gap-1.5">
            <ImprovementIcon className={cn("size-3.5", improvementColor)} />
            <div>
              <p className="text-[10px] text-text-muted leading-none">
                vs Last
              </p>
              <p className={cn("font-mono text-xs", improvementColor)}>
                {stats.improvement.delta > 0 ? "+" : ""}
                {stats.improvement.delta}/{stats.improvement.total}
                <span className="text-[10px] ml-1">
                  ({stats.improvement.percentage > 0 ? "+" : ""}
                  {stats.improvement.percentage.toFixed(0)}%)
                </span>
              </p>
            </div>
          </div>
        )}
        {!stats.improvement &&
          stats.verificationResults.length > 0 &&
          (() => {
            const lastResult =
              stats.verificationResults[stats.verificationResults.length - 1]!;
            return (
              <div className="flex items-center gap-1.5">
                <TrendingUp className="size-3.5 text-text-muted" />
                <div>
                  <p className="text-[10px] text-text-muted leading-none">
                    Verification
                  </p>
                  <p className="font-mono text-xs text-text-primary">
                    {lastResult.passed}/{lastResult.total} passed
                  </p>
                </div>
              </div>
            );
          })()}
      </div>
    </div>
  );
}
