"use client";

import { useTaskRunEvents } from "@/lib/runner-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Clock, RefreshCw, CheckCircle2, XCircle } from "lucide-react";

export function ExecutionTimelineWidget({ runId }: { runId: string }) {
  const { data, isLoading } = useTaskRunEvents(runId);

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="size-4 text-blue-400" />
            Timeline
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const events = data ?? [];
  const recentEvents = events.slice(-20);

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <Clock className="size-4 text-blue-400" />
          Timeline
          <Badge variant="secondary" className="text-xs">
            {events.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4">
        <ScrollArea className="h-full">
          <div className="space-y-1.5">
            {recentEvents.map((event) => {
              const isSuccess =
                event.event_type.includes("complete") ||
                event.event_type.includes("success");
              const isError =
                event.event_type.includes("error") ||
                event.event_type.includes("fail");
              return (
                <div key={event.id} className="flex items-center gap-2 text-xs">
                  {isSuccess ? (
                    <CheckCircle2 className="size-3 text-green-500 shrink-0" />
                  ) : isError ? (
                    <XCircle className="size-3 text-red-500 shrink-0" />
                  ) : (
                    <div className="size-3 rounded-full bg-border-subtle shrink-0" />
                  )}
                  <Badge variant="outline" className="text-[10px] shrink-0">
                    {event.event_type}
                  </Badge>
                  <span className="text-text-muted truncate">
                    {new Date(event.timestamp).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </div>
              );
            })}
            {recentEvents.length === 0 && (
              <p className="text-xs text-text-muted">No events yet...</p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
