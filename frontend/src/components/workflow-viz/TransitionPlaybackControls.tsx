"use client";

/**
 * Transition Playback Controls
 *
 * Play/pause, step, speed, and progress controls for transition animation.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  PLAYBACK_SPEEDS,
  type TransitionAnimationState,
} from "@/types/transition-animation";
import { cn } from "@/lib/utils";

interface TransitionPlaybackControlsProps {
  /** Current animation state */
  state: TransitionAnimationState;
  /** Play/resume animation */
  onPlay: () => void;
  /** Pause animation */
  onPause: () => void;
  /** Step forward one action */
  onStepForward: () => void;
  /** Step backward one action */
  onStepBackward: () => void;
  /** Reset to beginning */
  onReset: () => void;
  /** Set playback speed */
  onSpeedChange: (speed: number) => void;
  /** Seek to specific action */
  onSeek: (actionIndex: number) => void;
  /** Additional class names */
  className?: string;
}

export function TransitionPlaybackControls({
  state,
  onPlay,
  onPause,
  onStepForward,
  onStepBackward,
  onReset,
  onSpeedChange,
  onSeek,
  className,
}: TransitionPlaybackControlsProps) {
  const isPlaying = state.isPlaying;
  const isCompleted = state.phase === "completed";
  const isIdle = state.phase === "idle";
  const hasActions = state.totalActions > 0;

  // Calculate overall progress (0-100)
  // Phase weights: showing-initial=10%, executing-action=70%, transitioning-states=10%, showing-final=10%
  const overallProgress = React.useMemo(() => {
    if (isIdle) return 0;
    if (isCompleted) return 100;

    let baseProgress = 0;

    if (state.phase === "showing-initial") {
      baseProgress = state.progress * 10;
    } else if (state.phase === "executing-action") {
      const actionProgress = hasActions
        ? ((state.globalActionIndex + state.progress) / state.totalActions) * 70
        : 70 * state.progress;
      baseProgress = 10 + actionProgress;
    } else if (state.phase === "transitioning-states") {
      baseProgress = 80 + state.progress * 10;
    } else if (state.phase === "showing-final") {
      baseProgress = 90 + state.progress * 10;
    }

    return Math.min(100, Math.max(0, baseProgress));
  }, [state, isIdle, isCompleted, hasActions]);

  // Handle slider change
  const handleSliderChange = (value: number[]) => {
    const progress = value[0] ?? 0;

    // Map progress to action index
    if (progress <= 10) {
      // In showing-initial phase
      onSeek(-1);
    } else if (progress >= 90) {
      // In showing-final phase
      onSeek(state.totalActions);
    } else {
      // In executing-action phase
      const actionProgress = (progress - 10) / 70;
      const actionIndex = Math.floor(actionProgress * state.totalActions);
      onSeek(actionIndex);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-4 bg-zinc-900/80 rounded-lg border border-zinc-800",
        className
      )}
    >
      {/* Progress slider */}
      <div className="flex items-center gap-4">
        <span className="text-xs text-zinc-500 w-12 text-right">
          {state.phase === "executing-action" && hasActions
            ? `${state.globalActionIndex + 1}/${state.totalActions}`
            : getPhaseLabel(state.phase)}
        </span>
        <Slider
          value={[overallProgress]}
          onValueChange={handleSliderChange}
          max={100}
          step={1}
          className="flex-1"
          disabled={isIdle}
        />
        <span className="text-xs text-zinc-500 w-12">
          {Math.round(overallProgress)}%
        </span>
      </div>

      {/* Main controls */}
      <div className="flex items-center justify-between">
        {/* Left: Reset */}
        <Button
          size="sm"
          variant="ghost"
          onClick={onReset}
          disabled={isIdle}
          className="h-8 w-8 p-0"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        {/* Center: Navigation */}
        <div className="flex items-center gap-1">
          {/* Jump to start */}
          <Button
            size="sm"
            variant="ghost"
            onClick={onReset}
            disabled={isIdle}
            className="h-8 w-8 p-0"
          >
            <SkipBack className="h-4 w-4" />
          </Button>

          {/* Step back */}
          <Button
            size="sm"
            variant="ghost"
            onClick={onStepBackward}
            disabled={isIdle || state.phase === "showing-initial"}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Play/Pause */}
          <Button
            size="sm"
            variant="default"
            onClick={isPlaying ? onPause : onPlay}
            disabled={isIdle || isCompleted}
            className="h-10 w-10 p-0 rounded-full"
          >
            {isPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </Button>

          {/* Step forward */}
          <Button
            size="sm"
            variant="ghost"
            onClick={onStepForward}
            disabled={isIdle || isCompleted}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Jump to end */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onSeek(state.totalActions + 1)}
            disabled={isIdle || isCompleted}
            className="h-8 w-8 p-0"
          >
            <SkipForward className="h-4 w-4" />
          </Button>
        </div>

        {/* Right: Speed control */}
        <Select
          value={String(state.playbackSpeed)}
          onValueChange={(v) => onSpeedChange(parseFloat(v))}
          disabled={isIdle}
        >
          <SelectTrigger className="w-20 h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAYBACK_SPEEDS.map((speed) => (
              <SelectItem key={speed} value={String(speed)}>
                {speed}x
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function getPhaseLabel(phase: TransitionAnimationState["phase"]): string {
  switch (phase) {
    case "idle":
      return "Ready";
    case "showing-initial":
      return "Initial";
    case "executing-action":
      return "Actions";
    case "transitioning-states":
      return "Trans.";
    case "showing-final":
      return "Final";
    case "completed":
      return "Done";
    default:
      return "";
  }
}

export default TransitionPlaybackControls;
