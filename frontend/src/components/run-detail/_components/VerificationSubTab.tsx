"use client";

import { useExpandableSet } from "@/hooks/useExpandableSet";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  RefreshCw,
  FlaskConical,
} from "lucide-react";
import {
  useTaskRunVerification,
  type VerificationData,
} from "@/lib/runner-api";
import { formatDateTime } from "../_utils/summary-tab-utils";

// =============================================================================
// VerificationSubTab
// =============================================================================

export function VerificationSubTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunVerification(runId);
  const { expanded: expandedResults, toggle: toggleResult } =
    useExpandableSet<number>();

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading verification results...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 text-red-400">
        <AlertTriangle className="size-5 mx-auto mb-2" />
        Failed to load verification results
      </div>
    );
  }

  const verificationData = data as VerificationData | null;

  if (!verificationData || verificationData.results.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <FlaskConical className="size-12 mx-auto mb-4 opacity-50" />
        <h3 className="font-medium text-lg mb-2">No Verification Results</h3>
        <p className="text-sm text-text-secondary max-w-md mx-auto">
          No verification steps have been executed for this run. Verification
          steps include tests, checks, and other validation tasks defined in
          your workflow.
        </p>
      </div>
    );
  }

  const { results, summary } = verificationData;

  // Compute summary from results if not provided by API
  const totalCount = summary?.total ?? results.length;
  const passedCount = summary?.passed ?? results.filter((r) => r.passed).length;
  const failedCount =
    summary?.failed ?? results.filter((r) => !r.passed).length;
  const allPassed = summary?.all_passed ?? failedCount === 0;

  return (
    <div className="space-y-4">
      {/* Summary Banner */}
      <div
        className={`rounded-lg p-4 ${
          allPassed
            ? "bg-green-500/10 text-green-500"
            : "bg-amber-500/10 text-amber-500"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {allPassed ? (
              <CheckCircle2 className="size-6" />
            ) : (
              <AlertTriangle className="size-6" />
            )}
            <div>
              <h3 className="font-medium">
                {allPassed
                  ? "All Verification Passed"
                  : `${failedCount} of ${totalCount} Checks Failed`}
              </h3>
              <p className="text-sm opacity-80">
                {totalCount} verification check{totalCount !== 1 ? "s" : ""}{" "}
                executed
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">
              {passedCount}/{totalCount}
            </div>
            <div className="text-xs opacity-80">checks passed</div>
          </div>
        </div>
      </div>

      {/* Individual Result Cards */}
      <div className="space-y-2">
        {results.map((result, index) => {
          const isExpanded = expandedResults.has(index);
          const hasDetails = !!result.observation;

          return (
            <div
              key={result.id ?? index}
              className="border border-border-subtle/50 rounded-lg overflow-hidden bg-surface-raised/30"
            >
              {/* Card Header (clickable) */}
              <button
                onClick={() => toggleResult(index)}
                disabled={!hasDetails}
                className={`w-full px-4 py-3 flex items-center justify-between transition-colors ${
                  hasDetails
                    ? "hover:bg-surface-canvas/50 cursor-pointer"
                    : "cursor-default"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Status icon */}
                  {result.passed ? (
                    <CheckCircle2 className="size-5 text-green-500" />
                  ) : (
                    <XCircle className="size-5 text-red-500" />
                  )}

                  {/* Type icon */}
                  <div
                    className={`p-1.5 rounded ${
                      result.passed
                        ? "bg-green-500/10 text-green-500"
                        : "bg-red-500/10 text-red-500"
                    }`}
                  >
                    <ShieldCheck className="size-4" />
                  </div>

                  {/* Criterion text */}
                  <span className="font-medium text-sm text-text-primary text-left">
                    {result.criterion}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Confidence badge */}
                  <Badge
                    variant={
                      result.confidence >= 0.8
                        ? "success"
                        : result.confidence >= 0.5
                          ? "warning"
                          : "destructive"
                    }
                    className="text-xs"
                  >
                    {Math.round(result.confidence * 100)}%
                  </Badge>

                  {/* Timestamp */}
                  <span className="text-xs text-text-muted flex items-center gap-1">
                    <Clock className="size-3" />
                    {formatDateTime(result.verified_at)}
                  </span>

                  {/* Expand chevron */}
                  {hasDetails &&
                    (isExpanded ? (
                      <ChevronDown className="size-4 text-text-muted" />
                    ) : (
                      <ChevronRight className="size-4 text-text-muted" />
                    ))}
                </div>
              </button>

              {/* Expanded details */}
              {isExpanded && hasDetails && (
                <div className="border-t border-border-subtle/50 p-4 bg-surface-canvas/30">
                  <h4 className="text-sm font-medium mb-1 text-text-secondary">
                    Observation
                  </h4>
                  <p className="text-sm text-text-muted whitespace-pre-wrap">
                    {result.observation}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
