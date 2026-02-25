"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Square,
  Pause,
  Play,
  RefreshCw,
  Settings,
  ArrowRight,
  Repeat2,
  Loader2,
  Timer,
  Layers,
  CheckCircle2,
} from "lucide-react";
import { runnerApi } from "@/lib/runner-api";
import { useSharedOrchestratorState } from "@/contexts/SharedRunnerDataContext";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ControlBarProps {
  run: {
    id: string;
    task_name: string;
    status: string;
    phase?: string;
    iteration_count?: number;
    sessions_count?: number;
    max_sessions?: number;
    auto_continue?: boolean;
  };
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Workflow Stage Indicator (4-stage pipeline)
// ---------------------------------------------------------------------------

const STAGES = [
  { key: "setup", label: "Setup", color: "blue" },
  { key: "verification", label: "Verify", color: "teal" },
  { key: "agentic", label: "Agentic", color: "violet" },
  { key: "completion", label: "Complete", color: "green" },
] as const;

interface StageColorSet {
  text: string;
  bg: string;
  border: string;
  glow: string;
}

const STAGE_COLOR_MAP: Record<string, StageColorSet> = {
  blue: {
    text: "text-blue-400",
    bg: "bg-blue-500/15",
    border: "border-blue-500/50",
    glow: "shadow-[0_0_8px_rgba(59,130,246,0.4)]",
  },
  teal: {
    text: "text-teal-400",
    bg: "bg-teal-500/15",
    border: "border-teal-500/50",
    glow: "shadow-[0_0_8px_rgba(20,184,166,0.4)]",
  },
  violet: {
    text: "text-violet-400",
    bg: "bg-violet-500/15",
    border: "border-violet-500/50",
    glow: "shadow-[0_0_8px_rgba(139,92,246,0.4)]",
  },
  green: {
    text: "text-green-400",
    bg: "bg-green-500/15",
    border: "border-green-500/50",
    glow: "shadow-[0_0_8px_rgba(34,197,94,0.4)]",
  },
};

const COMPLETED_COLORS: StageColorSet = {
  text: "text-green-400",
  bg: "bg-green-500/15",
  border: "border-green-500/40",
  glow: "",
};

const INACTIVE_COLORS: StageColorSet = {
  text: "text-text-muted/40",
  bg: "bg-transparent",
  border: "border-border-subtle/30",
  glow: "",
};

function getStageColors(
  key: string,
  isActive: boolean,
  isCompleted: boolean
): StageColorSet {
  if (isActive) return STAGE_COLOR_MAP[key] ?? STAGE_COLOR_MAP.blue!;
  if (isCompleted) return COMPLETED_COLORS;
  return INACTIVE_COLORS;
}

function WorkflowStageIndicator({
  currentPhase,
  isRunning,
  isFailed,
}: {
  currentPhase: string | undefined;
  isRunning: boolean;
  isFailed: boolean;
}) {
  const normalizedPhase = currentPhase?.toLowerCase() || "";
  let currentIndex = STAGES.findIndex((s) => normalizedPhase.includes(s.key));
  // When running but no phase data yet, default to setup
  if (isRunning && currentIndex === -1) currentIndex = 0;
  // Only show all-completed when we have a definitive "not running" status
  // AND the run actually succeeded (not failed/stopped)
  const allCompleted = !isRunning && currentIndex >= 0 && !isFailed;

  return (
    <div className="flex items-center gap-0.5">
      {STAGES.map((stage, i) => {
        const isActive = allCompleted ? false : i === currentIndex;
        const isCompleted = allCompleted ? true : i < currentIndex;
        const colors = getStageColors(stage.color, isActive, isCompleted);
        const isLoop = i === 1 && currentIndex >= 1 && currentIndex <= 2; // verification-agentic loop zone

        return (
          <div key={stage.key} className="flex items-center">
            {/* Stage badge */}
            <div
              className={cn(
                "px-2 py-0.5 rounded-md text-[10px] font-medium border transition-all flex items-center gap-1",
                colors.text,
                colors.bg,
                colors.border,
                isActive && colors.glow,
                isActive && "animate-phase-glow"
              )}
            >
              {isCompleted && <CheckCircle2 className="size-2.5" />}
              {stage.label}
            </div>

            {/* Connector */}
            {i < STAGES.length - 1 && (
              <div className="flex items-center mx-0.5">
                {/* Show loop indicator between verification and agentic */}
                {i === 1 ? (
                  <Repeat2
                    className={cn(
                      "size-3",
                      isLoop ? "text-violet-400/70" : "text-border-subtle/30"
                    )}
                  />
                ) : (
                  <ArrowRight
                    className={cn(
                      "size-3",
                      isCompleted
                        ? "text-green-500/50"
                        : isActive
                          ? colors.text
                          : "text-border-subtle/30"
                    )}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Iteration Badge
// ---------------------------------------------------------------------------

function IterationBadge({
  current,
  max,
}: {
  current: number;
  max: number | undefined;
}) {
  const displayMax = max ?? current;
  const progress = displayMax > 0 ? (current / displayMax) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Layers className="size-3 text-text-muted" />
        <span className="text-xs text-text-secondary font-medium">
          {current}
          {max != null ? <span className="text-text-muted">/{max}</span> : ""}
        </span>
      </div>
      {max != null && max > 0 && (
        <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              progress >= 100 ? "bg-green-500" : "bg-brand-primary/70"
            )}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan Phase Display
// ---------------------------------------------------------------------------

function PlanPhaseDisplay({
  planPhase,
  planPhaseIndex,
  planTotalPhases,
  stageIndex,
  totalStages,
}: {
  planPhase?: string;
  planPhaseIndex?: number;
  planTotalPhases?: number;
  stageIndex?: number;
  totalStages?: number;
}) {
  // Show stage indicator for multi-stage workflows
  const hasStages = totalStages != null && totalStages > 1;
  const hasPhase = planPhase != null;

  if (!hasStages && !hasPhase) return null;

  return (
    <div className="flex items-center gap-1.5">
      {hasStages && (
        <Badge
          variant="outline"
          className="text-[10px] gap-1 text-amber-400 border-amber-500/30"
        >
          <Layers className="size-2.5" />
          Stage {(stageIndex ?? 0) + 1}/{totalStages}
        </Badge>
      )}
      {hasPhase && (
        <Badge
          variant="outline"
          className="text-[10px] gap-1 text-amber-400 border-amber-500/30"
        >
          <Timer className="size-2.5" />
          {planPhaseIndex != null ? `${planPhaseIndex + 1}: ` : ""}
          {planPhase}
          {!hasStages && planTotalPhases != null && `/${planTotalPhases}`}
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-Continue Toggle
// ---------------------------------------------------------------------------

function AutoContinueToggle({
  runId,
  enabled,
  onToggled,
}: {
  runId: string;
  enabled: boolean;
  onToggled: () => void;
}) {
  const [toggling, setToggling] = useState(false);

  const handleToggle = async (checked: boolean) => {
    setToggling(true);
    try {
      await runnerApi.toggleAutoContinue(runId, checked);
      onToggled();
    } catch {
      toast.error("Failed to toggle auto-continue");
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      <Switch
        checked={enabled}
        onCheckedChange={handleToggle}
        disabled={toggling}
        className="scale-75"
      />
      <span className="text-[10px] text-text-muted">Auto</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ControlBar
// ---------------------------------------------------------------------------

export function ControlBar({ run, onRefresh }: ControlBarProps) {
  const router = useRouter();
  const [pausing, setPausing] = useState(false);
  const { data: orchState } = useSharedOrchestratorState();
  const isPaused = orchState?.is_paused ?? false;

  const handleStop = async () => {
    try {
      await runnerApi.stopTaskRun(run.id);
      toast.success("Run stopped");
      onRefresh();
    } catch {
      toast.error("Failed to stop run");
    }
  };

  const handlePauseResume = async () => {
    setPausing(true);
    try {
      if (isPaused) {
        await runnerApi.resumeTaskRun(run.id);
        toast.success("Run resumed");
      } else {
        await runnerApi.pauseTaskRun(run.id);
        toast.success("Run paused");
      }
      onRefresh();
    } catch {
      toast.error(isPaused ? "Failed to resume" : "Failed to pause");
    } finally {
      setPausing(false);
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-surface-raised/50 border-b border-border-subtle/50 gap-3">
      {/* Left section: name + stage indicator */}
      <div className="flex items-center gap-3 min-w-0">
        <h3 className="font-semibold text-text-primary truncate max-w-[200px] text-sm">
          {run.task_name}
        </h3>
        <WorkflowStageIndicator
          currentPhase={
            orchState?.workflow_stage || orchState?.phase || run.phase
          }
          isRunning={run.status === "running"}
          isFailed={run.status === "failed" || run.status === "stopped"}
        />
      </div>

      {/* Center section: iteration + plan phase + auto-continue */}
      <div className="flex items-center gap-3 shrink-0">
        {(orchState?.iteration != null || run.iteration_count != null) && (
          <IterationBadge
            current={orchState?.iteration ?? run.iteration_count ?? 0}
            max={orchState?.max_iterations ?? run.max_sessions}
          />
        )}
        <PlanPhaseDisplay
          planPhase={orchState?.plan_phase_name ?? orchState?.plan_phase}
          planPhaseIndex={orchState?.plan_phase_index}
          planTotalPhases={orchState?.plan_total_phases}
          stageIndex={orchState?.stage_index}
          totalStages={orchState?.total_stages}
        />
        {run.auto_continue != null && (
          <AutoContinueToggle
            runId={run.id}
            enabled={run.auto_continue}
            onToggled={onRefresh}
          />
        )}
      </div>

      {/* Right section: actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Pause/Resume */}
        <Button
          variant="outline"
          size="sm"
          onClick={handlePauseResume}
          disabled={pausing}
          className={cn(
            "h-7 px-2",
            isPaused &&
              "border-amber-500/30 text-amber-400 hover:text-amber-300"
          )}
          title={isPaused ? "Resume" : "Pause"}
        >
          {pausing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : isPaused ? (
            <Play className="size-3.5" />
          ) : (
            <Pause className="size-3.5" />
          )}
        </Button>

        {/* Stop */}
        <Button
          variant="destructive"
          size="sm"
          onClick={handleStop}
          className="h-7 px-2"
        >
          <Square className="size-3.5" />
        </Button>

        {/* Settings */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/settings/general")}
          className="h-7 px-2 text-text-muted hover:text-text-secondary"
          title="Settings"
        >
          <Settings className="size-3.5" />
        </Button>

        {/* Refresh */}
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="h-7 px-2 text-text-muted"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
