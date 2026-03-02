import React from "react";
import type { CheckIssueDetail } from "@/lib/runner-api";
import { Wrench } from "lucide-react";

export function IssueRow({ issue }: { issue: CheckIssueDetail }) {
  const severityColor =
    {
      error: "text-red-400 bg-red-500/10 border-red-500/30",
      warning: "text-yellow-400 bg-yellow-500/10 border-yellow-500/30",
      info: "text-blue-400 bg-blue-500/10 border-blue-500/30",
    }[issue.severity] ||
    "text-text-muted bg-surface-raised/30 border-border-subtle/30";

  return (
    <div className={`text-xs p-2 rounded border ${severityColor}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Location */}
          <div className="font-mono text-text-muted truncate mb-1">
            {issue.file}
            {issue.line != null && `:${issue.line}`}
            {issue.column != null && `:${issue.column}`}
          </div>

          {/* Message */}
          <div className="whitespace-pre-wrap break-words">{issue.message}</div>
        </div>

        {/* Rule code and fixable indicator */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {issue.code && (
            <span className="font-mono px-1 py-0.5 rounded bg-surface-raised/50 text-text-muted">
              {issue.code}
            </span>
          )}
          {issue.fixable && (
            <span title="Auto-fixable" className="text-green-400">
              <Wrench className="size-3" />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
