"use client";

import React from "react";
import {
  RefreshCw,
  FlaskConical,
  CheckCircle2,
  XCircle,
  MinusCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  Terminal,
  Repeat,
} from "lucide-react";
import type { TestResultsTabProps } from "./_types/test-results-types";
import { useTestResults } from "./_hooks/useTestResults";
import { formatDurationMs } from "./_utils/test-results-utils";
import { LoopResultBanner } from "./_components/LoopResultBanner";
import { TestResultCard } from "./_components/TestResultCard";

export function TestResultsTab({ runId, loopResult }: TestResultsTabProps) {
  const {
    isLoading,
    playwrightTests,
    iterationResults,
    expandedTests,
    expandedIterations,
    toggleTest,
    toggleIteration,
    allTests,
    passedCount,
    failedCount,
    skippedCount,
    hasVerificationResults,
    hasPlaywrightResults,
    hasAnyResults,
  } = useTestResults(runId);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading test results...
      </div>
    );
  }

  if (!hasAnyResults) {
    return (
      <div className="text-center py-12 text-text-muted">
        <FlaskConical className="size-12 mx-auto mb-4" />
        <p className="font-medium">No test results for this run.</p>
        <p className="text-sm mt-1">
          Tests will appear here when a workflow includes verification or test
          execution steps.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Loop Result Summary Banner */}
      {loopResult && <LoopResultBanner loopResult={loopResult} />}

      {/* Combined Stats Bar */}
      <div className="flex items-center gap-4 p-3 rounded-lg bg-surface-raised/30 border border-border-subtle/50 flex-wrap">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-brand-primary" />
          <span className="text-sm font-medium text-text-primary">
            Test Results
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-green-400 flex items-center gap-1">
            <CheckCircle2 className="size-3.5 text-green-500" />
            {passedCount} passed
          </span>
          <span className="text-red-400 flex items-center gap-1">
            <XCircle className="size-3.5 text-red-500" />
            {failedCount} failed
          </span>
          {skippedCount > 0 && (
            <span className="text-yellow-400 flex items-center gap-1">
              <MinusCircle className="size-3.5 text-yellow-500" />
              {skippedCount} skipped
            </span>
          )}
          <span className="text-text-muted">{allTests.length} total</span>
        </div>
      </div>

      {/* Verification Phase Results (grouped by iteration) */}
      {hasVerificationResults && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-text-muted flex items-center gap-2">
            <Repeat className="size-4" />
            Verification Results ({iterationResults.length} iteration
            {iterationResults.length !== 1 ? "s" : ""})
          </h4>
          {iterationResults.map((iteration) => {
            const isExpanded = expandedIterations.has(iteration.iteration);
            const iterationPassed = iteration.tests.filter(
              (t) => t.status === "passed"
            ).length;

            return (
              <div
                key={`iteration-${iteration.iteration}`}
                className="rounded-lg border border-border-subtle/50 bg-surface-raised/20 overflow-hidden"
              >
                <button
                  onClick={() => toggleIteration(iteration.iteration)}
                  className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-raised/40 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {iteration.all_passed ? (
                      <CheckCircle2 className="size-5 text-green-500" />
                    ) : (
                      <XCircle className="size-5 text-red-500" />
                    )}
                    <span className="font-medium text-text-primary">
                      Iteration {iteration.iteration}
                    </span>
                    <span className="text-xs text-text-muted">
                      ({iterationPassed}/{iteration.tests.length} passed)
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-text-muted flex items-center gap-1">
                      <Clock className="size-3" />
                      {formatDurationMs(iteration.total_duration_ms)}
                    </span>
                    {isExpanded ? (
                      <ChevronDown className="size-4 text-text-muted" />
                    ) : (
                      <ChevronRight className="size-4 text-text-muted" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-border-subtle/30 divide-y divide-border-subtle/30">
                    {iteration.tests.map((test) => (
                      <TestResultCard
                        key={test.id}
                        test={test}
                        isExpanded={expandedTests.has(test.id)}
                        onToggle={() => toggleTest(test.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Playwright Results */}
      {hasPlaywrightResults && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-text-muted flex items-center gap-2">
            <Terminal className="size-4" />
            Playwright Test Results
          </h4>
          <div className="space-y-2">
            {playwrightTests.map((test) => (
              <div
                key={test.id}
                className="rounded-lg border border-border-subtle/50 bg-surface-raised/20 overflow-hidden"
              >
                <TestResultCard
                  test={test}
                  isExpanded={expandedTests.has(test.id)}
                  onToggle={() => toggleTest(test.id)}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
