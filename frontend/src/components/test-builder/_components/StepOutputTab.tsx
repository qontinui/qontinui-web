"use client";

import { Loader2, Play, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TaskRunSummary } from "../page-analyzer-types";

interface StepOutputTabProps {
  taskRuns: TaskRunSummary[];
  selectedTaskRunId: string;
  setSelectedTaskRunId: (id: string) => void;
  loadingTaskRuns: boolean;
  isAnalyzing: boolean;
  taskRunOutput: string | null;
  onRefresh: () => void;
  onRun: () => void;
}

export function StepOutputTab({
  taskRuns,
  selectedTaskRunId,
  setSelectedTaskRunId,
  loadingTaskRuns,
  isAnalyzing,
  taskRunOutput,
  onRefresh,
  onRun,
}: StepOutputTabProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-muted">
          Reuse outputs from recent workflow executions
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onRefresh}
          disabled={loadingTaskRuns}
        >
          <RefreshCw
            className={cn("size-3", loadingTaskRuns && "animate-spin")}
          />
        </Button>
      </div>

      {loadingTaskRuns ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
          <Loader2 className="size-4 animate-spin" />
          Loading task runs...
        </div>
      ) : taskRuns.length === 0 ? (
        <div className="text-center py-4">
          <Play className="size-8 mx-auto mb-2 text-muted-foreground opacity-40" />
          <p className="text-xs text-muted-foreground">
            No recent task runs found.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Run a workflow in the runner first.
          </p>
        </div>
      ) : (
        <select
          value={selectedTaskRunId}
          onChange={(e) => setSelectedTaskRunId(e.target.value)}
          className="w-full px-3 py-2 bg-surface-canvas/50 border border-border-subtle rounded-md text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
        >
          {taskRuns.map((run) => (
            <option key={run.id} value={run.id}>
              {run.task_name || run.workflow_name || run.id.slice(0, 8)} (
              {run.status})
            </option>
          ))}
        </select>
      )}

      {taskRunOutput && (
        <div className="max-h-32 overflow-auto rounded border border-border-subtle bg-surface-canvas/50 p-2">
          <pre className="text-[10px] font-mono text-text-muted whitespace-pre-wrap">
            {taskRunOutput.slice(0, 2000)}
            {taskRunOutput.length > 2000 && "\n...truncated"}
          </pre>
        </div>
      )}

      <Button
        onClick={onRun}
        disabled={isAnalyzing || !selectedTaskRunId || taskRuns.length === 0}
        className="w-full gap-2"
        variant="secondary"
        size="sm"
      >
        {isAnalyzing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Play className="size-3.5" />
        )}
        {isAnalyzing ? "Loading..." : "Load Output"}
      </Button>
    </div>
  );
}
