"use client";

import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { ExplorationProgress } from "../exploration-config-types";

interface ProgressSectionProps {
  progress: ExplorationProgress;
  progressPercent: number;
  isRunning: boolean;
}

export function ProgressSection({
  progress,
  progressPercent,
  isRunning,
}: ProgressSectionProps) {
  if (progress.status === "idle") return null;

  return (
    <Card className="p-4 bg-surface-raised/60 border-brand-primary/30">
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">Progress</span>
          <span className="text-brand-primary font-mono">
            {progressPercent}%
          </span>
        </div>
        <Progress value={progressPercent} className="h-2" />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-brand-primary">
              {progress.elementsDiscovered}
            </div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider">
              Discovered
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-brand-success">
              {progress.elementsClicked}
            </div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider">
              Clicked
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-yellow-500">
              {progress.elementsSkipped}
            </div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider">
              Skipped
            </div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-brand-secondary">
              {progress.renderLogsCollected}
            </div>
            <div className="text-[10px] text-text-muted uppercase tracking-wider">
              Render Logs
            </div>
          </div>
        </div>

        {progress.currentElement && isRunning && (
          <div className="mt-3 p-2 bg-surface-canvas/50 rounded text-xs">
            <span className="text-text-muted">Current: </span>
            <span className="text-white font-mono">
              {progress.currentElement}
            </span>
          </div>
        )}

        {progress.error && (
          <div className="mt-3 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
            {progress.error}
          </div>
        )}
      </div>
    </Card>
  );
}
