"use client";

/**
 * StepProgressMarker - Displays real-time progress indicators for execution steps
 *
 * This component shows progress markers during step execution, including:
 * - Current phase/substep information
 * - Elapsed time
 * - Progress percentage (if available)
 * - Status messages
 *
 * Used by:
 * - UnifiedStepCard: Shows progress when step is expanded and running
 * - TestStepTimeline: Shows inline progress for current step
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Clock,
  CheckCircle2,
  AlertCircle,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { httpClient } from "@/services/service-factory";

/**
 * Step progress data from the API (snake_case to match backend response)
 */
export interface StepProgressData {
  /** Current phase name (e.g., "image_matching", "action_execution") */
  phase: string;
  /** Human-readable phase description */
  phase_description?: string | null;
  /** Current substep within the phase */
  substep?: string | null;
  /** Progress percentage (0-100), null if indeterminate */
  progress?: number | null;
  /** Status message */
  message?: string | null;
  /** Elapsed time in milliseconds */
  elapsed_ms: number;
  /** Whether this step is still running */
  is_running: boolean;
  /** Error message if failed */
  error?: string | null;
  /** Additional metadata */
  metadata?: Record<string, unknown> | null;
}

/**
 * Query keys for step progress
 */
export const stepProgressKeys = {
  all: ["step-progress"] as const,
  step: (taskRunId: string, checkpointId: string) =>
    [...stepProgressKeys.all, taskRunId, checkpointId] as const,
};

/**
 * Fetch step progress from the API
 */
async function fetchStepProgress(
  taskRunId: string,
  checkpointId: string
): Promise<StepProgressData> {
  const response = await httpClient.get<StepProgressData>(
    `/api/v1/task-runs/${taskRunId}/steps/${checkpointId}/progress`
  );
  return response;
}

/**
 * Hook to fetch and auto-refresh step progress
 */
