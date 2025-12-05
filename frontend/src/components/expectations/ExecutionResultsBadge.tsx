"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { WorkflowExecutionResult } from "@/lib/expectations/types";
import { cn } from "@/lib/utils";

export interface ExecutionResultsBadgeProps {
  result: WorkflowExecutionResult;
  showDuration?: boolean;
  showIcon?: boolean;
  className?: string;
}

/**
 * Simple badge component showing pass/fail status for workflow execution
 *
 * Use this in lists or tables where a compact indicator is needed.
 *
 * @example
 * ```tsx
 * <ExecutionResultsBadge result={executionResult} showDuration />
 * ```
 */
export function ExecutionResultsBadge({
  result,
  showDuration = false,
  showIcon = true,
  className,
}: ExecutionResultsBadgeProps) {
  const durationText = showDuration
    ? ` (${formatDuration(result.total_duration_ms)})`
    : "";

  return (
    <Badge
      variant={result.success ? "default" : "destructive"}
      className={cn(
        "gap-1.5",
        result.success &&
          "bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800",
        className
      )}
    >
      {showIcon && (
        result.success ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <XCircle className="h-3 w-3" />
        )
      )}
      <span>
        {result.success ? "PASS" : "FAIL"}
        {durationText}
      </span>
      {result.exceeded_max_duration && (
        <Clock className="h-3 w-3 text-yellow-300" />
      )}
    </Badge>
  );
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}
