"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Eye,
  Image,
} from "lucide-react";
import {
  WorkflowExecutionResult,
  CheckpointValidationResult,
  AssertionResult,
  ClaudeReviewResult,
  isMinMatchesCriteria,
  isMaxFailuresCriteria,
  isCheckpointPassedCriteria,
  isRequiredStatesCriteria,
  isCustomCriteria,
} from "@/lib/expectations/types";
import { cn } from "@/lib/utils";

export interface ExecutionResultsDisplayProps {
  result: WorkflowExecutionResult;
  className?: string;
}

/**
 * Display component for workflow execution results with expectations evaluation
 *
 * Shows:
 * - Overall success/failure status
 * - Success criteria evaluation
 * - Checkpoint results with OCR assertions
 * - Claude review results
 * - Execution metrics and errors
 */
export function ExecutionResultsDisplay({
  result,
  className,
}: ExecutionResultsDisplayProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {result.success ? (
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-500" />
            ) : (
              <XCircle className="h-6 w-6 text-red-600 dark:text-red-500" />
            )}
            <div>
              <CardTitle>
                {result.success ? "Workflow Passed" : "Workflow Failed"}
              </CardTitle>
              <CardDescription>
                {formatDuration(result.total_duration_ms)}
                {result.exceeded_max_duration && (
                  <span className="ml-2 text-yellow-600 dark:text-yellow-500">
                    (Exceeded max duration)
                  </span>
                )}
              </CardDescription>
            </div>
          </div>
          <Badge
            variant={result.success ? "default" : "destructive"}
            className={cn(
              "text-sm",
              result.success &&
                "bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800"
            )}
          >
            {result.success ? "PASS" : "FAIL"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Success Criteria */}
        {result.success_criteria && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Success Criteria</h3>
            <SuccessCriteriaDisplay criteria={result.success_criteria} />
          </div>
        )}

        {/* Actions Summary */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Actions Summary</h3>
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
              <span>
                Passed:{" "}
                <span className="font-medium">{result.actions_passed}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600 dark:text-red-500" />
              <span>
                Failed:{" "}
                <span className="font-medium">{result.actions_failed}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Checkpoint Results */}
        {result.checkpoint_results.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Checkpoint Results</h3>
            <div className="space-y-3">
              {result.checkpoint_results.map((checkpoint, index) => (
                <CheckpointResultDisplay
                  key={`${checkpoint.checkpoint_name}-${index}`}
                  checkpoint={checkpoint}
                />
              ))}
            </div>
          </div>
        )}

        {/* States Visited */}
        {result.states_visited.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">States Visited</h3>
            <div className="flex flex-wrap gap-2">
              {result.states_visited.map((state, index) => (
                <Badge key={`${state}-${index}`} variant="outline">
                  {state}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Console Errors */}
        {result.console_errors && result.console_errors.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-red-600 dark:text-red-500">
              Console Errors
            </h3>
            <div className="space-y-1">
              {result.console_errors.map((error, index) => (
                <div
                  key={index}
                  className="rounded-md bg-red-50 dark:bg-red-950/20 p-2 text-sm font-mono text-red-900 dark:text-red-400"
                >
                  {error}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Network Errors */}
        {result.network_errors && result.network_errors.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-red-600 dark:text-red-500">
              Network Errors
            </h3>
            <div className="space-y-1">
              {result.network_errors.map((error, index) => (
                <div
                  key={index}
                  className="rounded-md bg-red-50 dark:bg-red-950/20 p-2 text-sm font-mono text-red-900 dark:text-red-400"
                >
                  {error}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Overall Error */}
        {result.error && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-red-600 dark:text-red-500">
              Error
            </h3>
            <div className="rounded-md bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-900 dark:text-red-400">
              {result.error}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Display success criteria details
 */
function SuccessCriteriaDisplay({
  criteria,
}: {
  criteria: WorkflowExecutionResult["success_criteria"];
}) {
  if (!criteria) return null;

  const getCriteriaText = () => {
    if (criteria.type === "all_actions_pass") {
      return "All actions must pass";
    } else if (isMinMatchesCriteria(criteria)) {
      return `Minimum ${criteria.min_matches} matches required`;
    } else if (isMaxFailuresCriteria(criteria)) {
      return `Maximum ${criteria.max_failures} failures allowed`;
    } else if (isCheckpointPassedCriteria(criteria)) {
      if (criteria.checkpoint_name) {
        return `Checkpoint "${criteria.checkpoint_name}" must pass`;
      } else if (criteria.checkpoints) {
        return `Checkpoints must pass: ${criteria.checkpoints.join(", ")}`;
      }
      return "Checkpoint must pass";
    } else if (isRequiredStatesCriteria(criteria)) {
      return `Required states: ${criteria.required_states.join(", ")}`;
    } else if (isCustomCriteria(criteria)) {
      return `Custom: ${criteria.custom_expression}`;
    }
    return (criteria as any).type || "Unknown criteria";
  };

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="font-medium">{getCriteriaText()}</div>
      {criteria.description && (
        <div className="mt-1 text-muted-foreground">{criteria.description}</div>
      )}
    </div>
  );
}

/**
 * Display a single checkpoint result
 */
function CheckpointResultDisplay({
  checkpoint,
}: {
  checkpoint: CheckpointValidationResult;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 space-y-3",
        checkpoint.passed
          ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20"
          : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
      )}
    >
      {/* Checkpoint Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {checkpoint.passed ? (
            <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-500" />
          ) : (
            <XCircle className="h-5 w-5 text-red-600 dark:text-red-500" />
          )}
          <div>
            <div className="font-semibold">{checkpoint.checkpoint_name}</div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {formatDuration(checkpoint.duration_ms)}
            </div>
          </div>
        </div>
        <Badge variant={checkpoint.passed ? "default" : "destructive"}>
          {checkpoint.passed ? "PASS" : "FAIL"}
        </Badge>
      </div>

      {/* Assertion Results */}
      {checkpoint.assertion_results.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">
            OCR Assertions
          </h4>
          <div className="space-y-2">
            {checkpoint.assertion_results.map((assertion, index) => (
              <AssertionResultDisplay key={index} assertion={assertion} />
            ))}
          </div>
        </div>
      )}

      {/* Claude Review Results */}
      {checkpoint.claude_review_results &&
        checkpoint.claude_review_results.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
              <Eye className="h-3 w-3" />
              Claude Reviews
            </h4>
            <div className="space-y-2">
              {checkpoint.claude_review_results.map((review, index) => (
                <ClaudeReviewDisplay key={index} review={review} />
              ))}
            </div>
          </div>
        )}

      {/* Screenshot */}
      {checkpoint.screenshot_path && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Image className="h-3 w-3" />
          <span>Screenshot: {checkpoint.screenshot_path}</span>
        </div>
      )}

      {/* Error */}
      {checkpoint.error && (
        <div className="rounded-md bg-red-100 dark:bg-red-950/40 p-2 text-xs text-red-900 dark:text-red-400">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{checkpoint.error}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Display a single assertion result
 */
function AssertionResultDisplay({ assertion }: { assertion: AssertionResult }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {assertion.passed ? (
        <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-4 w-4 text-red-600 dark:text-red-500 shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="text-xs">
            {assertion.type}
          </Badge>
          <code className="text-xs bg-muted px-1 rounded">
            {assertion.pattern}
          </code>
        </div>
        {assertion.description && (
          <div className="mt-1 text-xs text-muted-foreground">
            {assertion.description}
          </div>
        )}
        {assertion.error && (
          <div className="mt-1 text-xs text-red-600 dark:text-red-500">
            {assertion.error}
          </div>
        )}
        {assertion.actual_value !== undefined && (
          <div className="mt-1 text-xs text-muted-foreground">
            Actual: {JSON.stringify(assertion.actual_value)}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Display a single Claude review result
 */
function ClaudeReviewDisplay({ review }: { review: ClaudeReviewResult }) {
  return (
    <div
      className={cn(
        "rounded-md border p-3 text-sm",
        review.passed
          ? "border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20"
          : "border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/20"
      )}
    >
      <div className="flex items-start gap-2">
        {review.passed ? (
          <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
        ) : (
          <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-500 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-xs mb-1">
            Instruction: {review.instruction}
          </div>
          <div className="text-xs text-muted-foreground">
            {review.observations}
          </div>
          {review.confidence !== undefined && (
            <div className="mt-1 text-xs text-muted-foreground">
              Confidence: {Math.round(review.confidence * 100)}%
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}
