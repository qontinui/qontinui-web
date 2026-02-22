"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertTriangle,
  Shield,
  ShieldCheck,
  ShieldX,
  SkipForward,
  Activity,
  FileCode,
  Terminal as TerminalIcon,
  AlertCircle,
  Wrench,
} from "lucide-react";
import { useBackendVerificationResults } from "@/hooks/useTaskRunsBackend";
import { ComparisonResultInline } from "@/components/run-detail/ComparisonResultInline";
import type { ComparisonResult } from "@/lib/runner/types/exploration";
import type {
  VerificationResultResponse,
  VerificationStepResult,
  IndividualCheckResult,
  CheckIssueDetail,
} from "@/types/task-runs";

interface VerificationResultsTabProps {
  taskId: string;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function StepStatusIcon({ success }: { success: boolean }) {
  if (success) {
    return <CheckCircle2 className="w-4 h-4 text-green-500 flex-shrink-0" />;
  }
  return <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />;
}

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

function CheckResultCard({ check }: { check: IndividualCheckResult }) {
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

function StepResultCard({ step }: { step: VerificationStepResult }) {
  const [expanded, setExpanded] = useState(false);
  const details = step.verification_details;
  const hasExpandableContent =
    step.error ||
    details?.stdout ||
    details?.stderr ||
    details?.console_output ||
    details?.assertions_total !== null ||
    (details?.check_results && details.check_results.length > 0);

  return (
    <div className="border border-border-subtle/30 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        disabled={!hasExpandableContent}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-surface-raised/20 transition-colors text-left disabled:cursor-default"
      >
        <div className="flex items-center gap-3">
          <StepStatusIcon success={step.success} />
          <div>
            <div className="text-sm font-medium">{step.step_name}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge className="bg-surface-raised text-text-muted border-border-subtle text-[10px] px-1.5 py-0">
                {step.step_type}
              </Badge>
              {step.config?.check_type && (
                <Badge className="bg-brand-secondary/10 text-brand-secondary border-brand-secondary/30 text-[10px] px-1.5 py-0">
                  {step.config.check_type}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">
            <Clock className="w-3 h-3 inline mr-1" />
            {formatDurationMs(step.duration_ms)}
          </span>
          {hasExpandableContent &&
            (expanded ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            ))}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border-subtle/30 px-4 py-3 bg-surface-canvas/30 space-y-3">
          {step.error && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-red-400 mb-1">
                <AlertTriangle className="w-3 h-3" />
                Error
              </div>
              <pre className="text-xs text-red-300 bg-red-500/10 px-3 py-2 rounded font-mono whitespace-pre-wrap">
                {step.error}
              </pre>
            </div>
          )}

          {details?.assertions_total !== null &&
            details?.assertions_total !== undefined && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
                  <ShieldCheck className="w-3 h-3" />
                  Assertions
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    className={`text-[10px] px-1.5 py-0 ${
                      details.assertions_passed === details.assertions_total
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : "bg-red-500/20 text-red-400 border-red-500/30"
                    }`}
                  >
                    {details.assertions_passed ?? 0} /{" "}
                    {details.assertions_total} passed
                  </Badge>
                </div>
              </div>
            )}

          {details?.exit_code !== null && details?.exit_code !== undefined && (
            <div className="text-xs text-text-muted">
              Exit code:{" "}
              <span
                className={
                  details.exit_code === 0 ? "text-green-400" : "text-red-400"
                }
              >
                {details.exit_code}
              </span>
            </div>
          )}

          {details?.stdout && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
                <TerminalIcon className="w-3 h-3" />
                stdout
              </div>
              <pre className="text-xs text-text-secondary bg-surface-canvas/50 px-3 py-2 rounded font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {details.stdout}
              </pre>
            </div>
          )}

          {details?.stderr && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-yellow-400 mb-1">
                <AlertCircle className="w-3 h-3" />
                stderr
              </div>
              <pre className="text-xs text-yellow-300 bg-yellow-500/10 px-3 py-2 rounded font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {details.stderr}
              </pre>
            </div>
          )}

          {details?.console_output && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-1">
                <FileCode className="w-3 h-3" />
                Console Output
              </div>
              <pre className="text-xs text-text-secondary bg-surface-canvas/50 px-3 py-2 rounded font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                {details.console_output}
              </pre>
            </div>
          )}

          {details?.check_results && details.check_results.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted mb-2">
                <Activity className="w-3 h-3" />
                Check Results ({details.check_results.length})
              </div>
              <div className="space-y-1.5">
                {details.check_results.map((check, idx) => (
                  <CheckResultCard key={idx} check={check} />
                ))}
              </div>
            </div>
          )}

          {/* Comparison Results (from UI Bridge compare steps) */}
          {(() => {
            const compResult =
              step.comparison_result ??
              (step.output_data?.comparison_result as
                | ComparisonResult
                | undefined);
            return compResult ? (
              <ComparisonResultInline result={compResult} />
            ) : null;
          })()}
        </div>
      )}
    </div>
  );
}

