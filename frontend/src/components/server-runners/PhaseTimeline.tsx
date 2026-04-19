"use client";

import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  GitCommit,
  Hourglass,
  Loader2,
  ListTree,
  AlertOctagon,
  RefreshCw,
} from "lucide-react";
import { usePhaseResults } from "@/hooks/useServerRunners";
import { cn } from "@/lib/utils";
import type {
  PhaseResult,
  PhaseStepResult,
  WorkflowPhaseName,
} from "@/types/server-runner";

interface PhaseTimelineProps {
  executionId: string;
  /** Poll interval in ms. 0 to disable. Defaults to 5000. */
  pollIntervalMs?: number;
}

const PHASE_LABELS: Record<WorkflowPhaseName, string> = {
  setup: "Setup",
  verification: "Verification",
  agentic: "Agentic",
  completion: "Completion",
};

const PHASE_COLORS: Record<WorkflowPhaseName, string> = {
  setup: "border-sky-500/50 text-sky-400",
  verification: "border-emerald-500/50 text-emerald-400",
  agentic: "border-violet-500/50 text-violet-400",
  completion: "border-amber-500/50 text-amber-400",
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remSeconds}s`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString();
  } catch {
    return iso;
  }
}

/**
 * Vertical timeline of phase results for a single execution.
 *
 * Data source: polls GET /api/v1/phase-results?execution_id=... every
 * `pollIntervalMs` ms (default 5s). We picked polling rather than a live
 * stream because the backend phase-results endpoint is plain REST — there
 * is no SSE/WS channel scoped to execution_id in this phase of the plan.
 */
export function PhaseTimeline({
  executionId,
  pollIntervalMs = 5000,
}: PhaseTimelineProps) {
  const {
    data: phaseResults,
    isLoading,
    error,
    refetch,
    isFetching,
  } = usePhaseResults(executionId, pollIntervalMs);

  const sorted = useMemo(() => {
    if (!phaseResults) return [];
    return [...phaseResults].sort((a, b) =>
      a.created_at.localeCompare(b.created_at)
    );
  }, [phaseResults]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-brand-primary" />
        <span className="ml-3 text-text-muted text-sm">
          Loading phase timeline...
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-surface-raised border-border-subtle p-6">
        <div className="text-center">
          <AlertOctagon className="w-10 h-10 mx-auto text-red-400 mb-2" />
          <p className="text-sm text-text-muted mb-3">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (sorted.length === 0) {
    return (
      <Card className="bg-surface-raised border-border-subtle p-10">
        <div className="text-center">
          <Hourglass className="w-10 h-10 mx-auto text-text-muted mb-2 animate-pulse" />
          <h3 className="text-lg font-semibold text-white mb-1">
            Workflow is starting up
          </h3>
          <p className="text-sm text-text-muted max-w-sm mx-auto">
            No phase results yet. Phases appear here as the runner finishes each
            one.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-text-muted">
        <span>
          {sorted.length} {sorted.length === 1 ? "phase" : "phases"} recorded
        </span>
        <div className="flex items-center gap-2">
          {isFetching && (
            <Loader2
              className="w-3 h-3 animate-spin text-text-muted"
              aria-label="Refreshing"
            />
          )}
          <button
            type="button"
            onClick={() => refetch()}
            className="hover:text-white transition-colors"
          >
            Refresh
          </button>
        </div>
      </div>

      <ol className="relative border-l border-border-subtle ml-3 space-y-3">
        {sorted.map((phase) => (
          <PhaseTimelineItem key={phase.id} phase={phase} />
        ))}
      </ol>
    </div>
  );
}

function PhaseTimelineItem({ phase }: { phase: PhaseResult }) {
  const [open, setOpen] = useState(false);
  const [showFailure, setShowFailure] = useState(false);
  const phaseLabel = PHASE_LABELS[phase.phase] ?? phase.phase;
  const phaseColor = PHASE_COLORS[phase.phase] ?? "border-border-default";

  const success = phase.success && phase.all_passed;
  const iterationLabel =
    phase.iteration !== null && phase.iteration !== undefined
      ? `iter ${phase.iteration}`
      : null;
  const stageLabel =
    phase.stage_index !== null && phase.stage_index !== undefined
      ? `stage ${phase.stage_index}`
      : null;

  return (
    <li className="ml-4">
      <span
        className={cn(
          "absolute -left-[7px] w-3.5 h-3.5 rounded-full border-2 border-surface-canvas",
          success ? "bg-emerald-500" : "bg-red-500"
        )}
        aria-hidden
      />
      <Card className="bg-surface-raised border-border-subtle p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-1">
              <Badge variant="outline" className={phaseColor}>
                {phaseLabel}
              </Badge>
              {iterationLabel && (
                <Badge variant="outline" className="border-border-default">
                  {iterationLabel}
                </Badge>
              )}
              {stageLabel && (
                <Badge variant="outline" className="border-border-default">
                  {stageLabel}
                </Badge>
              )}
              {success ? (
                <Badge
                  variant="outline"
                  className="border-emerald-500/50 text-emerald-400"
                >
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Passed
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="border-red-500/50 text-red-400"
                >
                  <XCircle className="w-3 h-3 mr-1" />
                  Failed
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDuration(phase.duration_ms)}
              </span>
              <span>{formatTime(phase.created_at)}</span>
              {phase.commit_hash && (
                <a
                  href={`#commit-${phase.commit_hash}`}
                  className="flex items-center gap-1 font-mono hover:text-white transition-colors"
                  title={phase.commit_hash}
                >
                  <GitCommit className="w-3 h-3" />
                  {phase.commit_hash.slice(0, 8)}
                </a>
              )}
              {phase.step_results.length > 0 && (
                <span className="flex items-center gap-1">
                  <ListTree className="w-3 h-3" />
                  {phase.step_results.length} steps
                </span>
              )}
            </div>
          </div>
        </div>

        {phase.step_results.length > 0 && (
          <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-text-muted hover:text-white transition-colors"
                aria-label={`${open ? "Collapse" : "Expand"} step results`}
              >
                {open ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
                {open ? "Hide steps" : "Show steps"}
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-1">
              {phase.step_results.map((step, i) => (
                <StepResultRow
                  key={step.step_id ?? `${phase.id}-${i}`}
                  step={step}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {phase.failure_context && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowFailure((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
              aria-label={`${showFailure ? "Hide" : "Show"} failure context`}
            >
              {showFailure ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              Failure context
            </button>
            {showFailure && (
              <pre className="mt-2 bg-surface-canvas border border-red-500/30 rounded-md p-3 text-xs text-red-200 font-mono overflow-x-auto whitespace-pre-wrap">
                {phase.failure_context}
              </pre>
            )}
          </div>
        )}
      </Card>
    </li>
  );
}

function StepResultRow({ step }: { step: PhaseStepResult }) {
  const success = !step.error;
  return (
    <div
      className={cn(
        "flex items-start gap-2 p-2 rounded-md border text-xs",
        success
          ? "bg-emerald-500/5 border-emerald-500/20"
          : "bg-red-500/5 border-red-500/20"
      )}
    >
      {success ? (
        <CheckCircle2
          className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5"
          aria-label="Passed"
        />
      ) : (
        <XCircle
          className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5"
          aria-label="Failed"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white truncate">
            {step.step_name}
          </span>
          <Badge
            variant="outline"
            className="text-[10px] px-1 border-border-default shrink-0"
          >
            {step.step_type}
          </Badge>
          <span className="text-text-muted ml-auto shrink-0">
            {formatDuration(step.duration_ms)}
          </span>
        </div>
        {step.error && (
          <p className="mt-1 text-red-300 font-mono break-all">{step.error}</p>
        )}
      </div>
    </div>
  );
}
