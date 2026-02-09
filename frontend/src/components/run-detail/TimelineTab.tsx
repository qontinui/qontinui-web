"use client";

import { useTaskRunEvents } from "@/lib/runner-api";
import type { TaskRunEvent } from "@/lib/runner-api";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  PlayCircle,
} from "lucide-react";

function formatTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return dateString;
  }
}

function getPhaseColor(eventType: string): string {
  if (eventType.includes("setup"))
    return "text-blue-400 border-blue-500/30 bg-blue-500/10";
  if (eventType.includes("verification"))
    return "text-green-400 border-green-500/30 bg-green-500/10";
  if (eventType.includes("agentic"))
    return "text-purple-400 border-purple-500/30 bg-purple-500/10";
  if (eventType.includes("completion"))
    return "text-yellow-400 border-yellow-500/30 bg-yellow-500/10";
  return "text-text-muted border-border-subtle bg-surface-raised/30";
}

export function TimelineTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunEvents(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading timeline...
      </div>
    );
  }
  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Clock className="size-12 mx-auto mb-4" />
        <p>No timeline events for this run.</p>
      </div>
    );
  }

  const events = data as TaskRunEvent[];

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-6 top-0 bottom-0 w-px bg-border-subtle/50" />

      <div className="space-y-3">
        {events.map((event) => {
          const isComplete =
            event.event_type.includes("complete") ||
            event.event_type.includes("success");
          const isFailed =
            event.event_type.includes("fail") ||
            event.event_type.includes("error");

          return (
            <div
              key={event.id}
              className="relative flex items-start gap-4 pl-3"
            >
              {/* Timeline dot */}
              <div
                className={`relative z-10 flex items-center justify-center w-7 h-7 rounded-full border-2 ${
                  isComplete
                    ? "border-green-500 bg-green-500/10"
                    : isFailed
                      ? "border-red-500 bg-red-500/10"
                      : "border-border-subtle bg-surface-raised"
                }`}
              >
                {isComplete ? (
                  <CheckCircle2 className="size-3.5 text-green-500" />
                ) : isFailed ? (
                  <XCircle className="size-3.5 text-red-500" />
                ) : (
                  <PlayCircle className="size-3.5 text-text-muted" />
                )}
              </div>

              <Card className="flex-1 bg-surface-raised/30 border-border-subtle/50">
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-xs ${getPhaseColor(event.event_type)}`}
                      >
                        {event.event_type}
                      </Badge>
                    </div>
                    <span className="text-xs text-text-muted">
                      {formatTime(event.timestamp)}
                    </span>
                  </div>
                  {Object.keys(event.data).length > 0 && (
                    <pre className="mt-2 text-xs font-mono text-text-muted bg-surface-canvas/50 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
                      {JSON.stringify(event.data, null, 2)}
                    </pre>
                  )}
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
