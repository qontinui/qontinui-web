"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlaybackControls } from "./PlaybackControls";
import { ActionTimeline } from "./ActionTimeline";
import {
  Image as ImageIcon,
  MousePointer2,
  Keyboard,
  Move,
  Eye,
  RefreshCw,
  Compass,
  Route,
  AlertCircle,
  Layers,
  CheckCircle2,
  XCircle,
  FileText,
} from "lucide-react";
import type {
  IntegrationTestResponse,
  IntegrationTestRun,
  ExecutionStep,
  ActionStep,
  PlaybackFrame,
  ActionAnimation,
  HighlightRegion,
} from "@/types/integration-testing";

interface VisualPlaybackProps {
  /** The integration test run data */
  run: IntegrationTestResponse | IntegrationTestRun;
  /** Callback when switching to non-visual mode */
  onToggleVisualMode?: () => void;
  /** Map of state/element IDs to display names */
  nameMap?: Map<string, string>;
}

/**
 * Helper to resolve an ID to a display name
 */
function resolveName(id: string, nameMap?: Map<string, string>): string {
  return nameMap?.get(id) ?? id;
}

/**
 * VisualPlayback Component
 *
 * Animated playback showing what the automation "would have done":
 * - Screenshot canvas with state screenshots
 * - Action animations (click ripple, type indicator, drag path)
 * - Highlighted match regions
 * - Playback controls and timeline
 */
