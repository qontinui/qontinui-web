"use client";

import React, { useState, useMemo } from "react";
import {
  useTaskRunPlaywright,
  useTaskRunVerificationPhaseResults,
} from "@/lib/runner-api";
import type {
  LoopResult,
  PlaywrightResult,
  VerificationPhaseResult,
  VerificationStepResult,
  IndividualCheckResult,
  CheckIssueDetail,
} from "@/lib/runner-api";
import { ComparisonResultInline } from "@/components/run-detail/ComparisonResultInline";
import type { ComparisonResult } from "@/lib/runner/types/exploration";
import { Badge } from "@/components/ui/badge";
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
  FileCode,
  AlertCircle,
  SkipForward,
  Repeat,
  AlertTriangle,
  StopCircle,
  FileWarning,
  Wrench,
  Camera,
} from "lucide-react";

// =============================================================================
// Props
// =============================================================================

interface TestResultsTabProps {
  runId: string;
  /** Optional loop result for showing iteration summary */
  loopResult?: LoopResult | null;
}

// =============================================================================
// Internal Types
// =============================================================================

interface NormalizedTestResult {
  id: string;
  name: string;
  status: "passed" | "failed" | "skipped";
  duration_ms?: number;
  assertions_passed?: number;
  assertions_total?: number;
  console_output?: string;
  page_snapshot?: string;
  error_message?: string;
  stack_trace?: string;
  screenshot_path?: string;
  source: "playwright" | "verification";
  step_type?: string;
  test_type?: string;
  check_results?: IndividualCheckResult[];
  comparison_result?: ComparisonResult;
}

interface IterationGroup {
  iteration: number;
  all_passed: boolean;
  tests: NormalizedTestResult[];
  total_duration_ms: number;
}

// =============================================================================
// Utility Functions
// =============================================================================

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

// =============================================================================
// Main Component
// =============================================================================

