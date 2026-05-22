"use client";

/**
 * Workflow Visualization Page
 *
 * Shows workflow execution with states appearing/disappearing as actions execute
 * Left panel: Workflow structure (graph or sequential)
 * Right panel: Active states canvas with bounds and layering
 *
 * Supports two modes:
 * 1. Playback mode: Step through actions manually or automatically
 * 2. Live mode: Connect to runner via WebSocket for real-time perception
 */

import { useState, Suspense, useMemo } from "react";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { RequireProject } from "@/components/require-project";
import { useExecutionEvents } from "@/hooks/useExecutionEvents";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import { useWorkflowData } from "./_hooks/useWorkflowData";
import { usePlayback } from "./_hooks/usePlayback";
import { useHistoricalData } from "./_hooks/useHistoricalData";
import { PageHeader } from "./_components/PageHeader";
import { WorkflowPanel } from "./_components/WorkflowPanel";
import { ActiveStatesPanel } from "./_components/ActiveStatesPanel";
import { PlaybackControls } from "./_components/PlaybackControls";

export default function WorkflowVisualizationPage() {
  const { user } = useAuth();
  const { projectId } = useAutomation();

  // Live mode state
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [canvasMode, setCanvasMode] = useState<"perception" | "config">(
    "perception"
  );

  // Data loading
  const {
    workflows,
    states,
    images,
    projects,
    selectedWorkflowId,
    setSelectedWorkflowId,
    selectedProject,
    setSelectedProject,
    selectedWorkflow,
    loading,
  } = useWorkflowData(user);

  // Playback controls
  const {
    currentActionIndex,
    isPlaying,
    playbackSpeed,
    setPlaybackSpeed,
    activeStateIds,
    assumeSuccess,
    setAssumeSuccess,
    setIsPlaying,
    handleStepForward,
    handleStepBack,
    handleReset,
    handlePlayPause,
    handleActionSelect,
    handleSliderChange,
  } = usePlayback(selectedWorkflow, selectedWorkflowId, states);

  // Historical data
  const {
    testRuns,
    selectedTestRunId,
    setSelectedTestRunId,
    loadingTestRuns,
    historicalResults,
    loadingHistoricalData,
    historicalFoundImages,
    historicalActiveStateIds,
  } = useHistoricalData(projectId, canvasMode, isLiveMode);

  // Live execution events from runner WebSocket
  const {
    activeStateIds: liveActiveStateIds,
    imageRecognitions,
    connectionState,
    isConnected,
    clearState: clearExecutionState,
  } = useExecutionEvents({
    enabled: isLiveMode,
    onConnect: () => {
      toast.success("Connected to runner for live perception");
    },
    onDisconnect: () => {
      if (isLiveMode) {
        toast.warning("Disconnected from runner");
      }
    },
    onError: (error) => {
      toast.error(`Runner connection error: ${error.message}`);
    },
  });

  const { monitors } = useRunnerMonitors();

  const liveActiveStateIdsArray = useMemo(
    () => Array.from(liveActiveStateIds),
    [liveActiveStateIds]
  );

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <RequireProject pageName="Workflow Visualization">
        <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
          <PageHeader
            projects={projects}
            selectedProject={selectedProject}
            onProjectChange={setSelectedProject}
            workflows={workflows}
            selectedWorkflowId={selectedWorkflowId}
            onWorkflowChange={setSelectedWorkflowId}
          />

          <main className="flex-1 overflow-y-auto p-6">
            {selectedWorkflow ? (
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
                <WorkflowPanel
                  workflow={selectedWorkflow}
                  currentActionIndex={currentActionIndex}
                  onActionSelect={handleActionSelect}
                />

                <ActiveStatesPanel
                  states={states}
                  images={images}
                  monitors={monitors}
                  isLiveMode={isLiveMode}
                  onLiveModeChange={(checked) => {
                    setIsLiveMode(checked);
                    if (checked) {
                      clearExecutionState();
                      setIsPlaying(false);
                    }
                  }}
                  canvasMode={canvasMode}
                  onCanvasModeChange={(checked) => {
                    setCanvasMode(checked ? "config" : "perception");
                  }}
                  liveActiveStateIdsArray={liveActiveStateIdsArray}
                  activeStateIds={activeStateIds}
                  isConnected={isConnected}
                  connectionState={connectionState}
                  testRuns={testRuns}
                  selectedTestRunId={selectedTestRunId}
                  onTestRunChange={setSelectedTestRunId}
                  loadingTestRuns={loadingTestRuns}
                  loadingHistoricalData={loadingHistoricalData}
                  historicalResults={historicalResults}
                  liveActiveStateIds={liveActiveStateIds}
                  historicalActiveStateIds={historicalActiveStateIds}
                  imageRecognitions={imageRecognitions}
                  historicalFoundImages={historicalFoundImages}
                />
              </div>
            ) : (
              <Card>
                <CardContent className="p-12 text-center">
                  <Activity className="mx-auto h-16 w-16 text-muted-foreground mb-4" />
                  <p className="text-lg text-muted-foreground">
                    {loading
                      ? "Loading workflows..."
                      : "Select a workflow to visualize"}
                  </p>
                </CardContent>
              </Card>
            )}

            {selectedWorkflow && (
              <PlaybackControls
                currentActionIndex={currentActionIndex}
                isPlaying={isPlaying}
                playbackSpeed={playbackSpeed}
                assumeSuccess={assumeSuccess}
                totalActions={selectedWorkflow.actions.length}
                onReset={handleReset}
                onStepBack={handleStepBack}
                onPlayPause={handlePlayPause}
                onStepForward={handleStepForward}
                onSpeedChange={setPlaybackSpeed}
                onAssumeSuccessToggle={() => setAssumeSuccess(!assumeSuccess)}
                onSliderChange={handleSliderChange}
              />
            )}
          </main>
        </div>
      </RequireProject>
    </Suspense>
  );
}