export function VisualPlayback({
  run,
  onToggleVisualMode,
  nameMap,
}: VisualPlaybackProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [activeAnimation, setActiveAnimation] =
    useState<ActionAnimation | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const currentStep = run.steps[currentStepIndex] as ExecutionStep | undefined;

  // Get playback frame for current step
  const currentFrame: PlaybackFrame | null = currentStep
    ? generatePlaybackFrame(currentStep, currentStepIndex)
    : null;

  // Auto-play logic
  useEffect(() => {
    if (isPlaying && run.steps.length > 0) {
      const baseDuration = 2000; // Base duration per step
      const interval = baseDuration / playbackSpeed;

      playIntervalRef.current = setInterval(() => {
        setCurrentStepIndex((prev) => {
          if (prev >= run.steps.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, interval);

      return () => {
        if (playIntervalRef.current) {
          clearInterval(playIntervalRef.current);
        }
      };
    }
    return undefined;
  }, [isPlaying, playbackSpeed, run.steps.length]);

  const triggerActionAnimation = useCallback((step: ActionStep) => {
    const animation = getAnimationForAction(step);
    setActiveAnimation(animation);

    // Clear animation after duration
    if (animation) {
      const timeout = setTimeout(() => {
        setActiveAnimation(null);
      }, animation.duration_ms);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, []);

  // Trigger animation when step changes
  useEffect(() => {
    if (currentStep?.type === "action") {
      const actionStep = currentStep as ActionStep;
      triggerActionAnimation(actionStep);
    }
  }, [currentStepIndex, currentStep, triggerActionAnimation]);

  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleNext = () => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.min(prev + 1, run.steps.length - 1));
  };
  const handlePrevious = () => {
    setIsPlaying(false);
    setCurrentStepIndex((prev) => Math.max(prev - 1, 0));
  };
  const handleReset = () => {
    setIsPlaying(false);
    setCurrentStepIndex(0);
  };
  const handleJumpTo = (index: number) => {
    setIsPlaying(false);
    setCurrentStepIndex(index);
  };

  return (
    <div className="space-y-4">
      {/* Header with mode toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">Visual Playback</h2>
          <Badge className="bg-brand-primary/20 text-brand-primary border-brand-primary/30">
            {run.steps.length} Steps
          </Badge>
        </div>
        {onToggleVisualMode && (
          <Button
            variant="outline"
            size="sm"
            onClick={onToggleVisualMode}
            className="border-border-default hover:border-border-default"
          >
            <FileText className="w-4 h-4 mr-2" />
            View Details
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Canvas Area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Screenshot Canvas */}
          <Card className="bg-surface-raised/50 border-border-subtle/50 overflow-hidden">
            <CardContent className="p-0">
              <div
                ref={canvasRef}
                className="relative aspect-video bg-surface-canvas flex items-center justify-center"
              >
                {currentFrame?.screenshot_url ? (
                  <ScreenshotWithOverlay
                    screenshotUrl={currentFrame.screenshot_url}
                    highlightRegions={currentFrame.highlight_regions}
                    animation={activeAnimation}
                  />
                ) : (
                  <ScreenshotPlaceholder step={currentStep} />
                )}
              </div>
            </CardContent>
          </Card>

          {/* Playback Controls */}
          <PlaybackControls
            isPlaying={isPlaying}
            currentIndex={currentStepIndex}
            totalSteps={run.steps.length}
            playbackSpeed={playbackSpeed}
            onPlay={handlePlay}
            onPause={handlePause}
            onNext={handleNext}
            onPrevious={handlePrevious}
            onReset={handleReset}
            onJumpTo={handleJumpTo}
            onSpeedChange={setPlaybackSpeed}
            disabled={run.steps.length === 0}
          />
        </div>

        {/* Side Panel */}
        <div className="space-y-4">
          {/* Current Step Details */}
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-text-muted">
                Current Step
              </CardTitle>
            </CardHeader>
            <CardContent>
              {currentStep ? (
                <StepDetails step={currentStep} nameMap={nameMap} />
              ) : (
                <div className="text-sm text-text-muted">No step selected</div>
              )}
            </CardContent>
          </Card>

          {/* Active States */}
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-text-muted flex items-center gap-2">
                <Layers className="w-4 h-4" />
                Active States
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {currentFrame?.active_states &&
                currentFrame.active_states.length > 0 ? (
                  currentFrame.active_states.map((state) => (
                    <Badge
                      key={state}
                      className="bg-blue-500/10 text-blue-400 border-blue-500/30 text-xs"
                    >
                      {resolveName(state, nameMap)}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-text-muted">
                    No active states
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Timeline */}
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-text-muted">
                Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="max-h-64 overflow-y-auto">
              <ActionTimeline
                steps={run.steps}
                currentIndex={currentStepIndex}
                onSelectStep={handleJumpTo}
                orientation="vertical"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Screenshot Display Components
// =============================================================================

interface ScreenshotWithOverlayProps {
  screenshotUrl: string;
  highlightRegions: HighlightRegion[];
  animation: ActionAnimation | null;
}

function ScreenshotWithOverlay({
  screenshotUrl,
  highlightRegions,
  animation,
}: ScreenshotWithOverlayProps) {
  return (
    <div className="relative w-full h-full">
      {/* Screenshot Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={screenshotUrl}
        alt="Automation screenshot"
        className="w-full h-full object-contain"
      />

      {/* Highlight Regions */}
      {highlightRegions.map((region, index) => (
        <HighlightBox key={`highlight-${index}`} region={region} />
      ))}

      {/* Action Animation */}
      {animation && <ActionAnimationOverlay animation={animation} />}
    </div>
  );
}

function HighlightBox({ region }: { region: HighlightRegion }) {
  const styleClasses = {
    solid: "border-2",
    dashed: "border-2 border-dashed",
    pulse: "border-2 animate-pulse",
  };

  return (
    <div
      className={`absolute ${styleClasses[region.style || "solid"]}`}
      style={{
        left: `${region.x}px`,
        top: `${region.y}px`,
        width: `${region.width}px`,
        height: `${region.height}px`,
        borderColor: region.color || "var(--color-brand-primary)",
      }}
    >
      {region.label && (
        <div
          className="absolute -top-6 left-0 px-1 py-0.5 text-xs font-medium rounded whitespace-nowrap"
          style={{
            backgroundColor: region.color || "var(--color-brand-primary)",
            color: "black",
          }}
        >
          {region.label}
        </div>
      )}
    </div>
  );
}

function ActionAnimationOverlay({ animation }: { animation: ActionAnimation }) {
  switch (animation.animation_type) {
    case "click_ripple":
      return (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${animation.start_position?.x ?? 0}px`,
            top: `${animation.start_position?.y ?? 0}px`,
            transform: "translate(-50%, -50%)",
          }}
        >
          <div className="w-8 h-8 rounded-full bg-brand-primary/50 animate-ping" />
          <div className="absolute inset-0 w-8 h-8 rounded-full bg-brand-primary animate-pulse" />
        </div>
      );

    case "type_indicator":
      return (
        <div
          className="absolute pointer-events-none px-2 py-1 bg-yellow-500/80 text-black text-sm font-mono rounded"
          style={{
            left: `${animation.start_position?.x ?? 0}px`,
            top: `${animation.start_position?.y ?? 0}px`,
          }}
        >
          {animation.text || "..."}
          <span className="animate-pulse">|</span>
        </div>
      );

    case "drag_path":
      if (!animation.start_position || !animation.end_position) return null;
      return (
        <svg className="absolute inset-0 w-full h-full pointer-events-none">
          <line
            x1={animation.start_position.x}
            y1={animation.start_position.y}
            x2={animation.end_position.x}
            y2={animation.end_position.y}
            stroke="var(--color-brand-primary)"
            strokeWidth="3"
            strokeDasharray="8,4"
            className="animate-pulse"
          />
          <circle
            cx={animation.start_position.x}
            cy={animation.start_position.y}
            r="6"
            fill="var(--color-brand-primary)"
          />
          <circle
            cx={animation.end_position.x}
            cy={animation.end_position.y}
            r="6"
            fill="#F59E0B"
          />
        </svg>
      );

    case "scroll_indicator":
      return (
        <div
          className="absolute pointer-events-none"
          style={{
            left: `${animation.start_position?.x ?? 0}px`,
            top: `${animation.start_position?.y ?? 0}px`,
          }}
        >
          <div className="flex flex-col items-center text-brand-primary animate-bounce">
            <div className="w-6 h-10 border-2 border-current rounded-full flex justify-center pt-2">
              <div className="w-1.5 h-3 bg-current rounded-full animate-scroll" />
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

interface ScreenshotPlaceholderProps {
  step?: ExecutionStep;
}

function ScreenshotPlaceholder({ step }: ScreenshotPlaceholderProps) {
  const getPlaceholderContent = () => {
    if (!step) {
      return {
        icon: <ImageIcon className="w-16 h-16 text-text-muted" />,
        title: "No Screenshot Available",
        description: "Select a step to view its visual representation",
      };
    }

    switch (step.type) {
      case "state_discovery":
        return {
          icon: <Compass className="w-16 h-16 text-blue-500" />,
          title: "State Discovery",
          description: `Detected ${step.active_states.length} active state(s)`,
        };
      case "path_calculation":
        return {
          icon: <Route className="w-16 h-16 text-purple-500" />,
          title: "Path Calculation",
          description: `Target: ${step.target_state}`,
        };
      case "action":
        return {
          icon: getActionIcon(step),
          title: `${step.action_type.toUpperCase()}: ${step.action_name}`,
          description: step.result.success
            ? "Action completed successfully"
            : `Failed: ${step.result.error_message || "Unknown error"}`,
        };
      case "state_update":
        return {
          icon: <RefreshCw className="w-16 h-16 text-cyan-500" />,
          title: "State Update",
          description: `+${step.activated_states.length} / -${step.deactivated_states.length} states`,
        };
    }
  };

  const content = getPlaceholderContent();

  return (
    <div className="flex flex-col items-center justify-center text-center p-8">
      {content.icon}
      <h3 className="text-lg font-medium text-white mt-4">{content.title}</h3>
      <p className="text-sm text-text-muted mt-1">{content.description}</p>
    </div>
  );
}

// =============================================================================
// Step Details Component
// =============================================================================

function StepDetails({
  step,
  nameMap,
}: {
  step: ExecutionStep;
  nameMap?: Map<string, string>;
}) {
  const getStepIcon = () => {
    switch (step.type) {
      case "state_discovery":
        return <Compass className="w-5 h-5 text-blue-400" />;
      case "path_calculation":
        return <Route className="w-5 h-5 text-purple-400" />;
      case "action":
        return getActionIcon(step);
      case "state_update":
        return <RefreshCw className="w-5 h-5 text-cyan-400" />;
    }
  };

  const getStepTitle = () => {
    switch (step.type) {
      case "state_discovery":
        return "State Discovery";
      case "path_calculation":
        return `Path to ${resolveName(step.target_state, nameMap)}`;
      case "action":
        return `${step.action_type.toUpperCase()}: ${step.action_name}`;
      case "state_update":
        return "State Update";
    }
  };

  const getStatusBadge = () => {
    if (step.type === "action") {
      return step.result.success ? (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Success
        </Badge>
      ) : (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
          <XCircle className="w-3 h-3 mr-1" />
          Failed
        </Badge>
      );
    }
    return null;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {getStepIcon()}
        <span className="text-sm font-medium text-white">{getStepTitle()}</span>
      </div>

      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs font-mono">
          Step #{step.step_number}
        </Badge>
        {getStatusBadge()}
      </div>

      <div className="text-xs text-text-muted">
        Duration:{" "}
        {step.duration_ms === 0 ? "0ms (virtual)" : `${step.duration_ms}ms`}
      </div>

      {/* Step-specific details */}
      {step.type === "action" && step.pattern_name && (
        <div className="text-xs">
          <span className="text-text-muted">Pattern:</span>{" "}
          <span className="text-brand-primary">
            {resolveName(step.pattern_name, nameMap)}
          </span>
        </div>
      )}

      {step.type === "action" && step.match_location && (
        <div className="text-xs">
          <span className="text-text-muted">Location:</span>{" "}
          <span className="text-white font-mono">
            ({step.match_location.x}, {step.match_location.y})
          </span>
          <span className="text-text-muted ml-2">Score:</span>{" "}
          <span className="text-white">
            {(step.match_location.score * 100).toFixed(1)}%
          </span>
        </div>
      )}

      {step.type === "state_update" && (
        <div className="space-y-1 text-xs">
          {step.activated_states.length > 0 && (
            <div>
              <span className="text-green-400">+</span>{" "}
              {step.activated_states
                .map((s) => resolveName(s, nameMap))
                .join(", ")}
            </div>
          )}
          {step.deactivated_states.length > 0 && (
            <div>
              <span className="text-red-400">-</span>{" "}
              {step.deactivated_states
                .map((s) => resolveName(s, nameMap))
                .join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Helper Functions
// =============================================================================

function getActionIcon(step: ActionStep): React.ReactNode {
  switch (step.action_type) {
    case "click":
      return <MousePointer2 className="w-16 h-16 text-green-400" />;
    case "type":
      return <Keyboard className="w-16 h-16 text-yellow-400" />;
    case "drag":
      return <Move className="w-16 h-16 text-orange-400" />;
    case "find":
      return <Eye className="w-16 h-16 text-blue-400" />;
    default:
      return <AlertCircle className="w-16 h-16 text-text-muted" />;
  }
}

function generatePlaybackFrame(
  step: ExecutionStep,
  index: number
): PlaybackFrame {
  const frame: PlaybackFrame = {
    step_index: index,
    step_type: step.type,
    screenshot_url: null,
    active_states: [],
    timestamp: step.timestamp,
    highlight_regions: [],
  };

  switch (step.type) {
    case "state_discovery":
      frame.active_states = step.active_states;
      break;
    case "path_calculation":
      frame.active_states = step.current_states;
      break;
    case "action":
      frame.screenshot_url = step.screenshot_url || null;
      frame.active_states = step.from_states;
      if (step.match_location) {
        frame.highlight_regions.push({
          x: step.match_location.x,
          y: step.match_location.y,
          width: step.match_location.width,
          height: step.match_location.height,
          label: step.pattern_name,
          color: step.result.success ? "#22C55E" : "#EF4444",
          style: "solid",
        });
      }
      break;
    case "state_update":
      frame.active_states = step.new_active_states;
      break;
  }

  return frame;
}

function getAnimationForAction(step: ActionStep): ActionAnimation | null {
  const location = step.match_location;

  switch (step.action_type) {
    case "click":
      return location
        ? {
            animation_type: "click_ripple",
            start_position: {
              x: location.x + location.width / 2,
              y: location.y + location.height / 2,
            },
            duration_ms: 500,
          }
        : null;

    case "type":
      return location
        ? {
            animation_type: "type_indicator",
            start_position: { x: location.x, y: location.y },
            text: step.input_data?.text || "...",
            duration_ms: 1000,
          }
        : null;

    case "drag":
      return step.input_data?.from && step.input_data?.to
        ? {
            animation_type: "drag_path",
            start_position: step.input_data.from,
            end_position: step.input_data.to,
            duration_ms: 800,
          }
        : null;

    case "scroll":
      return location
        ? {
            animation_type: "scroll_indicator",
            start_position: {
              x: location.x + location.width / 2,
              y: location.y + location.height / 2,
            },
            duration_ms: 600,
          }
        : null;

    default:
      return null;
  }
}

export default VisualPlayback;
