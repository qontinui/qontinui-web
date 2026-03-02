"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  AlertCircle,
  Wrench,
} from "lucide-react";
import type {
  IndividualCheckResult,
  CheckIssueDetail,
} from "@/types/task-runs";
import { formatDurationMs } from "./utils";

function IssueDetailRow({ issue }: { issue: CheckIssueDetail }) {
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border-subtle/30 last:border-b-0">
      <div className="flex-shrink-0 mt-0.5">
        {issue.severity === "error" ? (
          <XCircle className="w-3.5 h-3.5 text-red-500" />
        ) : issue.severity === "warning" ? (
          <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 text-blue-500" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono text-text-secondary truncate">
          <span className="text-text-muted">{issue.file}</span>
          {issue.line !== null && (
            <span className="text-text-muted">:{issue.line}</span>
          )}
          {issue.column !== null && (
            <span className="text-text-muted">:{issue.column}</span>
          )}
          {issue.code && (
            <span className="ml-2 text-brand-secondary">[{issue.code}]</span>
          )}
        </div>
        <div className="text-xs text-text-secondary mt-0.5">
          {issue.message}
        </div>
      </div>
      {issue.fixable && (
        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] px-1.5 py-0 flex-shrink-0">
          <Wrench className="w-2.5 h-2.5 mr-0.5" />
          fixable
        </Badge>
      )}
    </div>
  );
}

export function CheckResultCard({ check }: { check: IndividualCheckResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasIssues = check.issues && check.issues.length > 0;
  const hasOutput = check.output || check.error_message;

  const statusColor =
    check.status === "passed"
      ? "text-green-500"
      : check.status === "failed"
        ? "text-red-500"
        : "text-yellow-500";

  return (
    <div className="border border-border-subtle/30 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        disabled={!hasIssues && !hasOutput}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-surface-raised/20 transition-colors text-left disabled:cursor-default"
      >
        <div className="flex items-center gap-2">
          {check.status === "passed" ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
          ) : check.status === "failed" ? (
            <XCircle className="w-3.5 h-3.5 text-red-500" />
          ) : (
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />
          )}
          <span className="text-sm font-medium">{check.name}</span>
          <span className={`text-xs ${statusColor}`}>{check.status}</span>
        </div>
        <div className="flex items-center gap-2">
          {check.issues_found > 0 && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-[10px] px-1.5 py-0">
              {check.issues_found} issues
            </Badge>
          )}
          {check.issues_fixed > 0 && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0">
              {check.issues_fixed} fixed
            </Badge>
          )}
          <span className="text-xs text-text-muted">
            {formatDurationMs(check.duration_ms)}
          </span>
          {(hasIssues || hasOutput) &&
            (expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-text-muted" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
            ))}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border-subtle/30 px-3 py-2 bg-surface-canvas/30 space-y-2">
          {check.error_message && (
            <div>
              <div className="text-xs font-medium text-red-400 mb-1">Error</div>
              <pre className="text-xs text-red-300 bg-red-500/10 px-2 py-1.5 rounded font-mono whitespace-pre-wrap">
                {check.error_message}
              </pre>
            </div>
          )}
          {check.output && (
            <div>
              <div className="text-xs font-medium text-text-muted mb-1">
                Output
              </div>
              <pre className="text-xs text-text-secondary bg-surface-canvas/50 px-2 py-1.5 rounded font-mono whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                {check.output}
              </pre>
            </div>
          )}
          {hasIssues && (
            <div>
              <div className="text-xs font-medium text-text-muted mb-1">
                Issues ({check.issues.length})
              </div>
              <div className="bg-surface-canvas/50 rounded px-2 py-1">
                {check.issues.map((issue, idx) => (
                  <IssueDetailRow key={idx} issue={issue} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
