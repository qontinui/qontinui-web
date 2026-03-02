"use client";

import type { TaskRun } from "@/lib/runner-api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getStatusBadge } from "./utils";

interface RunListPanelProps {
  runs: TaskRun[] | null | undefined;
  isLoading: boolean;
  effectiveRunId: string | null;
  onSelectRun: (runId: string) => void;
}

export function RunListPanel({
  runs,
  isLoading,
  effectiveRunId,
  onSelectRun,
}: RunListPanelProps) {
  return (
    <div className="w-[250px] min-w-[250px] border-r border-border bg-background">
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Recent Runs
        </h2>
      </div>
      <ScrollArea className="flex-1">
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Loading runs...
          </div>
        ) : !runs || runs.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm px-4">
            No recent runs found. Start a task in the runner to see data here.
          </div>
        ) : (
          <div className="py-1">
            {runs.map((run) => {
              const runId = String(run.id);
              const isSelected = effectiveRunId === runId;
              return (
                <button
                  key={run.id}
                  onClick={() => onSelectRun(runId)}
                  className={`w-full text-left px-4 py-3 border-b border-border transition-colors ${
                    isSelected
                      ? "bg-muted border-l-2 border-l-cyan-500"
                      : "hover:bg-muted/50 border-l-2 border-l-transparent"
                  }`}
                >
                  <div className="text-sm font-medium text-foreground truncate">
                    {run.task_name || `Run #${run.id}`}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    {getStatusBadge(run.status)}
                    <span
                      data-content-role="label"
                      data-content-label="run id"
                      className="text-xs text-muted-foreground"
                    >
                      #{run.id}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
