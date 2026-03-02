"use client";

import React, { useState } from "react";
import type { IndividualCheckResult } from "@/lib/runner-api";
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
} from "lucide-react";
import { IssueRow } from "./IssueRow";
import { formatDurationMs } from "../_utils/test-results-utils";

export function CheckResultCard({ check }: { check: IndividualCheckResult }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isPassed = check.status === "passed";
  const isSkipped = check.status === "skipped";
  const hasIssues = check.issues && check.issues.length > 0;
  const hasDetails = hasIssues || !!check.error_message || !!check.output;

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

          {check.issues_found > 0 && (
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                isPassed
                  ? "bg-green-500/20 text-green-400"
                  : "bg-red-500/20 text-red-400"
              }`}
            >
              {check.issues_found} issue{check.issues_found !== 1 ? "s" : ""}
              {check.issues_fixed > 0 && ` (${check.issues_fixed} fixed)`}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {formatDurationMs(check.duration_ms)}
          </span>

          {check.files_checked > 0 && (
            <span>
              {check.files_checked} file{check.files_checked !== 1 ? "s" : ""}
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
          {check.error_message && (
            <div>
              <h5 className="text-xs font-medium text-red-400 mb-1 flex items-center gap-1">
                <AlertCircle className="size-3" />
                Error
              </h5>
              <pre className="text-xs font-mono bg-red-500/10 p-2 rounded text-red-300 whitespace-pre-wrap overflow-x-auto max-h-24 overflow-y-auto">
                {check.error_message}
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
