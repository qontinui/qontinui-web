"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  SkipForward,
  ChevronDown,
  ChevronRight,
  Clock,
  Terminal,
  AlertCircle,
  FileWarning,
  Wrench,
} from "lucide-react";
import { formatDurationMs } from "@/lib/time-utils";

// ---------------------------------------------------------------------------
// Local prop types — compatible with both @qontinui/shared-types and
// @/lib/runner/types/task-run definitions so callers from either type
// system can pass data without casting.
// ---------------------------------------------------------------------------

interface CheckIssueDetailProps {
  file: string;
  line?: number | null;
  column?: number | null;
  code?: string | null;
  message: string;
  severity: string;
  fixable?: boolean;
}

interface CheckResultProps {
  name: string;
  status: string;
  durationMs: number;
  issuesFound: number;
  issuesFixed: number;
  filesChecked: number;
  errorMessage?: string | null;
  output?: string | null;
  issues: CheckIssueDetailProps[];
}

// ---------------------------------------------------------------------------
// IssueRow (inline sub-component)
// ---------------------------------------------------------------------------

function IssueRow({ issue }: { issue: CheckIssueDetailProps }) {
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

// ---------------------------------------------------------------------------
// CheckResultCard
// ---------------------------------------------------------------------------

export function CheckResultCard({ check }: { check: CheckResultProps }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isPassed = check.status === "passed";
  const isSkipped = check.status === "skipped";
  const hasIssues = check.issues && check.issues.length > 0;
  const hasDetails = hasIssues || !!check.errorMessage || !!check.output;

  return (
    <div
      className={`rounded-lg border ${
        isPassed
          ? "border-green-500/30 bg-green-500/5"
          : isSkipped
            ? "border-yellow-500/30 bg-yellow-500/5"
            : "border-red-500/30 bg-red-500/5"
      }`}
    >
      <button
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
        className={`w-full px-3 py-2 flex items-center justify-between text-left ${
          hasDetails
            ? "hover:bg-surface-raised/30 cursor-pointer"
            : "cursor-default"
        }`}
        disabled={!hasDetails}
      >
        <div className="flex items-center gap-2">
          {isPassed ? (
            <CheckCircle2 className="size-4 text-green-500 flex-shrink-0" />
          ) : isSkipped ? (
            <SkipForward className="size-4 text-yellow-500 flex-shrink-0" />
          ) : (
            <XCircle className="size-4 text-red-500 flex-shrink-0" />
          )}

          <span className="text-sm font-medium text-text-primary">
            {check.name}
          </span>

          {check.issuesFound > 0 && (
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                isPassed
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              }`}
            >
              {check.issuesFound} issue{check.issuesFound !== 1 ? "s" : ""}
              {check.issuesFixed > 0 && ` (${check.issuesFixed} fixed)`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatDurationMs(check.durationMs)}
          </span>

          {check.filesChecked > 0 && (
            <span>
              {check.filesChecked} file{check.filesChecked !== 1 ? "s" : ""}
            </span>
          )}

          {hasDetails &&
            (isExpanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            ))}
        </div>
      </button>

      {isExpanded && hasDetails && (
        <div className="border-t border-border-subtle/30 px-3 py-2 space-y-3">
          {/* Error message */}
          {check.errorMessage && (
            <div>
              <h5 className="text-xs font-medium text-red-400 mb-1 flex items-center gap-1">
                <AlertCircle className="size-3" />
                Error
              </h5>
              <pre className="text-xs font-mono bg-red-500/10 p-2 rounded text-red-300 whitespace-pre-wrap overflow-x-auto max-h-24 overflow-y-auto">
                {check.errorMessage}
              </pre>
            </div>
          )}

          {/* Individual issues */}
          {hasIssues && (
            <div>
              <h5 className="text-xs font-medium text-text-muted mb-2 flex items-center gap-1">
                <FileWarning className="size-3" />
                Issues ({check.issues.length}
                {check.issues.length >= 50 ? "+" : ""})
              </h5>
              <div className="space-y-1 max-h-60 overflow-y-auto">
                {check.issues.map((issue, idx) => (
                  <IssueRow key={idx} issue={issue} />
                ))}
              </div>
            </div>
          )}

          {/* Raw output (only when no structured issues) */}
          {check.output && !hasIssues && (
            <div>
              <h5 className="text-xs font-medium text-text-muted mb-1 flex items-center gap-1">
                <Terminal className="size-3" />
                Output
              </h5>
              <pre className="text-xs font-mono bg-surface-raised/30 p-2 rounded text-text-secondary whitespace-pre-wrap overflow-x-auto max-h-32 overflow-y-auto">
                {check.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
