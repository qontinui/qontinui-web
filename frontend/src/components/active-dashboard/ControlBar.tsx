"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Square, RefreshCw } from "lucide-react";
import { runnerApi } from "@/lib/runner-api";
import { toast } from "sonner";

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
// Phase Progress Indicator
// ---------------------------------------------------------------------------

const PHASES = ["setup", "verification", "agentic", "completion"] as const;

function PhaseProgress({ currentPhase }: { currentPhase: string | undefined }) {
  const normalizedPhase = currentPhase?.toLowerCase() || "";

  // Find the index of the current phase
  const currentIndex = PHASES.findIndex((p) => normalizedPhase.includes(p));

  return (
    <div className="flex items-center gap-1">
      {PHASES.map((phase, i) => {
        const isActive = i === currentIndex;
        const isCompleted = i < currentIndex;

        return (
          <div key={phase} className="flex items-center">
            {/* Dot */}
            <div
              className={`size-2.5 rounded-full transition-all ${
                isActive
                  ? "bg-brand-primary ring-2 ring-brand-primary/30"
                  : isCompleted
                    ? "bg-green-500"
                    : "bg-surface-raised border border-border-subtle"
              }`}
              title={phase}
            />
            {/* Connector line (not after last) */}
            {i < PHASES.length - 1 && (
              <div
                className={`w-4 h-0.5 ${
                  isCompleted
                    ? "bg-green-500/60"
                    : isActive
                      ? "bg-brand-primary/30"
                      : "bg-border-subtle/50"
                }`}
              />
            )}
          </div>
        );
      })}
      {/* Phase label */}
      {currentPhase && (
        <span className="text-[10px] text-text-muted ml-1.5 capitalize">
          {currentPhase}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Iteration Display
// ---------------------------------------------------------------------------

function IterationDisplay({
  current,
  max,
}: {
  current: number;
  max: number | undefined;
}) {
  const displayMax = max || current;
  const progress = displayMax > 0 ? (current / displayMax) * 100 : 0;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-text-secondary">
        Iteration {current}
        {max != null ? ` / ${max}` : ""}
      </span>
      {max != null && max > 0 && (
        <div className="w-16 h-1.5 bg-surface-canvas/50 rounded-full overflow-hidden">
          <div
            className="h-full bg-brand-primary/70 rounded-full transition-all"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
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
      <span className="text-[10px] text-text-muted">Auto-continue</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main ControlBar
// ---------------------------------------------------------------------------

export function ControlBar({ run, onRefresh }: ControlBarProps) {
  const handleStop = async () => {
    try {
      await runnerApi.stopTaskRun(run.id);
      toast.success("Run stopped");
      onRefresh();
    } catch {
      toast.error("Failed to stop run");
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-surface-raised/50 border-b border-border-subtle/50 gap-4">
      {/* Left section: name + phase progress */}
      <div className="flex items-center gap-3 min-w-0">
        <h3 className="font-semibold text-text-primary truncate max-w-[250px]">
          {run.task_name}
        </h3>
        <PhaseProgress currentPhase={run.phase} />
      </div>

      {/* Center section: iteration + auto-continue */}
      <div className="flex items-center gap-4 shrink-0">
        {run.iteration_count != null && (
          <IterationDisplay
            current={run.iteration_count}
            max={run.max_sessions}
          />
        )}
        {run.auto_continue != null && (
          <AutoContinueToggle
            runId={run.id}
            enabled={run.auto_continue}
            onToggled={onRefresh}
          />
        )}
      </div>

      {/* Right section: actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Button variant="destructive" size="sm" onClick={handleStop}>
          <Square className="size-3.5 mr-1" />
          Stop
        </Button>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
