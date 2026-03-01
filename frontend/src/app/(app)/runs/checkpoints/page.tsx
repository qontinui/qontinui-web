"use client";

import { useState } from "react";
import {
  useTaskRunCheckpoints,
  useTaskRuns,
  type Checkpoint,
  type TaskRun,
} from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
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
      return <Clock className="size-4 text-muted-foreground" />;
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

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Checkpoints</h1>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      </header>

      {isOffline && (
        <RunnerPartialState message="Runner offline — live data unavailable" />
      )}

      <main className="flex-1 overflow-y-auto p-6">
        <p className="text-muted-foreground text-sm mb-6">
          Browse checkpoints saved during task execution. Select a run to view
          its checkpoints.
        </p>

        {runsLoading ? (
          <div className="text-center py-16 text-muted-foreground">
            <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
            Loading runs...
          </div>
        ) : runsError ? (
          <div className="text-center py-16 text-red-400">
            Error loading runs: {runsError}
          </div>
        ) : !runs || runs.length === 0 ? (
          <Card className="bg-muted border-border">
            <CardContent className="py-16">
              <div className="text-center text-muted-foreground">
                <Inbox className="size-16 mx-auto mb-4" />
                <h3
                  data-content-role="heading"
                  data-content-label="empty state title"
                  className="text-lg font-medium text-muted-foreground mb-2"
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
              <Card className="bg-muted border-border">
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
                          className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3 ${
                            selectedRunId === run.id
                              ? "bg-muted border-l-2 border-primary"
                              : "border-l-2 border-transparent"
                          }`}
                        >
                          {getStatusIcon(run.status)}
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">
                              {run.task_name}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {formatDateTime(run.created_at)}
                            </div>
                          </div>
                          <ChevronRight
                            className={`size-4 shrink-0 transition-colors ${
                              selectedRunId === run.id
                                ? "text-primary"
                                : "text-muted-foreground"
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
                <Card className="bg-muted border-border">
                  <CardContent className="py-20">
                    <div className="text-center text-muted-foreground">
                      <Bookmark className="size-12 mx-auto mb-4" />
                      <h3
                        data-content-role="heading"
                        data-content-label="empty state title"
                        className="text-lg font-medium text-muted-foreground mb-2"
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
                <Card className="bg-muted border-border">
                  <CardContent className="py-20">
                    <div className="text-center text-muted-foreground">
                      <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
                      Loading checkpoints...
                    </div>
                  </CardContent>
                </Card>
              ) : checkpointsError ? (
                <Card className="bg-muted border-border">
                  <CardContent className="py-20">
                    <div className="text-center text-red-400">
                      Error: {checkpointsError}
                    </div>
                  </CardContent>
                </Card>
              ) : !checkpoints || checkpoints.length === 0 ? (
                <Card className="bg-muted border-border">
                  <CardContent className="py-20">
                    <div className="text-center text-muted-foreground">
                      <Flag className="size-12 mx-auto mb-4" />
                      <h3
                        data-content-role="heading"
                        data-content-label="empty state title"
                        className="text-lg font-medium text-muted-foreground mb-2"
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
                <Card className="bg-muted border-border">
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
                                    ? "bg-primary border-primary"
                                    : "bg-muted border-border"
                                }`}
                              />

                              <Card className="bg-background border-border">
                                <CardContent className="py-3 px-4">
                                  <div className="flex items-center justify-between mb-1">
                                    <span
                                      data-content-role="label"
                                      data-content-label="checkpoint name"
                                      className="font-medium text-sm text-foreground"
                                    >
                                      {checkpoint.step_name ||
                                        checkpoint.step_type}
                                    </span>
                                    <span
                                      data-content-role="metric"
                                      data-content-label="checkpoint time"
                                      className="text-xs text-muted-foreground"
                                    >
                                      {checkpoint.started_at
                                        ? formatShortTime(checkpoint.started_at)
                                        : "-"}
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
                                      variant={
                                        checkpoint.status === "success"
                                          ? "success"
                                          : checkpoint.status === "failed"
                                            ? "destructive"
                                            : "secondary"
                                      }
                                      className="text-xs"
                                    >
                                      {checkpoint.status}
                                    </Badge>
                                    {checkpoint.iteration != null && (
                                      <span className="text-xs text-muted-foreground">
                                        iter {checkpoint.iteration}
                                      </span>
                                    )}
                                    {checkpoint.duration_ms != null && (
                                      <span className="text-xs text-muted-foreground">
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
