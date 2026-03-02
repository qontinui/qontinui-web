import { Badge } from "@/components/ui/badge";
import { MessageSquare, CheckCircle, FileText } from "lucide-react";
import type { ConversationStats } from "../_types/ai-conversation-types";

export function ConversationSummaryHeader({
  stats,
}: {
  stats: ConversationStats;
}) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-sm text-text-muted">AI Conversation</span>
      {stats.sessionCount > 0 && (
        <Badge variant="secondary" className="text-xs">
          {stats.sessionCount} session{stats.sessionCount !== 1 ? "s" : ""}
        </Badge>
      )}
      {stats.messageCount > 0 && (
        <Badge variant="outline" className="text-xs text-text-muted">
          <MessageSquare className="size-3" />
          {stats.messageCount} message{stats.messageCount !== 1 ? "s" : ""}
        </Badge>
      )}
      {stats.findingsCount > 0 && (
        <Badge
          variant="outline"
          className="text-xs text-amber-400 border-amber-500/30"
        >
          <FileText className="size-3" />
          {stats.findingsCount} finding{stats.findingsCount !== 1 ? "s" : ""}
          {Object.keys(stats.findingsBySeverity).length > 0 && (
            <span className="text-text-muted ml-1">
              (
              {Object.entries(stats.findingsBySeverity)
                .map(([sev, count]) => `${count} ${sev}`)
                .join(", ")}
              )
            </span>
          )}
        </Badge>
      )}
      {stats.stepsCompleted > 0 && (
        <Badge variant="outline" className="text-xs text-text-muted">
          <CheckCircle className="size-3" />
          {stats.stepsCompleted} step{stats.stepsCompleted !== 1 ? "s" : ""}
        </Badge>
      )}
      {stats.taskComplete && (
        <Badge
          variant="outline"
          className="text-xs text-emerald-400 border-emerald-500/30"
        >
          <CheckCircle className="size-3" />
          Complete
        </Badge>
      )}
    </div>
  );
}
