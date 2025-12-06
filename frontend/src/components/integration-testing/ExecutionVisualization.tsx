// components/integration-testing/ExecutionVisualization.tsx

"use client";

import { Card } from "@/components/ui/card";
import { Timeline } from "./Timeline";
import { ActionDetails } from "./ActionDetails";
import { ActiveStatesBadges } from "./ActiveStatesBadges";
import { FindVisualization } from "./visualizations/FindVisualization";
import { ClickVisualization } from "./visualizations/ClickVisualization";
import { TypeVisualization } from "./visualizations/TypeVisualization";
import { MoveMouseVisualization } from "./visualizations/MoveMouseVisualization";
import { HighlightVisualization } from "./visualizations/HighlightVisualization";
import { ScrollVisualization } from "./visualizations/ScrollVisualization";
import { WaitVisualization } from "./visualizations/WaitVisualization";
import { DefineVisualization } from "./visualizations/DefineVisualization";
import { VanishVisualization } from "./visualizations/VanishVisualization";
import { useExecutionPlayback } from "@/hooks/useExecutionPlayback";
import { getScreenshotUrl } from "@/lib/api/integration-testing";
import type { MockExecutionResponse } from "@/types/integration-testing";
import { VideoExportButton } from "./VideoExportButton";
import { ReportExportButton } from "./ReportExportButton";

interface ExecutionVisualizationProps {
  result: MockExecutionResponse;
}

export function ExecutionVisualization({
  result,
}: ExecutionVisualizationProps) {
  const {
    currentAction,
    currentIndex,
    isPlaying,
    next,
    previous,
    jumpTo,
    play,
    pause,
    reset,
  } = useExecutionPlayback({
    actions: result.actions,
    autoPlay: false,
    playbackSpeed: 1500,
  });

  if (!currentAction) {
    return <div>No action data available</div>;
  }

  const screenshotUrl = getScreenshotUrl(
    result.process_id,
    currentAction.screenshot_path
  );

  return (
    <div className="space-y-4">
      {/* Summary Card */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold">Execution Results</h2>
          <div className="flex gap-2">
            <ReportExportButton result={result} />
            <VideoExportButton executionResult={result} />
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-sm text-gray-500">Process</p>
            <p className="font-semibold">{result.process_name}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Success Rate</p>
            <p className="font-semibold">
              {Math.round(result.success_rate * 100)}%
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Actions</p>
            <p className="font-semibold">
              {result.successful_actions}/{result.total_actions}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Duration</p>
            <p className="font-semibold">
              {Math.round(result.total_duration_ms)}ms
            </p>
          </div>
        </div>
      </Card>

      {/* Screenshot Viewer */}
      <Card className="p-0 overflow-hidden">
        <div className="relative bg-gray-900">
          {/* Screenshot */}
          <img
            src={screenshotUrl}
            alt={`Action ${currentIndex + 1}`}
            className="w-full h-auto"
          />

          {/* Active States Overlay */}
          <div className="absolute top-4 left-4">
            <ActiveStatesBadges states={currentAction.active_states} />
          </div>

          {/* Success/Failure Badge */}
          <div className="absolute top-4 right-4">
            <span
              className={`
                px-3 py-1 rounded-full text-sm font-semibold
                ${
                  currentAction.success
                    ? "bg-green-500 text-white"
                    : "bg-red-500 text-white"
                }
              `}
            >
              {currentAction.success ? "✓ Success" : "✗ Failed"}
            </span>
          </div>

          {/* Action Visualizations */}
          {currentAction.action_type === "FIND" && (
            <FindVisualization
              matches={currentAction.matches || []}
              actionRegion={currentAction.action_region}
            />
          )}

          {currentAction.action_type === "CLICK" && (
            <ClickVisualization location={currentAction.action_location} />
          )}

          {currentAction.action_type === "TYPE" && (
            <TypeVisualization
              location={currentAction.action_location}
              text={currentAction.text || ""}
            />
          )}

          {currentAction.action_type === "MOVE_MOUSE" && (
            <MoveMouseVisualization location={currentAction.action_location} />
          )}

          {currentAction.action_type === "HIGHLIGHT" && (
            <HighlightVisualization
              actionRegion={currentAction.action_region}
              location={currentAction.action_location}
            />
          )}

          {currentAction.action_type === "SCROLL" && (
            <ScrollVisualization
              actionRegion={currentAction.action_region}
              location={currentAction.action_location}
              direction={(currentAction as any).direction}
              amount={(currentAction as any).amount}
            />
          )}

          {currentAction.action_type === "WAIT" && (
            <WaitVisualization
              actionRegion={currentAction.action_region}
              location={currentAction.action_location}
              duration={currentAction.duration_ms}
            />
          )}

          {currentAction.action_type === "DEFINE" && (
            <DefineVisualization
              actionRegion={currentAction.action_region}
              location={currentAction.action_location}
              stateName={(currentAction as any).state_name}
            />
          )}

          {currentAction.action_type === "VANISH" && (
            <VanishVisualization
              actionRegion={currentAction.action_region}
              location={currentAction.action_location}
              stateName={(currentAction as any).state_name}
            />
          )}
        </div>
      </Card>

      {/* Timeline */}
      <Timeline
        actions={result.actions}
        currentIndex={currentIndex}
        isPlaying={isPlaying}
        onJumpTo={jumpTo}
        onNext={next}
        onPrevious={previous}
        onPlay={play}
        onPause={pause}
        onReset={reset}
      />

      {/* Action Details */}
      <ActionDetails action={currentAction} />
    </div>
  );
}
