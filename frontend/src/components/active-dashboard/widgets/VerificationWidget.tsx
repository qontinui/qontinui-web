"use client";

import { useState } from "react";
import type {
  VerificationData,
  VerificationResult,
  VerificationSummary,
  CurrentExecutionStep,
} from "@/lib/runner-api";
import { useEventTriggeredFetch } from "@/contexts/RunnerEventContext";
import { useSharedStepsData } from "@/contexts/SharedRunnerDataContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronUp,
  Clock,
  Terminal,
  AlertTriangle,
} from "lucide-react";

// =============================================================================
// Step type icon/badge mapping
// =============================================================================

const STEP_TYPE_LABELS: Record<string, string> = {
  playwright: "Playwright",
  check: "Check",
  check_group: "Checks",
  shell: "Shell",
  test: "Test",
  error_check: "Error",
  log_check: "Log",
  gui_automation: "GUI",
  repo_test: "Repo",
  verification: "Verify",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

// =============================================================================
// Expandable Check Step Row (for execution steps fallback)
// =============================================================================

function CheckStepRow({ step }: { step: CurrentExecutionStep }) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!step.error || !!step.output || !!step.stdout;
  const typeLower = step.step_type.toLowerCase();
  const typeLabel =
    STEP_TYPE_LABELS[typeLower] ||
    (step.command_mode ? STEP_TYPE_LABELS[step.command_mode] : null) ||
    step.step_type;

  return (
    <div className="border border-border-subtle/20 rounded overflow-hidden">
      <button
        onClick={() => hasDetails && setExpanded(!expanded)}
        disabled={!hasDetails}
        className="w-full px-2 py-1.5 flex items-center gap-2 text-xs hover:bg-surface-raised/20 transition-colors text-left disabled:cursor-default"
      >
        {/* Status icon */}
        {step.status === "success" ? (
          <CheckCircle2 className="size-3.5 text-green-500 shrink-0" />
        ) : step.status === "failed" ? (
          <XCircle className="size-3.5 text-red-500 shrink-0" />
        ) : step.status === "running" ? (
          <Loader2 className="size-3.5 text-blue-400 animate-spin shrink-0" />
        ) : (
          <div className="size-3.5 rounded-full border border-border-subtle/50 shrink-0" />
        )}

        {/* Type badge */}
        <Badge className="bg-surface-raised text-text-muted border-border-subtle text-[9px] px-1 py-0 shrink-0">
          {typeLabel}
        </Badge>

        {/* Step name */}
        <span className="text-text-secondary truncate flex-1 min-w-0">
          {step.step_name}
        </span>

        {/* Duration */}
        {step.duration_ms != null && (
          <span className="text-text-muted shrink-0 flex items-center gap-0.5">
            <Clock className="size-2.5" />
            {formatDuration(step.duration_ms)}
          </span>
        )}

        {/* Expand indicator */}
        {hasDetails &&
          (expanded ? (
            <ChevronUp className="size-3 text-text-muted shrink-0" />
          ) : (
            <ChevronDown className="size-3 text-text-muted shrink-0" />
          ))}
      </button>

      {expanded && hasDetails && (
        <div className="border-t border-border-subtle/20 px-2 py-1.5 bg-surface-canvas/30 space-y-1">
          {step.error && (
            <div>
              <div className="flex items-center gap-1 text-[10px] font-medium text-red-400 mb-0.5">
                <AlertTriangle className="size-2.5" />
                Error
              </div>
              <pre className="text-[10px] text-red-300 bg-red-500/10 px-2 py-1 rounded font-mono whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                {step.error}
              </pre>
            </div>
          )}
          {step.stdout && (
            <div>
              <div className="flex items-center gap-1 text-[10px] font-medium text-text-muted mb-0.5">
                <Terminal className="size-2.5" />
                stdout
              </div>
              <pre className="text-[10px] text-text-secondary bg-surface-canvas/50 px-2 py-1 rounded font-mono whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                {step.stdout}
              </pre>
            </div>
          )}
          {step.output && !step.stdout && (
            <div>
              <div className="flex items-center gap-1 text-[10px] font-medium text-text-muted mb-0.5">
                <Terminal className="size-2.5" />
                Output
              </div>
              <pre className="text-[10px] text-text-secondary bg-surface-canvas/50 px-2 py-1 rounded font-mono whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                {step.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Stats Bar
// =============================================================================

function StatsBar({
  total,
  passed,
  failed,
  running,
}: {
  total: number;
  passed: number;
  failed: number;
  running: number;
}) {
  const completed = passed + failed;

  return (
    <div className="flex items-center gap-2 text-[10px] text-text-muted mb-2">
      <span>
        {completed}/{total} completed
      </span>
      {passed > 0 && (
        <span className="flex items-center gap-0.5">
          <span className="size-1.5 rounded-full bg-green-500 inline-block" />
          {passed}
        </span>
      )}
      {failed > 0 && (
        <span className="flex items-center gap-0.5">
          <span className="size-1.5 rounded-full bg-red-500 inline-block" />
          {failed}
        </span>
      )}
      {running > 0 && (
        <span className="flex items-center gap-0.5">
          <span className="size-1.5 rounded-full bg-blue-400 inline-block animate-pulse" />
          {running}
        </span>
      )}
    </div>
  );
}

// =============================================================================
// Main Widget
// =============================================================================

export function VerificationWidget({ runId }: { runId: string }) {
  const { data, isLoading } = useEventTriggeredFetch<VerificationData>(
    "step-progress",
    `/task-runs/${runId}/verification-results`,
    {
      transform: (raw: unknown) => {
        const obj = raw as Record<string, unknown>;
        if (
          obj &&
          typeof obj === "object" &&
          "results" in obj &&
          Array.isArray(obj.results)
        ) {
          return {
            results: obj.results as VerificationResult[],
            summary: (obj.summary as VerificationSummary) ?? null,
          };
        }
        if (Array.isArray(raw))
          return { results: raw as VerificationResult[], summary: null };
        return { results: [], summary: null };
      },
    }
  );
  const { data: stepsData } = useSharedStepsData();

  // Extract check steps from execution steps as supplementary data
  // Match all verification-related step types (aligned with runner's mapCheckType)
  const checkSteps = (stepsData?.executions || []).filter((e) => {
    const t = e.step_type.toLowerCase();
    return (
      [
        "check",
        "check_group",
        "playwright",
        "verification",
        "test",
        "error_check",
        "log_check",
        "shell",
        "gui_automation",
        "repo_test",
      ].includes(t) ||
      t.includes("check") ||
      t.includes("verification")
    );
  });

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/30 border-border-subtle/50 h-full">
        <CardHeader className="py-3 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="size-4 text-green-400" />
            Verification
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 text-center text-text-muted">
          <RefreshCw className="size-4 animate-spin mx-auto" />
        </CardContent>
      </Card>
    );
  }

  const results = data?.results || [];
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  // Compute check step stats for the stats bar
  const checkStepsPassed = checkSteps.filter(
    (s) => s.status === "success"
  ).length;
  const checkStepsFailed = checkSteps.filter(
    (s) => s.status === "failed"
  ).length;
  const checkStepsRunning = checkSteps.filter(
    (s) => s.status === "running"
  ).length;

  return (
    <Card className="bg-surface-raised/30 border-border-subtle/50 h-full flex flex-col">
      <CardHeader className="py-3 px-4 shrink-0">
        <CardTitle className="text-sm flex items-center gap-2">
          <ShieldCheck className="size-4 text-green-400" />
          Verification
          {results.length > 0 && (
            <Badge
              variant={failed === 0 ? "success" : "destructive"}
              className="text-xs"
            >
              {passed}/{results.length}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 px-4 pb-4">
        <ScrollArea className="h-full">
          <div className="space-y-1.5">
            {/* Verification criterion results */}
            {results.map((r) => (
              <div key={r.id} className="flex items-start gap-2 text-xs">
                {r.passed ? (
                  <CheckCircle2 className="size-3.5 text-green-500 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="size-3.5 text-red-500 mt-0.5 shrink-0" />
                )}
                <span className="text-text-secondary">{r.criterion}</span>
              </div>
            ))}

            {/* Execution check steps fallback (when no criterion results yet) */}
            {results.length === 0 && checkSteps.length > 0 && (
              <>
                <p className="text-[10px] text-text-muted mb-1 uppercase tracking-wider">
                  Check Steps from Execution
                </p>
                <StatsBar
                  total={checkSteps.length}
                  passed={checkStepsPassed}
                  failed={checkStepsFailed}
                  running={checkStepsRunning}
                />
                {checkSteps.map((step) => (
                  <CheckStepRow key={step.id} step={step} />
                ))}
              </>
            )}

            {results.length === 0 && checkSteps.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-text-muted">
                <div className="rounded-full bg-white/5 p-2.5 mb-2">
                  <ShieldCheck className="size-5 opacity-50" />
                </div>
                <p className="text-xs font-medium">
                  No verification results yet
                </p>
                <p className="text-[10px] opacity-70 mt-0.5">
                  Results will appear when verification steps run
                </p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
