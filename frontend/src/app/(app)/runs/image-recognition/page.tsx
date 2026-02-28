"use client";

import { useState, useMemo } from "react";
import { useRunningTaskRuns, useTaskRunEvents } from "@/lib/runner-api";
import type { TaskRunEvent } from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Image as ImageIcon,
  Target,
  MapPin,
  Inbox,
  Loader2,
} from "lucide-react";

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function isImageRecognitionEvent(event: TaskRunEvent): boolean {
  const eventType = event.event_type.toLowerCase();
  return (
    eventType.includes("image") ||
    eventType.includes("recognition") ||
    eventType.includes("template")
  );
}

function extractRecognitionFields(event: TaskRunEvent) {
  const data = event.data || {};

  const templateName =
    (data.template as string) ||
    (data.name as string) ||
    (data.template_name as string) ||
    (data.image_name as string) ||
    "Unknown Template";

  const found =
    (data.found as boolean) ??
    (data.matched as boolean) ??
    (data.match as boolean) ??
    null;

  const confidence =
    (data.confidence as number) ??
    (data.score as number) ??
    (data.match_score as number) ??
    null;

  const location = data.location as { x?: number; y?: number } | undefined;
  const x = location?.x ?? (data.x as number | undefined) ?? null;
  const y = location?.y ?? (data.y as number | undefined) ?? null;

  return { templateName, found, confidence, x, y };
}

export default function ImageRecognitionPage() {
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

  const recognitionEvents = useMemo(() => {
    if (!events) return [];
    return events.filter(isImageRecognitionEvent);
  }, [events]);

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Image Recognition</h1>
        {recognitionEvents.length > 0 && (
          <Badge variant="secondary" className="text-xs">
            {recognitionEvents.length} result
            {recognitionEvents.length !== 1 ? "s" : ""}
          </Badge>
        )}
      </header>

      {isOffline && (
        <RunnerPartialState message="Runner offline — live data unavailable" />
      )}

      <main className="flex flex-1 min-h-0">
        {/* Left panel: Run list */}
        <div className="w-[250px] shrink-0 border-r border-border bg-background">
          <div className="px-3 py-3 border-b border-border">
            <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Active Runs
            </h2>
          </div>
          <ScrollArea className="h-[calc(100%-41px)]">
            {runsLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : runList.length === 0 ? (
              <div
                data-content-role="status"
                data-content-label="empty state"
                className="px-3 py-6 text-center text-muted-foreground text-xs"
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
                        ? "bg-primary/10 border border-primary/30 text-foreground"
                        : "hover:bg-muted text-muted-foreground border border-transparent"
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
                              : "text-muted-foreground border-border"
                        }`}
                      >
                        {run.status}
                      </Badge>
                      {run.phase && (
                        <span
                          data-content-role="badge"
                          data-content-label="run phase"
                          className="text-[10px] text-muted-foreground"
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

        {/* Right panel: Image recognition log */}
        <div className="flex-1 min-w-0">
          {!activeRunId ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-muted-foreground">
                <Inbox className="size-16 mx-auto mb-4" />
                <h3
                  data-content-role="heading"
                  data-content-label="empty state title"
                  className="text-lg font-medium text-muted-foreground mb-2"
                >
                  No Run Selected
                </h3>
                <p className="text-sm">
                  Select an active run to view its image recognition results.
                </p>
              </div>
            </div>
          ) : eventsLoading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : recognitionEvents.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-muted-foreground">
                <ImageIcon className="size-16 mx-auto mb-4 opacity-30" />
                <h3
                  data-content-role="heading"
                  data-content-label="empty state title"
                  className="text-lg font-medium text-muted-foreground mb-2"
                >
                  No Recognition Results
                </h3>
                <p className="text-sm">
                  Image recognition events will appear here as the run performs
                  template matching.
                </p>
              </div>
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="p-4 space-y-3">
                {recognitionEvents.map((event) => {
                  const { templateName, found, confidence, x, y } =
                    extractRecognitionFields(event);

                  return (
                    <Card
                      key={event.id}
                      className="bg-muted/50 border-border hover:bg-muted transition-colors"
                    >
                      <CardContent className="py-4 px-5">
                        <div className="flex items-start gap-3">
                          <div className="pt-0.5">
                            <Target
                              className={`size-5 ${
                                found === true
                                  ? "text-green-400"
                                  : found === false
                                    ? "text-red-400"
                                    : "text-muted-foreground"
                              }`}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                data-content-role="label"
                                data-content-label="template name"
                                className="font-medium text-foreground text-sm"
                              >
                                {templateName}
                              </span>
                              {found === true && (
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                                  FOUND
                                </Badge>
                              )}
                              {found === false && (
                                <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                                  NOT FOUND
                                </Badge>
                              )}
                              {found === null && (
                                <Badge variant="outline">Unknown</Badge>
                              )}
                            </div>

                            <div className="flex items-center gap-4 mt-2 flex-wrap">
                              {confidence != null && (
                                <div className="flex items-center gap-1.5">
                                  <span
                                    data-content-role="label"
                                    data-content-label="confidence label"
                                    className="text-xs text-muted-foreground"
                                  >
                                    Confidence:
                                  </span>
                                  <span
                                    data-content-role="metric"
                                    data-content-label="confidence value"
                                    className={`text-xs font-medium ${
                                      confidence >= 0.8
                                        ? "text-green-400"
                                        : confidence >= 0.5
                                          ? "text-yellow-400"
                                          : "text-red-400"
                                    }`}
                                  >
                                    {(confidence * 100).toFixed(1)}%
                                  </span>
                                  {/* Confidence bar */}
                                  <div className="w-16 h-1.5 rounded-full bg-background overflow-hidden">
                                    <div
                                      className={`h-full rounded-full transition-all ${
                                        confidence >= 0.8
                                          ? "bg-green-500"
                                          : confidence >= 0.5
                                            ? "bg-yellow-500"
                                            : "bg-red-500"
                                      }`}
                                      style={{
                                        width: `${Math.min(confidence * 100, 100)}%`,
                                      }}
                                    />
                                  </div>
                                </div>
                              )}

                              {x != null && y != null && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <MapPin className="size-3" />
                                  <span
                                    data-content-role="metric"
                                    data-content-label="match coordinates"
                                    className="font-mono"
                                  >
                                    ({Math.round(x)}, {Math.round(y)})
                                  </span>
                                </div>
                              )}

                              <div
                                data-content-role="metric"
                                data-content-label="event time"
                                className="text-xs text-muted-foreground ml-auto"
                              >
                                {formatTime(event.timestamp)}
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </div>
      </main>
    </div>
  );
}
