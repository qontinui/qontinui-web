import type { TaskRunEvent } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, PlayCircle, XCircle } from "lucide-react";

export function FlatEventTimeline({ events }: { events: TaskRunEvent[] }) {
  return (
    <div className="relative">
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
              <div className="flex-1 rounded-lg border border-border-subtle/50 bg-surface-raised/30 py-3 px-4">
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="text-xs">
                    {event.event_type}
                  </Badge>
                  <span className="text-xs text-text-muted">
                    {new Date(event.timestamp).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    })}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