function IterationCard({ result }: { result: VerificationResultResponse }) {
  const [expanded, setExpanded] = useState(false);
  const phase = result.result_json;

  return (
    <div className="border border-border-subtle/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-raised/30 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="flex-shrink-0">
            {result.all_passed ? (
              <ShieldCheck className="w-6 h-6 text-green-500" />
            ) : result.critical_failure ? (
              <ShieldX className="w-6 h-6 text-red-500" />
            ) : (
              <Shield className="w-6 h-6 text-yellow-500" />
            )}
          </div>
          <div className="text-left">
            <div className="font-medium">Iteration {result.iteration}</div>
            <div className="text-sm text-text-muted mt-0.5">
              {formatDurationMs(result.total_duration_ms)}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {result.passed_steps > 0 && (
            <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
              <CheckCircle2 className="w-3 h-3 mr-1" />
              {result.passed_steps} passed
            </Badge>
          )}
          {result.failed_steps > 0 && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
              <XCircle className="w-3 h-3 mr-1" />
              {result.failed_steps} failed
            </Badge>
          )}
          {result.skipped_steps > 0 && (
            <Badge className="bg-surface-raised text-text-muted border-border-subtle">
              <SkipForward className="w-3 h-3 mr-1" />
              {result.skipped_steps} skipped
            </Badge>
          )}
          {result.critical_failure && (
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Critical
            </Badge>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border-subtle/50 px-5 py-4 bg-surface-canvas/30 space-y-4">
          {/* Gate results */}
          {phase.gate_based_evaluation &&
            phase.gate_results &&
            phase.gate_results.length > 0 && (
              <div>
                <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
                  Gate Evaluations
                </div>
                <div className="flex flex-wrap gap-2">
                  {phase.gate_results.map((gate, idx) => (
                    <Badge
                      key={idx}
                      className={`text-xs ${
                        gate.passed
                          ? "bg-green-500/20 text-green-400 border-green-500/30"
                          : "bg-red-500/20 text-red-400 border-red-500/30"
                      }`}
                    >
                      {gate.passed ? (
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                      ) : (
                        <XCircle className="w-3 h-3 mr-1" />
                      )}
                      {gate.gate_name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

          {/* Step results */}
          <div>
            <div className="text-xs font-medium text-text-muted mb-2 uppercase tracking-wider">
              Step Results ({phase.step_results.length})
            </div>
            <div className="space-y-2">
              {phase.step_results.map((step, idx) => (
                <StepResultCard key={idx} step={step} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function VerificationResultsTab({
  taskId,
}: VerificationResultsTabProps) {
  const { data, isLoading, error } = useBackendVerificationResults(taskId);

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-6">
          <div className="text-center py-8 text-text-muted">
            <div className="flex items-center justify-center gap-2">
              <Clock className="w-5 h-5 animate-spin" />
              Loading verification results...
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-6">
          <div className="text-center py-8 text-red-400">
            <AlertTriangle className="w-8 h-8 mx-auto mb-3" />
            <p>Error loading verification results</p>
            <p className="text-sm text-text-muted mt-1">
              {(error as Error).message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.count === 0) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-6">
          <div className="text-center py-8 text-text-muted">
            <Shield className="w-12 h-12 mx-auto mb-4 text-text-muted/50" />
            <p>No verification results recorded for this task</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const passRate =
    data.count > 0
      ? Math.round((data.passed_iterations / data.count) * 100)
      : 0;

  return (
    <div className="space-y-4">
      {/* Summary Banner */}
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-brand-secondary">
                  {data.count}
                </div>
                <div className="text-xs text-text-muted">Iterations</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-green-500">
                  {data.passed_iterations}
                </div>
                <div className="text-xs text-text-muted">Passed</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-red-500">
                  {data.failed_iterations}
                </div>
                <div className="text-xs text-text-muted">Failed</div>
              </div>
            </div>
            <div className="text-right">
              <div
                className={`text-3xl font-bold ${
                  passRate === 100
                    ? "text-green-500"
                    : passRate >= 50
                      ? "text-yellow-500"
                      : "text-red-500"
                }`}
              >
                {passRate}%
              </div>
              <div className="text-xs text-text-muted">Pass Rate</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Iteration Cards */}
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-lg">Verification Iterations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...data.results]
              .sort((a, b) => b.iteration - a.iteration)
              .map((result) => (
                <IterationCard key={result.id} result={result} />
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
