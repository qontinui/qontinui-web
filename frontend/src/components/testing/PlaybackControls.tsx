"use client";

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
  Rewind,
  FastForward,
  RotateCcw,
} from "lucide-react";

interface PlaybackControlsProps {
  isPlaying: boolean;
  currentIndex: number;
  totalSteps: number;
  playbackSpeed: number;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onReset: () => void;
  onJumpTo: (index: number) => void;
  onSpeedChange: (speed: number) => void;
  disabled?: boolean;
}

const SPEED_OPTIONS = [
  { value: 0.25, label: "0.25x" },
  { value: 0.5, label: "0.5x" },
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
  { value: 4, label: "4x" },
];

export function PlaybackControls({
  isPlaying,
  currentIndex,
  totalSteps,
  playbackSpeed,
  onPlay,
  onPause,
  onNext,
  onPrevious,
  onReset,
  onJumpTo,
  onSpeedChange,
  disabled = false,
}: PlaybackControlsProps) {
  const hasNext = currentIndex < totalSteps - 1;
  const hasPrevious = currentIndex > 0;
  const progress = totalSteps > 0 ? ((currentIndex + 1) / totalSteps) * 100 : 0;

  const handleSliderChange = (value: number[]) => {
    if (value[0] !== undefined) {
      const newIndex = Math.round((value[0] / 100) * (totalSteps - 1));
      onJumpTo(Math.max(0, Math.min(newIndex, totalSteps - 1)));
    }
  };

  const jumpToStart = () => onJumpTo(0);
  const jumpToEnd = () => onJumpTo(totalSteps - 1);

  return (
    <div className="bg-surface-raised/80 backdrop-blur-sm border border-border-subtle/50 rounded-lg p-4">
      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-text-muted mb-2">
          <span>
            Step {currentIndex + 1} of {totalSteps}
          </span>
          <span>{Math.round(progress)}%</span>
        </div>
        <Slider
          value={[progress]}
          max={100}
          step={totalSteps > 0 ? 100 / totalSteps : 1}
          onValueChange={handleSliderChange}
          disabled={disabled || totalSteps === 0}
          className="w-full"
        />
      </div>

      {/* Controls Row */}
      <div className="flex items-center justify-between gap-4">
        {/* Left: Jump buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={jumpToStart}
            disabled={disabled || !hasPrevious}
            className="h-8 w-8 p-0 hover:bg-border-default/50"
            title="Jump to start"
          >
            <Rewind className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onPrevious}
            disabled={disabled || !hasPrevious}
            className="h-8 w-8 p-0 hover:bg-border-default/50"
            title="Previous step"
          >
            <SkipBack className="w-4 h-4" />
          </Button>
        </div>

        {/* Center: Play/Pause */}
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={disabled}
            className="h-8 w-8 p-0 hover:bg-border-default/50"
            title="Reset"
          >
            <RotateCcw className="w-4 h-4" />
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={isPlaying ? onPause : onPlay}
            disabled={disabled || totalSteps === 0}
            className="h-10 w-10 p-0 rounded-full bg-brand-primary hover:bg-brand-primary/80"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 text-black" />
            ) : (
              <Play className="w-5 h-5 text-black ml-0.5" />
            )}
          </Button>
        </div>

        {/* Right: Jump and Speed buttons */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onNext}
            disabled={disabled || !hasNext}
            className="h-8 w-8 p-0 hover:bg-border-default/50"
            title="Next step"
          >
            <SkipForward className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={jumpToEnd}
            disabled={disabled || !hasNext}
            className="h-8 w-8 p-0 hover:bg-border-default/50"
            title="Jump to end"
          >
            <FastForward className="w-4 h-4" />
          </Button>
        </div>

        {/* Speed Selector */}
        <Select
          value={playbackSpeed.toString()}
          onValueChange={(value) => onSpeedChange(parseFloat(value))}
          disabled={disabled}
        >
          <SelectTrigger className="w-20 h-8 bg-surface-raised/50 border-border-default">
            <SelectValue placeholder="Speed" />
          </SelectTrigger>
          <SelectContent className="bg-surface-raised border-border-default">
            {SPEED_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value.toString()}
                className="text-text-muted hover:bg-surface-raised"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

/**
 * Compact version of playback controls for inline use
 */
export function PlaybackControlsCompact({
  isPlaying,
  currentIndex,
  totalSteps,
  onPlay,
  onPause,
  onNext,
  onPrevious,
  disabled = false,
}: Omit<
  PlaybackControlsProps,
  "playbackSpeed" | "onReset" | "onJumpTo" | "onSpeedChange"
>) {
  const hasNext = currentIndex < totalSteps - 1;
  const hasPrevious = currentIndex > 0;

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        onClick={onPrevious}
        disabled={disabled || !hasPrevious}
        className="h-7 w-7 p-0 hover:bg-border-default/50"
        title="Previous"
      >
        <SkipBack className="w-3.5 h-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={isPlaying ? onPause : onPlay}
        disabled={disabled || totalSteps === 0}
        className="h-7 w-7 p-0 hover:bg-border-default/50"
        title={isPlaying ? "Pause" : "Play"}
      >
        {isPlaying ? (
          <Pause className="w-3.5 h-3.5" />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onNext}
        disabled={disabled || !hasNext}
        className="h-7 w-7 p-0 hover:bg-border-default/50"
        title="Next"
      >
        <SkipForward className="w-3.5 h-3.5" />
      </Button>
      <span className="text-xs text-text-muted ml-1">
        {currentIndex + 1}/{totalSteps}
      </span>
    </div>
  );
}

export default PlaybackControls;