export function useStepProgressMarkers(
  taskRunId: string,
  checkpointId: string,
  options?: {
    /** Enable auto-refresh (default: true when running) */
    autoRefresh?: boolean;
    /** Refresh interval in ms (default: 1000) */
    refreshInterval?: number;
    /** Whether the step is running (enables auto-refresh) */
    isRunning?: boolean;
  }
) {
  const {
    autoRefresh = true,
    refreshInterval = 1000,
    isRunning = false,
  } = options ?? {};

  const shouldRefresh = autoRefresh && isRunning;

  return useQuery({
    queryKey: stepProgressKeys.step(taskRunId, checkpointId),
    queryFn: () => fetchStepProgress(taskRunId, checkpointId),
    enabled: !!taskRunId && !!checkpointId,
    refetchInterval: shouldRefresh ? refreshInterval : false,
    staleTime: shouldRefresh ? 500 : 30000,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Props for StepProgressMarker component
 */
export interface StepProgressMarkerProps {
  /** Task run ID */
  taskRunId: string;
  /** Checkpoint/step ID */
  checkpointId: string;
  /** Enable auto-refresh for running steps */
  autoRefresh?: boolean;
  /** Refresh interval in ms */
  refreshInterval?: number;
  /** Compact mode for inline display */
  compact?: boolean;
  /** Whether this step is currently running */
  isRunning?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Format elapsed time for display
 */
function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Get phase display info
 */
function getPhaseInfo(phase: string): { label: string; color: string } {
  const phaseMap: Record<string, { label: string; color: string }> = {
    initializing: {
      label: "Initializing",
      color: "text-blue-400",
    },
    image_matching: {
      label: "Matching Images",
      color: "text-purple-400",
    },
    image_recognition: {
      label: "Image Recognition",
      color: "text-purple-400",
    },
    template_matching: {
      label: "Template Matching",
      color: "text-purple-400",
    },
    state_detection: {
      label: "Detecting States",
      color: "text-cyan-400",
    },
    action_execution: {
      label: "Executing Action",
      color: "text-green-400",
    },
    click: {
      label: "Clicking",
      color: "text-green-400",
    },
    type: {
      label: "Typing",
      color: "text-yellow-400",
    },
    drag: {
      label: "Dragging",
      color: "text-orange-400",
    },
    scroll: {
      label: "Scrolling",
      color: "text-orange-400",
    },
    wait: {
      label: "Waiting",
      color: "text-gray-400",
    },
    verification: {
      label: "Verifying",
      color: "text-cyan-400",
    },
    completing: {
      label: "Completing",
      color: "text-green-400",
    },
    failed: {
      label: "Failed",
      color: "text-red-400",
    },
    completed: {
      label: "Completed",
      color: "text-green-400",
    },
  };

  return (
    phaseMap[phase.toLowerCase()] ?? {
      label: phase.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
      color: "text-text-muted",
    }
  );
}

/**
 * StepProgressMarker Component
 *
 * Displays progress information for an execution step.
 * Shows phase, substep, elapsed time, and optional progress bar.
 */
export function StepProgressMarker({
  taskRunId,
  checkpointId,
  autoRefresh = true,
  refreshInterval = 1000,
  compact = false,
  isRunning = false,
  className,
}: StepProgressMarkerProps) {
  const [localElapsedMs, setLocalElapsedMs] = useState(0);
  const [startTime] = useState(Date.now());

  const {
    data: progress,
    isLoading,
    error,
  } = useStepProgressMarkers(taskRunId, checkpointId, {
    autoRefresh,
    refreshInterval,
    isRunning,
  });

  // Update local elapsed time when running
  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(() => {
      setLocalElapsedMs(Date.now() - startTime);
    }, 100);

    return () => clearInterval(interval);
  }, [isRunning, startTime]);

  // Determine elapsed time to display
  const elapsedMs = progress?.elapsed_ms ?? localElapsedMs;

  // Don't render anything while loading initially
  if (isLoading && !progress) {
    return compact ? (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs text-text-muted",
          className
        )}
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading...
      </span>
    ) : null;
  }

  // Show error state
  if (error || progress?.error) {
    const errorMessage = progress?.error || "Failed to load progress";
    return compact ? (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-xs text-red-400",
          className
        )}
      >
        <AlertCircle className="w-3 h-3" />
        Error
      </span>
    ) : (
      <div
        className={cn(
          "bg-red-500/10 border border-red-500/30 rounded-lg p-3",
          className
        )}
      >
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span className="text-sm font-medium">Error</span>
        </div>
        <p className="text-xs text-red-300 mt-1">{errorMessage}</p>
      </div>
    );
  }

  // Compact mode: single line display
  if (compact) {
    const phaseInfo = progress ? getPhaseInfo(progress.phase) : null;

    return (
      <div className={cn("inline-flex items-center gap-2", className)}>
        {isRunning ? (
          <Loader2 className="w-3 h-3 animate-spin text-brand-primary" />
        ) : progress?.is_running === false ? (
          <CheckCircle2 className="w-3 h-3 text-green-400" />
        ) : (
          <Activity className="w-3 h-3 text-text-muted" />
        )}

        {phaseInfo && (
          <span className={cn("text-xs", phaseInfo.color)}>
            {phaseInfo.label}
          </span>
        )}

        {progress?.substep && (
          <span className="text-xs text-text-muted">{progress.substep}</span>
        )}

        <span className="text-xs text-text-muted flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatElapsedTime(elapsedMs)}
        </span>

        {progress?.progress != null && (
          <Badge variant="outline" className="text-xs h-5 px-1">
            {Math.round(progress.progress)}%
          </Badge>
        )}
      </div>
    );
  }

  // Full mode: detailed display
  const phaseInfo = progress
    ? getPhaseInfo(progress.phase)
    : { label: "Initializing", color: "text-text-muted" };

  return (
    <div className={cn("bg-surface-raised/30 rounded-lg p-3", className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isRunning || progress?.is_running ? (
            <Loader2 className="w-4 h-4 animate-spin text-brand-primary" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-green-400" />
          )}
          <span className={cn("text-sm font-medium", phaseInfo.color)}>
            {phaseInfo.label}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Clock className="w-3 h-3" />
          {formatElapsedTime(elapsedMs)}
        </div>
      </div>

      {/* Progress bar */}
      {progress?.progress != null && (
        <div className="mb-2">
          <Progress
            value={progress.progress}
            className="h-1.5 bg-surface-raised"
          />
        </div>
      )}

      {/* Substep and message */}
      <div className="space-y-1">
        {progress?.substep && (
          <div className="text-xs text-text-muted">
            <span className="text-text-secondary">Step:</span>{" "}
            {progress.substep}
          </div>
        )}

        {progress?.phase_description && (
          <div className="text-xs text-text-muted">
            {progress.phase_description}
          </div>
        )}

        {progress?.message && (
          <div className="text-xs text-text-secondary">{progress.message}</div>
        )}
      </div>
    </div>
  );
}

export default StepProgressMarker;
