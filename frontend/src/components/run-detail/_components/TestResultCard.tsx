import React from "react";
import type { NormalizedTestResult } from "../_types/test-results-types";
import { ComparisonResultInline } from "@/components/run-detail/ComparisonResultInline";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  SkipForward,
  ChevronDown,
  ChevronRight,
  Clock,
  Terminal,
  FileCode,
  AlertCircle,
  FlaskConical,
  Camera,
} from "lucide-react";
import { CheckResultCard } from "@/components/common/_components/CheckResultCard";
import { formatDurationMs } from "../_utils/test-results-utils";

interface TestResultCardProps {
  test: NormalizedTestResult;
  isExpanded: boolean;
  onToggle: () => void;
}

export function TestResultCard({
  test,
  isExpanded,
  onToggle,
}: TestResultCardProps) {
  const isPassed = test.status === "passed";
  const isSkipped = test.status === "skipped";
  const hasDetails =
    !!test.console_output ||
    !!test.page_snapshot ||
    !!test.error_message ||
    !!test.stack_trace ||
    !!test.screenshot_path ||
    (test.check_results && test.check_results.length > 0) ||
    !!test.comparison_result;

  return (
    <>
      <button
        onClick={onToggle}
        className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${
          hasDetails
            ? "hover:bg-surface-raised/40 cursor-pointer"
            : "cursor-default"
        }`}
      >
        <div className="flex items-center gap-3">
          {/* Status Icon */}
          {isPassed ? (
            <CheckCircle2 className="size-5 text-green-500" />
          ) : isSkipped ? (
            <SkipForward className="size-5 text-yellow-500" />
          ) : (
            <XCircle className="size-5 text-red-500" />
          )}

          {/* Name */}
          <span className="font-medium text-text-primary text-sm">
            {test.name}
          </span>

          {/* Test Type Badge */}
          {test.test_type && (
            <Badge variant="outline" className="text-xs">
              {test.test_type}
            </Badge>
          )}

          {/* Assertions */}
          {test.assertions_total != null && test.assertions_total > 0 && (
            <span className="text-xs text-text-muted">
              ({test.assertions_passed ?? 0}/{test.assertions_total} assertions)
            </span>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Duration */}
          {test.duration_ms != null && (
            <span className="text-sm text-text-muted flex items-center gap-1">
              <Clock className="size-3" />
              {formatDurationMs(test.duration_ms)}
            </span>
          )}

          {/* Expand indicator */}
          {hasDetails &&
            (isExpanded ? (
              <ChevronDown className="size-4 text-text-muted" />
            ) : (
              <ChevronRight className="size-4 text-text-muted" />
            ))}
        </div>
      </button>

      {isExpanded && hasDetails && (
        <div className="border-t border-border-subtle/30 p-4 space-y-4 bg-surface-canvas/30">
          {/* Individual Check Results (for check_group steps) */}
          {test.check_results && test.check_results.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-3 flex items-center gap-2 text-text-primary">
                <FlaskConical className="size-4" />
                Individual Checks (
                {test.check_results.filter((c) => c.status === "passed").length}
                /{test.check_results.length} passed)
              </h4>
              <div className="space-y-2">
                {test.check_results.map((check, idx) => (
                  <CheckResultCard
                    key={idx}
                    check={{
                      name: check.name,
                      status: check.status,
                      durationMs: check.duration_ms,
                      issuesFound: check.issues_found,
                      issuesFixed: check.issues_fixed,
                      filesChecked: check.files_checked,
                      errorMessage: check.error_message,
                      output: check.output,
                      issues: check.issues,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Console Output */}
          {test.console_output && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-text-primary">
                <Terminal className="size-4" />
                Console Output
              </h4>
              <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words bg-surface-raised/30 p-3 rounded-lg border border-border-subtle/30 max-h-40 overflow-auto">
                {test.console_output}
              </pre>
            </div>
          )}

          {/* Page Snapshot */}
          {test.page_snapshot && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-text-primary">
                <FileCode className="size-4" />
                Page Snapshot
              </h4>
              <pre className="text-xs font-mono text-text-secondary whitespace-pre-wrap break-words bg-surface-raised/30 p-3 rounded-lg border border-border-subtle/30 max-h-40 overflow-auto">
                {test.page_snapshot}
              </pre>
            </div>
          )}

          {/* Error / Stack Trace */}
          {(test.error_message || test.stack_trace) && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-red-400">
                <AlertCircle className="size-4" />
                Error Details
              </h4>
              {test.error_message && (
                <pre className="text-sm text-red-400 whitespace-pre-wrap mb-2">
                  {test.error_message}
                </pre>
              )}
              {test.stack_trace && (
                <pre className="text-xs font-mono text-red-300 whitespace-pre-wrap break-words bg-red-500/10 p-3 rounded-lg border border-red-500/30 max-h-40 overflow-auto">
                  {test.stack_trace}
                </pre>
              )}
            </div>
          )}

          {/* Failure Screenshot */}
          {test.screenshot_path && (
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2 text-text-primary">
                <Camera className="size-4" />
                Failure Screenshot
              </h4>
              <div className="text-xs text-text-muted">
                {test.screenshot_path}
              </div>
            </div>
          )}

          {/* Comparison Results */}
          {test.comparison_result && (
            <ComparisonResultInline result={test.comparison_result} />
          )}

          {/* No additional details */}
          {!test.console_output &&
            !test.page_snapshot &&
            !test.error_message &&
            !test.screenshot_path &&
            (!test.check_results || test.check_results.length === 0) &&
            !test.comparison_result && (
              <p className="text-sm text-text-muted">
                No additional details available for this test.
              </p>
            )}
        </div>
      )}
    </>
  );
}
