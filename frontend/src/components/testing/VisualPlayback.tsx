"use client";

import { useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlaybackControls } from "./PlaybackControls";
import { ActionTimeline } from "./ActionTimeline";
import { FileText, Layers } from "lucide-react";
import type {
  IntegrationTestResponse,
  IntegrationTestRun,
} from "@/types/integration-testing";
import { usePlayback } from "./_hooks/usePlayback";
import {
  ScreenshotWithOverlay,
  ScreenshotPlaceholder,
} from "./_components/ScreenshotCanvas";
import { StepDetails } from "./_components/StepDetailsCard";
import { resolveName } from "./utils";

interface VisualPlaybackProps {
  run: IntegrationTestResponse | IntegrationTestRun;
  onToggleVisualMode?: () => void;
  nameMap?: Map<string, string>;
}

export function VisualPlayback({
  run,
  onToggleVisualMode,
  nameMap,
}: VisualPlaybackProps) {
  const canvasRef = useRef<HTMLDivElement>(null);

  const {
    isPlaying,
    currentStepIndex,
    playbackSpeed,
    activeAnimation,
    currentStep,
    currentFrame,
    handlePlay,
    handlePause,
    handleNext,
    handlePrevious,
    handleReset,
    handleJumpTo,
    setPlaybackSpeed,
  } = usePlayback({ steps: run.steps });

  return (
    <div className="space-y-4">
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
        <div className="lg:col-span-2 space-y-4">
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

        <div className="space-y-4">
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

export default VisualPlayback;
