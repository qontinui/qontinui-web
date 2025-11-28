// components/integration-testing/Timeline.tsx

import { Play, Pause, SkipBack, SkipForward, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActionVisualization } from "@/types/integration-testing";

interface TimelineProps {
  actions: ActionVisualization[];
  currentIndex: number;
  isPlaying: boolean;
  onJumpTo: (index: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
}

export function Timeline({
  actions,
  currentIndex,
  isPlaying,
  onJumpTo,
  onNext,
  onPrevious,
  onPlay,
  onPause,
  onReset,
}: TimelineProps) {
  const getActionIcon = (type: string) => {
    switch (type) {
      case "FIND":
        return "🔍";
      case "CLICK":
        return "👆";
      case "TYPE":
        return "⌨️";
      case "WAIT":
        return "⏱️";
      case "SCROLL":
        return "📜";
      case "MOVE_MOUSE":
        return "🖱️";
      case "HIGHLIGHT":
        return "✨";
      case "DEFINE":
        return "📝";
      case "VANISH":
        return "👻";
      default:
        return "•";
    }
  };

  return (
    <div className="space-y-4">
      {/* Action Timeline */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-2">
        {actions.map((action, index) => (
          <button
            key={index}
            onClick={() => onJumpTo(index)}
            className={`
              flex flex-col items-center p-2 rounded-lg transition-all
              ${
                index === currentIndex
                  ? "bg-blue-100 ring-2 ring-blue-500"
                  : "bg-gray-100 hover:bg-gray-200"
              }
              ${!action.success && "ring-2 ring-red-500"}
              min-w-[60px]
            `}
          >
            <span className="text-2xl">
              {getActionIcon(action.action_type)}
            </span>
            <span className="text-xs font-medium mt-1">
              {action.action_type}
            </span>
            {!action.success && <span className="text-red-500 text-xs">✗</span>}
          </button>
        ))}
      </div>

      {/* Progress Bar */}
      <div className="relative h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="absolute h-full bg-blue-500 transition-all duration-300"
          style={{
            width: `${((currentIndex + 1) / actions.length) * 100}%`,
          }}
        />
      </div>

      {/* Playback Controls */}
      <div className="flex items-center justify-center space-x-2">
        <Button size="sm" variant="outline" onClick={onReset}>
          <RotateCcw className="w-4 h-4" />
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={onPrevious}
          disabled={currentIndex === 0}
        >
          <SkipBack className="w-4 h-4" />
        </Button>

        {isPlaying ? (
          <Button size="sm" onClick={onPause}>
            <Pause className="w-4 h-4 mr-2" />
            Pause
          </Button>
        ) : (
          <Button size="sm" onClick={onPlay}>
            <Play className="w-4 h-4 mr-2" />
            Play
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={onNext}
          disabled={currentIndex === actions.length - 1}
        >
          <SkipForward className="w-4 h-4" />
        </Button>

        <span className="text-sm text-gray-600 ml-4">
          {currentIndex + 1} / {actions.length}
        </span>
      </div>
    </div>
  );
}
