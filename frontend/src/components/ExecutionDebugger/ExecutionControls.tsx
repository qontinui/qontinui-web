import React from "react";
import { Play, Pause, Square, SkipForward, Gauge } from "lucide-react";
import { useExecutionDebugger } from "../../stores/execution-debugger-store";
import { ExecutionSpeed } from "../../types/debugger/execution-types";

interface ExecutionControlsProps {
  onExecute?: () => void;
  onStop?: () => void;
  onStep?: () => void;
}

export const ExecutionControls: React.FC<ExecutionControlsProps> = ({
  onExecute,
  onStop,
  onStep,
}) => {
  const { state, speed, stepMode, play, pause, stop, step, setSpeed } =
    useExecutionDebugger();

  const isRunning = state === "running" || state === "stepping";
  const isPaused = state === "paused";
  const isIdle = state === "idle";

  const handlePlay = () => {
    if (isIdle && onExecute) {
      onExecute();
    } else {
      play();
    }
  };

  const handlePause = () => {
    pause();
  };

  const handleStop = () => {
    stop();
    if (onStop) {
      onStop();
    }
  };

  const handleStep = () => {
    if (isIdle && onStep) {
      onStep();
    } else {
      step();
    }
  };

  const handleSpeedChange = (newSpeed: ExecutionSpeed) => {
    setSpeed(newSpeed);
  };

  const speedOptions: {
    value: ExecutionSpeed;
    label: string;
    delay: string;
  }[] = [
    { value: "slow", label: "Slow", delay: "2x delay" },
    { value: "normal", label: "Normal", delay: "1x" },
    { value: "fast", label: "Fast", delay: "0.5x delay" },
  ];

  return (
    <div className="flex items-center gap-2 p-3 bg-gray-50 border-b">
      {/* Play/Pause Button */}
      {!isRunning ? (
        <button
          onClick={handlePlay}
          disabled={state === "completed" || state === "error"}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            state === "completed" || state === "error"
              ? "bg-gray-200 text-gray-400 cursor-not-allowed"
              : "bg-green-600 text-white hover:bg-green-700"
          }`}
          title="Play"
        >
          <Play className="w-4 h-4" />
          <span className="text-sm font-medium">Play</span>
        </button>
      ) : (
        <button
          onClick={handlePause}
          className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 flex items-center gap-2 transition-colors"
          title="Pause"
        >
          <Pause className="w-4 h-4" />
          <span className="text-sm font-medium">Pause</span>
        </button>
      )}

      {/* Stop Button */}
      <button
        onClick={handleStop}
        disabled={isIdle}
        className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
          isIdle
            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
            : "bg-red-600 text-white hover:bg-red-700"
        }`}
        title="Stop"
      >
        <Square className="w-4 h-4" />
        <span className="text-sm font-medium">Stop</span>
      </button>

      {/* Step Button */}
      <button
        onClick={handleStep}
        disabled={isRunning && !isPaused}
        className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
          isRunning && !isPaused
            ? "bg-gray-200 text-gray-400 cursor-not-allowed"
            : "bg-blue-600 text-white hover:bg-blue-700"
        }`}
        title="Step forward one action"
      >
        <SkipForward className="w-4 h-4" />
        <span className="text-sm font-medium">Step</span>
      </button>

      {/* Divider */}
      <div className="h-8 w-px bg-gray-300 mx-2" />

      {/* Speed Control */}
      <div className="flex items-center gap-2">
        <Gauge className="w-4 h-4 text-gray-600" />
        <span className="text-sm text-gray-600 font-medium">Speed:</span>
        <div className="flex gap-1 bg-white rounded-lg border p-1">
          {speedOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => handleSpeedChange(option.value)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                speed === option.value
                  ? "bg-blue-600 text-white"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
              title={option.delay}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Step Mode Indicator */}
      {stepMode && (
        <div className="ml-4 px-3 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
          Step Mode
        </div>
      )}

      {/* State Indicator */}
      <div className="ml-auto flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            state === "running"
              ? "bg-green-500 animate-pulse"
              : state === "paused"
                ? "bg-yellow-500"
                : state === "error"
                  ? "bg-red-500"
                  : state === "completed"
                    ? "bg-blue-500"
                    : "bg-gray-400"
          }`}
        />
        <span className="text-sm text-gray-600 font-medium capitalize">
          {state}
        </span>
      </div>
    </div>
  );
};
