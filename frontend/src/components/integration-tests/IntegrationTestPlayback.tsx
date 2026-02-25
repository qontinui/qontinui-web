"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  FastForward,
  Maximize2,
  Minimize2,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ApiConfig } from "@/services/api-config";

/**
 * Frame data from the API for playback
 */
interface PlaybackFrame {
  historical_result_id: number;
  action_type: string;
  pattern_id: string | null;
  pattern_name: string | null;
  success: boolean;
  match_x: number | null;
  match_y: number | null;
  match_width: number | null;
  match_height: number | null;
  timestamp_ms: number | null;
  frame_base64: string | null;
  has_frame: boolean;
}

/**
 * Props for the playback component
 */
interface IntegrationTestPlaybackProps {
  historicalResultIds: number[];
  workflowName: string;
  onClose: () => void;
}

/**
 * Playback speeds available
 */
const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4];

/**
 * Visual playback component for integration test results.
 *
 * Displays screenshots from historical automation results with:
 * - Play/pause controls
 * - Step-by-step navigation
 * - Variable playback speed
 * - Match location overlay
 * - Fullscreen mode
 */
export const IntegrationTestPlayback: React.FC<
  IntegrationTestPlaybackProps
> = ({ historicalResultIds, workflowName, onClose }) => {
  // State
  const [frames, setFrames] = useState<PlaybackFrame[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Refs
  const playbackRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Current frame
  const currentFrame = frames[currentIndex];

  // Load frames from API
  useEffect(() => {
    if (historicalResultIds.length === 0) {
      setError("No historical results to display");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();

    const loadFrames = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${ApiConfig.RUNNER_URL}/api/capture/frames/playback`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              historical_result_ids: historicalResultIds,
            }),
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to load frames: ${response.statusText}`);
        }

        const data: PlaybackFrame[] = await response.json();
        setFrames(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load frames");
      } finally {
        setIsLoading(false);
      }
    };

    loadFrames();
    return () => controller.abort();
  }, [historicalResultIds]);

  // Navigation functions
  const goToStart = useCallback(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, []);

  const goToEnd = useCallback(() => {
    setCurrentIndex(frames.length - 1);
    setIsPlaying(false);
  }, [frames.length]);

  const goToPrevious = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentIndex((prev) => Math.min(frames.length - 1, prev + 1));
  }, [frames.length]);

  const togglePlayback = useCallback(() => {
    if (currentIndex >= frames.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying((prev) => !prev);
  }, [currentIndex, frames.length]);

  const cycleSpeed = useCallback(() => {
    const currentSpeedIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextIndex = (currentSpeedIndex + 1) % PLAYBACK_SPEEDS.length;
    const nextSpeed = PLAYBACK_SPEEDS[nextIndex];
    if (nextSpeed !== undefined) {
      setPlaybackSpeed(nextSpeed);
    }
  }, [playbackSpeed]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  // Playback timer
  useEffect(() => {
    if (isPlaying && frames.length > 0) {
      const interval = 1000 / playbackSpeed; // Base interval adjusted by speed

      playbackRef.current = setInterval(() => {
        setCurrentIndex((prev) => {
          if (prev >= frames.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, interval);

      return () => {
        if (playbackRef.current) {
          clearInterval(playbackRef.current);
        }
      };
    }
    return undefined;
  }, [isPlaying, playbackSpeed, frames.length]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case " ":
          e.preventDefault();
          setIsPlaying((prev) => !prev);
          return;
        case "ArrowLeft":
          e.preventDefault();
          goToPrevious();
          return;
        case "ArrowRight":
          e.preventDefault();
          goToNext();
          return;
        case "Home":
          e.preventDefault();
          goToStart();
          return;
        case "End":
          e.preventDefault();
          goToEnd();
          return;
        case "Escape":
          e.preventDefault();
          if (isFullscreen) {
            setIsFullscreen(false);
          } else {
            onClose();
          }
          return;
        default:
          return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen, onClose, goToPrevious, goToNext, goToStart, goToEnd]);

  // Render loading state
  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-text-muted">Loading playback frames...</p>
        </div>
      </div>
    );
  }

  // Render error state
  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center text-red-600">
          <XCircle className="w-12 h-12 mx-auto mb-4" />
          <p>{error}</p>
          <Button onClick={onClose} className="mt-4">
            Close
          </Button>
        </div>
      </div>
    );
  }

  // Render empty state
  if (frames.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="text-center text-text-muted">
          <p>No frames available for playback</p>
          <Button onClick={onClose} className="mt-4">
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`
        ${isFullscreen ? "fixed inset-0 z-50 bg-black" : "w-full h-full"}
        flex flex-col
      `}
    >
      {/* Header */}
      <div
        className={`
        flex items-center justify-between px-4 py-2
        ${isFullscreen ? "bg-surface-canvas text-white" : "bg-white border-b"}
      `}
      >
        <div className="flex items-center gap-4">
          <h3 className="font-semibold">{workflowName}</h3>
          <span
            className={`text-sm ${isFullscreen ? "text-text-muted" : "text-text-muted"}`}
          >
            Step {currentIndex + 1} of {frames.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleFullscreen}
            className={isFullscreen ? "text-white hover:bg-surface-raised" : ""}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className={isFullscreen ? "text-white hover:bg-surface-raised" : ""}
          >
            Close
          </Button>
        </div>
      </div>

      {/* Frame Display */}
      <div className="flex-1 relative overflow-hidden bg-surface-canvas">
        {currentFrame?.frame_base64 ? (
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Screenshot */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/jpeg;base64,${currentFrame.frame_base64}`}
              alt={`Step ${currentIndex + 1}`}
              className="max-w-full max-h-full object-contain"
            />

            {/* Match location overlay */}
            {currentFrame.match_x !== null && currentFrame.match_y !== null && (
              <div
                className="absolute border-2 border-green-500 bg-green-500/20 pointer-events-none"
                style={{
                  // This is approximate - would need actual image dimensions for accuracy
                  left: `${(currentFrame.match_x / 1920) * 100}%`,
                  top: `${(currentFrame.match_y / 1080) * 100}%`,
                  width: `${((currentFrame.match_width || 100) / 1920) * 100}%`,
                  height: `${((currentFrame.match_height || 50) / 1080) * 100}%`,
                }}
              />
            )}

            {/* Action info overlay */}
            <div className="absolute bottom-4 left-4 right-4 bg-black/70 rounded-lg p-3 text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {currentFrame.success ? (
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-500" />
                  )}
                  <span className="font-medium">
                    {currentFrame.action_type}
                  </span>
                  {currentFrame.pattern_name && (
                    <span className="text-text-muted">
                      - {currentFrame.pattern_name}
                    </span>
                  )}
                </div>
                {currentFrame.timestamp_ms !== null && (
                  <span className="text-text-muted text-sm">
                    {(currentFrame.timestamp_ms / 1000).toFixed(2)}s
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-muted">
            <div className="text-center">
              <p>No frame available for this step</p>
              <p className="text-sm mt-2">
                {currentFrame?.action_type} -{" "}
                {currentFrame?.pattern_name || "N/A"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div
        className={`px-4 py-2 ${isFullscreen ? "bg-surface-canvas" : "bg-surface-raised"}`}
      >
        <Slider
          value={[currentIndex]}
          min={0}
          max={frames.length - 1}
          step={1}
          onValueChange={([value]) => {
            if (value !== undefined) {
              setCurrentIndex(value);
              setIsPlaying(false);
            }
          }}
          className="w-full"
        />
      </div>

      {/* Controls */}
      <div
        className={`
        flex items-center justify-center gap-4 px-4 py-3
        ${isFullscreen ? "bg-surface-canvas" : "bg-white border-t"}
      `}
      >
        {/* Skip to start */}
        <Button
          variant="ghost"
          size="sm"
          onClick={goToStart}
          disabled={currentIndex === 0}
          className={isFullscreen ? "text-white hover:bg-surface-raised" : ""}
        >
          <SkipBack className="w-4 h-4" />
        </Button>

        {/* Previous */}
        <Button
          variant="ghost"
          size="sm"
          onClick={goToPrevious}
          disabled={currentIndex === 0}
          className={isFullscreen ? "text-white hover:bg-surface-raised" : ""}
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

        {/* Play/Pause */}
        <Button
          variant="default"
          size="lg"
          onClick={togglePlayback}
          className="rounded-full w-12 h-12"
        >
          {isPlaying ? (
            <Pause className="w-5 h-5" />
          ) : (
            <Play className="w-5 h-5 ml-0.5" />
          )}
        </Button>

        {/* Next */}
        <Button
          variant="ghost"
          size="sm"
          onClick={goToNext}
          disabled={currentIndex === frames.length - 1}
          className={isFullscreen ? "text-white hover:bg-surface-raised" : ""}
        >
          <ChevronRight className="w-5 h-5" />
        </Button>

        {/* Skip to end */}
        <Button
          variant="ghost"
          size="sm"
          onClick={goToEnd}
          disabled={currentIndex === frames.length - 1}
          className={isFullscreen ? "text-white hover:bg-surface-raised" : ""}
        >
          <SkipForward className="w-4 h-4" />
        </Button>

        {/* Speed control */}
        <Button
          variant="ghost"
          size="sm"
          onClick={cycleSpeed}
          className={`ml-4 gap-1 ${isFullscreen ? "text-white hover:bg-surface-raised" : ""}`}
        >
          <FastForward className="w-4 h-4" />
          <span className="text-xs">{playbackSpeed}x</span>
        </Button>
      </div>
    </div>
  );
};

export default IntegrationTestPlayback;
