"use client";

import { useState, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  AlertTriangle,
  Loader2,
  StopCircle,
  Activity,
  Calendar,
  Repeat,
  Users,
  FileText,
} from "lucide-react";
import { runnerApi, type TaskRun } from "@/lib/runner-api";
import { toast } from "sonner";
import {
  formatDuration,
  formatDateTime,
  type SummaryTabRun,
} from "../_utils/summary-tab-utils";

// =============================================================================
// StatusBanner
// =============================================================================

interface StatusBannerProps {
  run: SummaryTabRun;
  onRefresh?: () => void;
}

export function StatusBanner({ run, onRefresh }: StatusBannerProps) {
  const [additionalSessions, setAdditionalSessions] = useState(3);
  const [isContinuing, setIsContinuing] = useState(false);

  // Safely access runner-specific fields
  const runnerRun = run as Partial<TaskRun>;
  const goalAchieved = run.goal_achieved;
  const loopResult = runnerRun.loop_result || null;

  // Compute duration from timestamps if duration_seconds not provided
  const durationSeconds = useMemo(() => {
    if (run.duration_seconds != null) return run.duration_seconds;
    if (run.created_at && run.completed_at) {
      return (
        (new Date(run.completed_at).getTime() -
          new Date(run.created_at).getTime()) /
        1000
      );
    }
    return undefined;
  }, [run.duration_seconds, run.created_at, run.completed_at]);

  const handleContinue = async () => {
    setIsContinuing(true);
    try {
      await runnerApi.continueTaskRun(run.id, {
        additional_sessions: additionalSessions,
      });
      toast.success("Run continued");
      onRefresh?.();
    } catch {
      toast.error("Failed to continue run");
    } finally {
      setIsContinuing(false);
    }
  };

  // ---- Status banner color/icon/label logic (matches runner's StatusBanner) ----
  const isSuccess = run.status === "complete" || run.status === "completed";
  const isFailed = run.status === "failed";
  const isRunning = run.status === "running";
  const isStopped = run.status === "stopped";

  let bannerBg = "bg-surface-raised/30";
  let bannerText = "text-text-muted";
  let bannerIcon = <Clock className="size-5" />;
  let bannerLabel = run.status.charAt(0).toUpperCase() + run.status.slice(1);

  // Determine status based on loop result if available (matches runner logic)
  if (loopResult) {
    if (loopResult.was_stopped) {
      bannerBg = "bg-amber-500/10";
      bannerText = "text-amber-500";
      bannerIcon = <StopCircle className="size-5" />;
      bannerLabel = "Run Stopped";
    } else if (loopResult.critical_failure) {
      bannerBg = "bg-red-500/10";
      bannerText = "text-red-500";
      bannerIcon = <AlertTriangle className="size-5" />;
      bannerLabel = "Critical Failure";
    } else if (loopResult.verification_passed) {
      bannerBg = "bg-green-500/10";
      bannerText = "text-green-500";
      bannerIcon = <CheckCircle2 className="size-5" />;
      bannerLabel = goalAchieved ? "Goal Achieved" : "Verification Passed";
    } else if (loopResult.max_iterations_reached) {
      bannerBg = "bg-amber-500/10";
      bannerText = "text-amber-500";
      bannerIcon = <AlertTriangle className="size-5" />;
      bannerLabel = "Max Iterations Reached";
    } else if (isSuccess) {
      bannerBg = "bg-green-500/10";
      bannerText = "text-green-500";
      bannerIcon = <CheckCircle2 className="size-5" />;
      bannerLabel = "Run Completed";
    }
  } else if (isSuccess) {
    bannerBg = "bg-green-500/10";
    bannerText = "text-green-500";
    bannerIcon = <CheckCircle2 className="size-5" />;
    bannerLabel = goalAchieved ? "Goal Achieved" : "Run Completed";
  } else if (isFailed) {
    bannerBg = "bg-red-500/10";
    bannerText = "text-red-500";
    bannerIcon = <XCircle className="size-5" />;
    bannerLabel = "Run Failed";
  } else if (isRunning) {
    bannerBg = "bg-blue-500/10";
    bannerText = "text-blue-500";
    bannerIcon = <Activity className="size-5 animate-pulse" />;
    bannerLabel = "Running";
  } else if (isStopped) {
    bannerBg = "bg-amber-500/10";
    bannerText = "text-amber-500";
    bannerIcon = <StopCircle className="size-5" />;
    bannerLabel = "Run Stopped";
  }

  return (
    <div className={`${bannerBg} ${bannerText} rounded-lg p-4 space-y-2`}>
      {/* Line 1: Status, badges, duration, timestamps */}
      <div className="flex items-center justify-between flex-wrap gap-y-2">
        <div className="flex items-center gap-3 flex-wrap">
          {bannerIcon}
          <span className="font-medium">{bannerLabel}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded-full ${
              goalAchieved === true
                ? "bg-green-500/20 text-green-400"
                : goalAchieved === false
                  ? "bg-amber-500/20 text-amber-400"
                  : "bg-surface-raised/30 text-text-muted"
            }`}
          >
            {goalAchieved === true
              ? "Goal \u2713"
              : goalAchieved === false
                ? "Goal \u2717"
                : "Goal: Pending"}
          </span>
          {loopResult && loopResult.iterations_run > 0 && (
            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
              <Repeat className="size-3" />
              {loopResult.iterations_run} iteration
              {loopResult.iterations_run !== 1 ? "s" : ""}
            </span>
          )}
          {run.workflow_type && (
            <Badge variant="outline" className="text-xs">
              {run.workflow_type.toUpperCase()}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-sm opacity-80">
          <div className="flex items-center gap-2">
            <Clock className="size-4" />
            <span>
              {durationSeconds != null
                ? formatDuration(durationSeconds)
                : "In progress..."}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="size-4" />
            <span>{formatDateTime(run.created_at)}</span>
          </div>
          {run.completed_at && (
            <div className="flex items-center gap-2">
              <span>&ndash;</span>
              <span>{formatDateTime(run.completed_at)}</span>
            </div>
          )}
        </div>
      </div>

      {loopResult && loopResult.summary && (
        <div className="text-sm opacity-90">{loopResult.summary}</div>
      )}

      {/* Line 2: Session stats + actions */}
      <div className="flex items-center gap-3 text-sm opacity-90 flex-wrap">
        <div className="flex items-center gap-2">
          <Users className="size-4" />
          <span>
            {run.sessions_count ?? 0} session
            {(run.sessions_count ?? 0) !== 1 ? "s" : ""}
            {run.max_sessions ? ` / ${run.max_sessions} max` : ""}
          </span>
        </div>
        <div className="w-px h-4 bg-current opacity-20" />
        <div className="flex items-center gap-2">
          <FileText className="size-4" />
          <span>
            {runnerRun.output_log
              ? `${Math.round(runnerRun.output_log.length / 1024)}KB output`
              : "No output"}
          </span>
        </div>
        {run.auto_continue && (
          <>
            <div className="w-px h-4 bg-current opacity-20" />
            <span className="text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">
              Auto-continue
            </span>
          </>
        )}
        {isFailed && (
          <>
            <div className="w-px h-4 bg-current opacity-20" />
            <div className="flex items-center gap-2 ml-auto">
              <label htmlFor="additionalSessions" className="whitespace-nowrap">
                Sessions:
              </label>
              <Input
                id="additionalSessions"
                type="number"
                min={1}
                max={20}
                value={additionalSessions}
                onChange={(e) =>
                  setAdditionalSessions(
                    Math.max(1, Math.min(20, parseInt(e.target.value) || 1))
                  )
                }
                className="w-16 h-8 bg-surface-canvas/50 border-border-subtle/50"
              />
              <Button
                onClick={handleContinue}
                disabled={isContinuing}
                variant="brand-primary"
                size="sm"
              >
                {isContinuing ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-1" />
                    Reopening...
                  </>
                ) : (
                  <>
                    <Play className="size-4 mr-1" />
                    Continue Run
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