export function TestResultsTab({ runId, loopResult }: TestResultsTabProps) {
  const { data: playwrightData, isLoading: pwLoading } =
    useTaskRunPlaywright(runId);
  const { data: verificationData, isLoading: verLoading } =
    useTaskRunVerificationPhaseResults(runId);

  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [expandedIterations, setExpandedIterations] = useState<Set<number>>(
    new Set([0])
  );

  const isLoading = pwLoading && verLoading;

  const toggleTest = (id: string) => {
    setExpandedTests((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleIteration = (iteration: number) => {
    setExpandedIterations((prev) => {
      const next = new Set(prev);
      if (next.has(iteration)) next.delete(iteration);
      else next.add(iteration);
      return next;
    });
  };

  // Convert playwright results to normalized test results
  const playwrightTests: NormalizedTestResult[] = useMemo(() => {
    if (!playwrightData) return [];
    const results = playwrightData as PlaywrightResult[];
    return results.map((r, i) => ({
      id: `playwright-${r.id ?? i}`,
      name: r.test_name || `Playwright Test ${i + 1}`,
      status: (r.status === "passed"
        ? "passed"
        : r.status === "skipped"
          ? "skipped"
          : "failed") as "passed" | "failed" | "skipped",
      duration_ms: r.duration_ms ?? undefined,
      assertions_passed: r.assertions_passed,
      assertions_total:
        r.assertions_passed != null && r.assertions_failed != null
          ? r.assertions_passed + r.assertions_failed
          : undefined,
      console_output: r.console_output ?? undefined,
      page_snapshot: r.page_snapshot ?? undefined,
      error_message: r.error_message ?? undefined,
      screenshot_path:
        r.failure_screenshot_path ?? r.screenshot_path ?? undefined,
      source: "playwright" as const,
      step_type: "playwright",
    }));
  }, [playwrightData]);

  // Convert verification phase results to iteration groups
  const iterationResults: IterationGroup[] = useMemo(() => {
    if (!verificationData?.results) return [];
    return verificationData.results.map((phase: VerificationPhaseResult) => {
      const tests: NormalizedTestResult[] = (phase.step_results ?? []).map(
        (step: VerificationStepResult, i: number) => {
          // Build console output from verification_details
          let consoleOutput: string | undefined;
          const vd = step.verification_details;
          if (vd?.console_output) {
            consoleOutput = vd.console_output;
          } else if (vd?.stdout || vd?.stderr) {
            const parts: string[] = [];
            if (vd.stdout) parts.push(vd.stdout);
            if (vd.stderr) parts.push(`[stderr]\n${vd.stderr}`);
            consoleOutput = parts.join("\n\n");
          }

          return {
            id: `verification-${phase.iteration}-${i}`,
            name: step.step_name || `Verification Step ${i + 1}`,
            status: step.success
              ? "passed"
              : step.error?.includes("Skipped")
                ? "skipped"
                : "failed",
            duration_ms: step.duration_ms,
            error_message: step.error ?? undefined,
            console_output: consoleOutput,
            page_snapshot: vd?.page_snapshot ?? undefined,
            assertions_passed: vd?.assertions_passed ?? undefined,
            assertions_total: vd?.assertions_total ?? undefined,
            source: "verification" as const,
            step_type: step.step_type,
            test_type: step.config?.test_type ?? undefined,
            check_results: vd?.check_results ?? undefined,
            comparison_result:
              (
                step as VerificationStepResult & {
                  comparison_result?: ComparisonResult;
                }
              ).comparison_result ??
              ((
                step as VerificationStepResult & {
                  output_data?: Record<string, unknown>;
                }
              ).output_data?.comparison_result as ComparisonResult | undefined),
          };
        }
      );

      return {
        iteration: phase.iteration,
        all_passed: phase.all_passed,
        tests,
        total_duration_ms: phase.total_duration_ms,
      };
    });
  }, [verificationData]);

  // Calculate combined totals
  const allVerificationTests = iterationResults.flatMap((ir) => ir.tests);
  const allTests = [...allVerificationTests, ...playwrightTests];
  const passedCount = allTests.filter((t) => t.status === "passed").length;
  const failedCount = allTests.filter((t) => t.status === "failed").length;
  const skippedCount = allTests.filter((t) => t.status === "skipped").length;

  const hasVerificationResults = iterationResults.length > 0;
  const hasPlaywrightResults = playwrightTests.length > 0;
  const hasAnyResults = hasVerificationResults || hasPlaywrightResults;

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

// =============================================================================
// Loop Result Banner
// =============================================================================

function LoopResultBanner({ loopResult }: { loopResult: LoopResult }) {
  return (
    <div
      className={`rounded-lg p-4 ${
        loopResult.verification_passed
          ? "bg-green-500/10 border border-green-500/30"
          : loopResult.critical_failure
            ? "bg-red-500/10 border border-red-500/30"
            : loopResult.was_stopped
              ? "bg-amber-500/10 border border-amber-500/30"
              : "bg-amber-500/10 border border-amber-500/30"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {loopResult.verification_passed ? (
            <CheckCircle2 className="size-5 text-green-500" />
          ) : loopResult.critical_failure ? (
            <AlertTriangle className="size-5 text-red-500" />
          ) : loopResult.was_stopped ? (
            <StopCircle className="size-5 text-amber-500" />
          ) : (
            <XCircle className="size-5 text-amber-500" />
          )}
          <span
            className={`font-medium ${
              loopResult.verification_passed
                ? "text-green-400"
                : loopResult.critical_failure
                  ? "text-red-400"
                  : "text-amber-400"
            }`}
          >
            {loopResult.verification_passed
              ? "Verification Passed"
              : loopResult.critical_failure
                ? "Critical Failure"
                : loopResult.was_stopped
                  ? "Run Stopped"
                  : loopResult.max_iterations_reached
                    ? "Max Iterations Reached"
                    : "Verification Failed"}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm text-text-muted">
          <Repeat className="size-4" />
          <span>
            {loopResult.iterations_run} iteration
            {loopResult.iterations_run !== 1 ? "s" : ""}
          </span>
        </div>
      </div>
      {loopResult.summary && (
        <p className="text-sm text-text-secondary">{loopResult.summary}</p>
      )}
      {/* Per-iteration quick summary badges */}
      {loopResult.iteration_results &&
        loopResult.iteration_results.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {loopResult.iteration_results.map((iter) => (
              <span
                key={iter.iteration}
                className={`text-xs px-2 py-1 rounded ${
                  iter.verification_passed
                    ? "bg-green-500/20 text-green-400"
                    : iter.critical_failure
                      ? "bg-red-500/20 text-red-400"
                      : "bg-amber-500/20 text-amber-400"
                }`}
              >
                #{iter.iteration}: {iter.passed_checks}/
                {iter.passed_checks + iter.failed_checks} checks
                {iter.agentic_phase_ran && (
                  <span className="ml-1">
                    {iter.agentic_phase_success ? "(AI ok)" : "(AI ran)"}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
    </div>
  );
}

// =============================================================================
// Test Result Card
// =============================================================================

interface TestResultCardProps {
  test: NormalizedTestResult;
  isExpanded: boolean;
  onToggle: () => void;
}

function TestResultCard({ test, isExpanded, onToggle }: TestResultCardProps) {
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
                  <CheckResultCard key={idx} check={check} />
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

// =============================================================================
// Check Result Card (for check_group steps)
// =============================================================================

function CheckResultCard({ check }: { check: IndividualCheckResult }) {
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

// =============================================================================
// Issue Row
// =============================================================================

function IssueRow({ issue }: { issue: CheckIssueDetail }) {
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
