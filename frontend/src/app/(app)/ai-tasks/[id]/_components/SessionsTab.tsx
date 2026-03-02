import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { formatDuration } from "./utils";
import type { TaskRunSession } from "@/types/task-runs";

interface SessionsTabProps {
  sessions: TaskRunSession[] | undefined;
  isExpanded: (id: string) => boolean;
  onToggle: (id: string) => void;
}

export function SessionsTab({
  sessions,
  isExpanded,
  onToggle,
}: SessionsTabProps) {
  if (!sessions || sessions.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No sessions recorded for this task
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sessions.map((session, index) => (
        <div
          key={session.id}
          className="border border-border rounded-lg overflow-hidden"
        >
          <button
            onClick={() => onToggle(session.id)}
            className="w-full p-4 flex items-center justify-between hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary text-sm font-medium">
                {index + 1}
              </div>
              <div className="text-left">
                <div className="font-medium">
                  Session {session.session_number || index + 1}
                </div>
                <div className="text-sm text-muted-foreground">
                  {format(
                    new Date(session.started_at),
                    "MMM dd, yyyy HH:mm:ss"
                  )}
                  {" - "}
                  {session.ended_at
                    ? format(new Date(session.ended_at), "HH:mm:ss")
                    : "In progress..."}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-sm text-muted-foreground">
                {formatDuration(session.duration_seconds)}
              </div>
              {session.ended_at ? (
                <Badge className="bg-green-500/10 text-green-500 border-green-500/30">
                  Complete
                </Badge>
              ) : (
                <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/30">
                  In Progress
                </Badge>
              )}
              {isExpanded(session.id) ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </div>
          </button>
          {isExpanded(session.id) && session.output_summary && (
            <div className="border-t border-border p-4 bg-muted/50">
              <pre className="text-sm text-muted-foreground whitespace-pre-wrap font-mono overflow-x-auto max-h-[400px] overflow-y-auto">
                {session.output_summary}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
