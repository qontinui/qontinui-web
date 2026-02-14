"use client";

import { useState } from "react";
import { useTaskRuns, useTaskRunCheckpoints } from "@/lib/runner-api";
import type { TaskRun, Checkpoint } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Bookmark,
  RefreshCw,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Clock,
  ChevronRight,
  Layers,
  Inbox,
  Flag,
} from "lucide-react";

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "failed":
      return <XCircle className="size-4 text-red-500" />;
    case "running":
      return <PlayCircle className="size-4 text-blue-500 animate-pulse" />;
    default:
      return <Clock className="size-4 text-text-muted" />;
  }
}

function formatDateTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

function formatShortTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

export default function CheckpointsPage() {
  const {
    data: runs,
    isLoading: runsLoading,
    error: runsError,
    isOffline,
    refetch,
  } = useTaskRuns({ limit: 20 });

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const {
    data: checkpoints,
    isLoading: checkpointsLoading,
    error: checkpointsError,
  } = useTaskRunCheckpoints(selectedRunId);

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Bookmark className="size-6 text-purple-400" />
            <h1 className="text-2xl font-bold text-text-primary">
              Checkpoints
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-border-default"
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <p className="text-text-muted mb-6">
          Browse checkpoints saved during task execution. Select a run to view
          its checkpoints.
        </p>

        {runsLoading ? (
          <div className="text-center py-16 text-text-muted">
            <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
            Loading runs...
          </div>
        ) : runsError ? (
          <div className="text-center py-16 text-red-400">
            Error loading runs: {runsError}
          </div>
        ) : !runs || runs.length === 0 ? (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-16">
              <div className="text-center text-text-muted">
                <Inbox className="size-16 mx-auto mb-4" />
                <h3
                  data-content-role="heading"
                  data-content-label="empty state title"
                  className="text-lg font-medium text-text-secondary mb-2"
                >
                  No Runs Available
                </h3>
                <p className="text-sm">
                  Execute tasks in the Runner to create checkpoints.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Run List - Left Panel */}
            <div className="lg:col-span-4">
              <Card className="bg-surface-raised/50 border-border-subtle/50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Layers className="size-4" />
                    Runs ({runs.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-[600px]">
                    <div className="divide-y divide-border-subtle/30">
                      {runs.map((run: TaskRun) => (
                        <button
                          key={run.id}
                          onClick={() => setSelectedRunId(run.id)}
                          className={`w-full text-left px-4 py-3 hover:bg-surface-raised/30 transition-colors flex items-center gap-3 ${
                            selectedRunId === run.id
                              ? "bg-surface-raised/50 border-l-2 border-brand-primary"
                              : "border-l-2 border-transparent"
                          }`}
                        >
                          {getStatusIcon(run.status)}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-text-primary truncate">
                              {run.task_name}
                            </div>
                            <div className="text-xs text-text-muted mt-0.5">
                              {formatDateTime(run.created_at)}
                            </div>
                          </div>
                          <ChevronRight
                            className={`size-4 shrink-0 transition-colors ${
                              selectedRunId === run.id
                                ? "text-brand-primary"
                                : "text-text-muted"
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>

            {/* Checkpoints - Right Panel */}
            <div className="lg:col-span-8">
              {selectedRunId == null ? (
                <Card className="bg-surface-raised/50 border-border-subtle/50">
                  <CardContent className="py-20">
                    <div className="text-center text-text-muted">
                      <Bookmark className="size-12 mx-auto mb-4" />
                      <h3
                        data-content-role="heading"
                        data-content-label="empty state title"
                        className="text-lg font-medium text-text-secondary mb-2"
                      >
                        Select a Run
                      </h3>
                      <p className="text-sm">
                        Choose a run from the list to view its checkpoints.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : checkpointsLoading ? (
                <Card className="bg-surface-raised/50 border-border-subtle/50">
                  <CardContent className="py-20">
                    <div className="text-center text-text-muted">
                      <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
                      Loading checkpoints...
                    </div>
                  </CardContent>
                </Card>
              ) : checkpointsError ? (
                <Card className="bg-surface-raised/50 border-border-subtle/50">
                  <CardContent className="py-20">
                    <div className="text-center text-red-400">
                      Error: {checkpointsError}
                    </div>
                  </CardContent>
                </Card>
              ) : !checkpoints || checkpoints.length === 0 ? (
                <Card className="bg-surface-raised/50 border-border-subtle/50">
                  <CardContent className="py-20">
                    <div className="text-center text-text-muted">
                      <Flag className="size-12 mx-auto mb-4" />
                      <h3
                        data-content-role="heading"
                        data-content-label="empty state title"
                        className="text-lg font-medium text-text-secondary mb-2"
                      >
                        No Checkpoints
                      </h3>
                      <p className="text-sm">
                        This run does not have any saved checkpoints.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <Card className="bg-surface-raised/50 border-border-subtle/50">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Flag className="size-4 text-purple-400" />
                      Checkpoints
                      <Badge variant="secondary" className="ml-1">
                        {checkpoints.length}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="relative">
                      {/* Timeline line */}
                      <div className="absolute left-4 top-0 bottom-0 w-px bg-border-subtle/50" />

                      <div className="space-y-4">
                        {(checkpoints as Checkpoint[]).map(
                          (checkpoint, index) => (
                            <div key={checkpoint.id} className="relative pl-10">
                              {/* Timeline dot */}
                              <div
                                className={`absolute left-2.5 top-2 size-3 rounded-full border-2 ${
                                  index === 0
                                    ? "bg-brand-primary border-brand-primary"
                                    : "bg-surface-raised border-border-subtle"
                                }`}
                              />

                              <Card className="bg-surface-canvas/50 border-border-subtle/30">
                                <CardContent className="py-3 px-4">
                                  <div className="flex items-center justify-between mb-1">
                                    <span
                                      data-content-role="label"
                                      data-content-label="checkpoint name"
                                      className="font-medium text-sm text-text-primary"
                                    >
                                      {checkpoint.step_name || checkpoint.step_type}
                                    </span>
                                    <span
                                      data-content-role="metric"
                                      data-content-label="checkpoint time"
                                      className="text-xs text-text-muted"
                                    >
                                      {checkpoint.started_at ? formatShortTime(checkpoint.started_at) : "-"}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
                                    >
                                      {checkpoint.phase}
                                    </Badge>
                                    <Badge
                                      variant={checkpoint.status === "success" ? "success" : checkpoint.status === "failed" ? "destructive" : "secondary"}
                                      className="text-xs"
                                    >
                                      {checkpoint.status}
                                    </Badge>
                                    {checkpoint.iteration != null && (
                                      <span className="text-xs text-text-muted">
                                        iter {checkpoint.iteration}
                                      </span>
                                    )}
                                    {checkpoint.duration_ms != null && (
                                      <span className="text-xs text-text-muted">
                                        {checkpoint.duration_ms < 1000
                                          ? `${checkpoint.duration_ms}ms`
                                          : `${Math.round(checkpoint.duration_ms / 1000)}s`}
                                      </span>
                                    )}
                                  </div>
                                  {checkpoint.error && (
                                    <p className="mt-1 text-xs text-red-400 truncate">
                                      {checkpoint.error}
                                    </p>
                                  )}
                                </CardContent>
                              </Card>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
