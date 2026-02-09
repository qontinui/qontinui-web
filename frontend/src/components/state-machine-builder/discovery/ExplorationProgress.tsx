"use client";

import { Square, AlertCircle, Globe, Layers, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExplorationStatusData } from "@/lib/state-machine-builder/types";

interface ExplorationProgressProps {
  status: ExplorationStatusData | null;
  onStop: () => void;
}

export function ExplorationProgress({
  status,
  onStop,
}: ExplorationProgressProps) {
  if (!status) {
    return (
      <Card className="border-border-subtle bg-surface-raised">
        <CardHeader className="pb-4">
          <CardTitle className="text-text-primary text-base">
            Exploration Progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <div className="flex gap-4">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-24" />
          </div>
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    );
  }

  const progressPct = status.progress_pct ?? 0;
  const isRunning = status.status === "running";
  const isError = status.status === "error";
  const isComplete = status.status === "complete";
  const isStopped = status.status === "stopped";

  return (
    <Card className="border-border-subtle bg-surface-raised">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-text-primary text-base flex items-center gap-2">
            {isRunning && (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--brand-primary)]" />
            )}
            Exploration Progress
          </CardTitle>
          {isRunning && (
            <Button variant="destructive" size="sm" onClick={onStop}>
              <Square className="h-3.5 w-3.5" />
              Stop
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Phase text */}
        {status.phase && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
              Phase
            </span>
            <span className="text-sm text-text-primary">{status.phase}</span>
          </div>
        )}

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">Progress</span>
            <span className="text-xs text-text-muted tabular-nums">
              {Math.round(progressPct)}%
            </span>
          </div>
          <Progress
            value={progressPct}
            variant={
              isError ? "error" : isComplete ? "brand-success" : "brand-primary"
            }
            className="h-2"
          />
        </div>

        {/* Stats row */}
        <div className="flex gap-4">
          <div className="flex items-center gap-2 rounded-md bg-surface-raised/50 border border-border-subtle px-3 py-2 flex-1">
            <Layers className="h-4 w-4 text-[var(--brand-secondary)]" />
            <div>
              <div className="text-sm font-medium text-text-primary tabular-nums">
                {status.elements_discovered ?? 0}
              </div>
              <div className="text-xs text-text-muted">Elements</div>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-surface-raised/50 border border-border-subtle px-3 py-2 flex-1">
            <Globe className="h-4 w-4 text-[var(--brand-primary)]" />
            <div>
              <div className="text-sm font-medium text-text-primary tabular-nums">
                {status.pages_visited ?? 0}
              </div>
              <div className="text-xs text-text-muted">Pages</div>
            </div>
          </div>
        </div>

        {/* Current URL */}
        {status.current_url && isRunning && (
          <div className="space-y-1">
            <span className="text-xs text-text-muted">Current URL</span>
            <div className="text-xs text-text-secondary truncate bg-surface-canvas rounded px-2 py-1.5 border border-border-subtle font-mono">
              {status.current_url}
            </div>
          </div>
        )}

        {/* Error display */}
        {isError && status.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{status.error}</AlertDescription>
          </Alert>
        )}

        {/* Completion states */}
        {isComplete && (
          <div className="text-sm text-brand-success font-medium">
            Exploration complete. Processing results...
          </div>
        )}
        {isStopped && (
          <div className="text-sm text-text-muted">
            Exploration stopped by user.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
