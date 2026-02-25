"use client";

import { useState, useMemo } from "react";
import { useRunningTaskRuns, useTaskRunEvents } from "@/lib/runner-api";
import type { TaskRunEvent } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Zap, Clock, Inbox, Loader2 } from "lucide-react";

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isActionEvent(event: TaskRunEvent): boolean {
  const eventType = event.event_type.toLowerCase();
  if (eventType.includes("action")) return true;
  if (event.data && typeof event.data === "object" && "action" in event.data)
    return true;
  return false;
}

function extractActionFields(event: TaskRunEvent) {
  const data = event.data || {};
  const actionType =
    (data.action as string) || (data.action_type as string) || event.event_type;
  const target =
    (data.target as string) ||
    (data.target_name as string) ||
    (data.element as string) ||
    (data.selector as string) ||
    (data.image as string) ||
    (data.image_name as string) ||
    "-";
  const result =
    (data.result as string) ||
    (data.status as string) ||
    (data.outcome as string) ||
    "unknown";
  const duration =
    (data.duration_ms as number) ||
    (data.duration as number) ||
    (data.elapsed_ms as number) ||
    null;

  return { actionType, target, result, duration };
}

function getResultBadge(result: string) {
  const lower = result.toLowerCase();
  if (
    lower === "success" ||
    lower === "passed" ||
    lower === "ok" ||
    lower === "completed"
  ) {
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
        {result}
      </Badge>
    );
  }
  if (lower === "failed" || lower === "error" || lower === "failure") {
    return (
      <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
        {result}
      </Badge>
    );
  }
  if (lower === "running" || lower === "in_progress" || lower === "pending") {
    return (
      <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
        {result}
      </Badge>
    );
  }
  return <Badge variant="outline">{result}</Badge>;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function ActionsPage() {
  const {
    data: runs,
    isLoading: runsLoading,
    isOffline,
  } = useRunningTaskRuns();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runList = runs || [];
  const activeRunId = selectedRunId || runList[0]?.id || null;

  const { data: events, isLoading: eventsLoading } =
    useTaskRunEvents(activeRunId);

  const actionEvents = useMemo(() => {
    if (!events) return [];
    return events.filter(isActionEvent);
  }, [events]);

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Zap className="size-6 text-amber-400" />
            <h1 className="text-2xl font-bold text-text-primary">Actions</h1>
          </div>
          {actionEvents.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {actionEvents.length} action
              {actionEvents.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </header>

      {isOffline && (
        <RunnerPartialState message="Runner offline — live data unavailable" />
      )}

      <main className="flex h-[calc(100vh-65px)]">
        {/* Left panel: Run list */}
        <div className="w-[250px] shrink-0 border-r border-border-subtle/50 bg-surface-canvas/40">
          <div className="px-3 py-3 border-b border-border-subtle/30">
            <h2 className="text-xs font-medium text-text-muted uppercase tracking-wider">
              Active Runs
            </h2>
          </div>
          <ScrollArea className="h-[calc(100%-41px)]">
            {runsLoading ? (
              <div className="flex items-center justify-center py-8 text-text-muted">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : runList.length === 0 ? (
              <div
                data-content-role="status"
                data-content-label="empty state"
                className="px-3 py-6 text-center text-text-muted text-xs"
              >
                No active runs
              </div>
            ) : (
              <div className="p-2 space-y-1">
                {runList.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRunId(run.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-all ${
                      activeRunId === run.id
                        ? "bg-brand-primary/10 border border-brand-primary/30 text-text-primary"
                        : "hover:bg-surface-raised/50 text-text-muted border border-transparent"
                    }`}
                  >
                    <div className="font-medium truncate text-xs">
                      {run.task_name}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          run.status === "running"
                            ? "text-blue-400 border-blue-500/30"
                            : run.status === "completed"
                              ? "text-green-400 border-green-500/30"
                              : "text-text-muted border-border-subtle/50"
                        }`}
                      >
                        {run.status}
                      </Badge>
                      {run.phase && (
                        <span
                          data-content-role="badge"
                          data-content-label="run phase"
                          className="text-[10px] text-text-muted"
                        >
                          {run.phase}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Right panel: Action log table */}
        <div className="flex-1 min-w-0">
          {!activeRunId ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-text-muted">
                <Inbox className="size-16 mx-auto mb-4" />
                <h3
                  data-content-role="heading"
                  data-content-label="empty state title"
                  className="text-lg font-medium text-text-secondary mb-2"
                >
                  No Run Selected
                </h3>
                <p className="text-sm">
                  Select an active run to view its action log.
                </p>
              </div>
            </div>
          ) : eventsLoading ? (
            <div className="flex items-center justify-center h-full text-text-muted">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : actionEvents.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-text-muted">
                <Zap className="size-16 mx-auto mb-4 opacity-30" />
                <h3
                  data-content-role="heading"
                  data-content-label="empty state title"
                  className="text-lg font-medium text-text-secondary mb-2"
                >
                  No Actions Yet
                </h3>
                <p className="text-sm">
                  Action events will appear here as the run executes automation
                  steps.
                </p>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-4">
                <Card className="bg-surface-raised/30 border-border-subtle/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Clock className="size-4 text-text-muted" />
                      Action Log
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border-subtle/50">
                            <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">
                              Time
                            </th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">
                              Type
                            </th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">
                              Target
                            </th>
                            <th className="text-left py-2 px-3 text-xs font-medium text-text-muted">
                              Result
                            </th>
                            <th className="text-right py-2 px-3 text-xs font-medium text-text-muted">
                              Duration
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {actionEvents.map((event) => {
                            const { actionType, target, result, duration } =
                              extractActionFields(event);
                            return (
                              <tr
                                key={event.id}
                                className="border-b border-border-subtle/30 hover:bg-surface-raised/20 transition-colors"
                              >
                                <td className="py-2.5 px-3 text-xs text-text-muted font-mono whitespace-nowrap">
                                  {formatTime(event.timestamp)}
                                </td>
                                <td className="py-2.5 px-3">
                                  <Badge
                                    variant="outline"
                                    className="text-xs font-mono"
                                  >
                                    {actionType}
                                  </Badge>
                                </td>
                                <td className="py-2.5 px-3 text-xs text-text-secondary max-w-[200px] truncate">
                                  <span
                                    data-content-role="label"
                                    data-content-label="action target"
                                  >
                                    {target}
                                  </span>
                                </td>
                                <td className="py-2.5 px-3">
                                  {getResultBadge(result)}
                                </td>
                                <td className="py-2.5 px-3 text-xs text-text-muted text-right font-mono">
                                  <span
                                    data-content-role="metric"
                                    data-content-label="action duration"
                                  >
                                    {formatDuration(duration)}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </ScrollArea>
          )}
        </div>
      </main>
    </div>
  );
}
