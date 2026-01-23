"use client";

/**
 * State Machine Page
 *
 * Visual editor for creating and managing state structures in automation workflows.
 * Four tabs:
 * - Definition: Create and edit states, transitions, and their properties
 * - State View: Visualize states spatially on a canvas
 * - Transitions: Animate and visualize transition execution
 * - Discovery: Automatically explore and discover states from target applications
 */

import { useState, useMemo, useEffect, useCallback, Suspense } from "react";
import { StateStructure } from "@/components/state-machine";
import { RequireProject } from "@/components/require-project";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { useAutomation } from "@/contexts/automation-context";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { useUIBridgeExploration, type ExploredElement } from "@/hooks/useUIBridgeExploration";
import { ActiveStatesCanvas } from "@/components/workflow-viz/ActiveStatesCanvas";
import { TransitionAnimationCanvas } from "@/components/workflow-viz/TransitionAnimationCanvas";
import { TransitionPlaybackControls } from "@/components/workflow-viz/TransitionPlaybackControls";
import { TransitionList } from "@/components/workflow-viz/TransitionList";
import { useTransitionAnimation } from "@/components/workflow-viz/TransitionAnimationController";
import { ExplorationConfigPanel } from "@/components/ui-bridge/ExplorationConfigPanel";
import type { Transition, StateMachineState } from "@/contexts/automation-context/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Layers,
  Eye,
  EyeOff,
  CheckSquare,
  Square,
  ArrowRight,
  Network,
  Compass,
  CheckCircle2,
  AlertCircle,
  Plus,
  Save,
} from "lucide-react";
import { toast } from "sonner";

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
    </div>
  );
}

/**
 * State Visualization Tab Content
 */
function StateVisualizationTab() {
  const { states, images } = useAutomation();
  const { monitors, isRunnerConnected } = useRunnerMonitors();

  const [selectedStateIds, setSelectedStateIds] = useState<string[]>([]);
  const [highlightedStateId, setHighlightedStateId] = useState<
    string | undefined
  >();

  // Calculate canvas info for display
  const canvasInfo = useMemo(() => {
    if (monitors.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      monitors.forEach((m) => {
        minX = Math.min(minX, m.x);
        minY = Math.min(minY, m.y);
        maxX = Math.max(maxX, m.x + m.width);
        maxY = Math.max(maxY, m.y + m.height);
      });
      return {
        width: maxX - minX || 1920,
        height: maxY - minY || 1080,
        source: "monitors" as const,
      };
    }
    return {
      width: null,
      height: null,
      source: "content" as const,
    };
  }, [monitors]);

  // Filter to states that have visible elements (StateImages with positions)
  const statesWithElements = useMemo(() => {
    return states.filter((state) => {
      const hasPositionedImages = state.stateImages?.some((img) =>
        img.patterns?.some((p) => {
          const hasOffsets = p.offsetX !== undefined && p.offsetY !== undefined;
          const hasSearchRegion = p.searchRegions?.some(
            (sr) => sr.x !== undefined && sr.y !== undefined
          );
          return hasOffsets || hasSearchRegion;
        })
      );
      const hasRegions = (state.regions?.length ?? 0) > 0;
      const hasLocations = (state.locations?.length ?? 0) > 0;
      return hasPositionedImages || hasRegions || hasLocations;
    });
  }, [states]);

  // Get selected states
  const selectedStates = useMemo(() => {
    return states.filter((s) => selectedStateIds.includes(s.id));
  }, [states, selectedStateIds]);

  // Toggle state selection
  const toggleState = (stateId: string) => {
    setSelectedStateIds((prev) =>
      prev.includes(stateId)
        ? prev.filter((id) => id !== stateId)
        : [...prev, stateId]
    );
  };

  // Select all states with elements
  const selectAll = () => {
    setSelectedStateIds(statesWithElements.map((s) => s.id));
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedStateIds([]);
    setHighlightedStateId(undefined);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-full">
      {/* Left Panel - State Selection */}
      <Card className="lg:col-span-1 flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>States</span>
            <Badge variant="outline">{statesWithElements.length}</Badge>
          </CardTitle>
          <CardDescription>Select states to display on canvas</CardDescription>
          <div className="flex gap-2 pt-2">
            <Button size="sm" variant="outline" onClick={selectAll}>
              <CheckSquare className="h-4 w-4 mr-1" />
              All
            </Button>
            <Button size="sm" variant="outline" onClick={clearSelection}>
              <Square className="h-4 w-4 mr-1" />
              None
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          <ScrollArea className="h-full">
            {statesWithElements.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Layers className="mx-auto h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No states with positioned elements</p>
                <p className="text-xs mt-1">
                  Add fixed positions to StateImages
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {statesWithElements.map((state) => {
                  const isSelected = selectedStateIds.includes(state.id);
                  const isHighlighted = highlightedStateId === state.id;
                  const imageCount =
                    state.stateImages?.filter((img) =>
                      img.patterns?.some((p) => p.fixed)
                    ).length ?? 0;
                  const regionCount = state.regions?.length ?? 0;
                  const locationCount = state.locations?.length ?? 0;

                  return (
                    <div
                      key={state.id}
                      className={`
                        flex items-center gap-3 p-3 rounded-lg border cursor-pointer
                        transition-colors
                        ${isSelected ? "bg-primary/10 border-primary" : "hover:bg-muted/50"}
                        ${isHighlighted ? "ring-2 ring-primary" : ""}
                      `}
                      onClick={() => toggleState(state.id)}
                      onMouseEnter={() =>
                        isSelected && setHighlightedStateId(state.id)
                      }
                      onMouseLeave={() => setHighlightedStateId(undefined)}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleState(state.id)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{state.name}</div>
                        <div className="text-xs text-muted-foreground flex gap-2">
                          {imageCount > 0 && <span>{imageCount} img</span>}
                          {regionCount > 0 && <span>{regionCount} rgn</span>}
                          {locationCount > 0 && (
                            <span>{locationCount} loc</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 w-8 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isSelected) {
                            setHighlightedStateId(
                              highlightedStateId === state.id
                                ? undefined
                                : state.id
                            );
                          }
                        }}
                        disabled={!isSelected}
                      >
                        {isHighlighted ? (
                          <Eye className="h-4 w-4" />
                        ) : (
                          <EyeOff className="h-4 w-4 opacity-50" />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Right Panel - Canvas */}
      <Card className="lg:col-span-3 flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Canvas View</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{selectedStates.length} selected</Badge>
              <Badge variant={isRunnerConnected ? "default" : "secondary"}>
                {monitors.length} monitor
                {monitors.length !== 1 ? "s" : ""}
              </Badge>
            </div>
          </CardTitle>
          <CardDescription>
            {canvasInfo.source === "monitors"
              ? `${canvasInfo.width}x${canvasInfo.height} canvas from connected monitors`
              : "Canvas auto-sized to fit state elements"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          <ActiveStatesCanvas
            states={selectedStates}
            images={images}
            monitors={monitors}
            mode="config"
            highlightStateId={highlightedStateId}
            className="h-full"
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Transition Visualization Tab Content
 */
function TransitionVisualizationTab() {
  const { states, images, transitions, workflows } = useAutomation();
  const { monitors, isRunnerConnected } = useRunnerMonitors();

  const [selectedTransition, setSelectedTransition] =
    useState<Transition | null>(null);

  // Use animation hook directly so state updates trigger re-renders
  const animation = useTransitionAnimation();

  // Load transition when selection changes
  useEffect(() => {
    if (selectedTransition) {
      animation.loadTransition(selectedTransition, states, workflows, monitors);
    } else {
      animation.cancel();
    }
  }, [selectedTransition?.id, monitors]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 h-full">
      {/* Left Panel - Transition Selection */}
      <Card className="lg:col-span-1 flex flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Transitions</span>
            <Badge variant="outline">{transitions.length}</Badge>
          </CardTitle>
          <CardDescription>Select a transition to visualize</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0">
          <TransitionList
            transitions={transitions}
            states={states}
            workflows={workflows}
            selectedTransition={selectedTransition}
            onTransitionSelect={setSelectedTransition}
          />
        </CardContent>
      </Card>

      {/* Right Panel - Animation Canvas */}
      <Card className="lg:col-span-3 h-full flex flex-col">
        <CardHeader className="pb-3 flex-shrink-0">
          <CardTitle className="flex items-center justify-between">
            <span>Transition Animation</span>
            <div className="flex items-center gap-2">
              {selectedTransition && (
                <Badge variant="outline">
                  {selectedTransition.workflows.length} workflow
                  {selectedTransition.workflows.length !== 1 ? "s" : ""}
                </Badge>
              )}
              <Badge variant={isRunnerConnected ? "default" : "secondary"}>
                {monitors.length} monitor
                {monitors.length !== 1 ? "s" : ""}
              </Badge>
            </div>
          </CardTitle>
          <CardDescription>
            {selectedTransition
              ? "Click Play to animate the transition"
              : "Select a transition from the list"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 flex flex-col p-4">
          {/* Canvas - takes available space minus controls */}
          <div className="flex-1 min-h-0 overflow-hidden rounded-lg">
            <TransitionAnimationCanvas
              transition={selectedTransition}
              states={states}
              workflows={workflows}
              images={images}
              monitors={monitors}
              className="h-full w-full"
              animation={animation}
            />
          </div>

          {/* Playback Controls - fixed height at bottom */}
          {selectedTransition && (
            <div className="mt-4 flex-shrink-0">
              <TransitionPlaybackControls
                state={animation.state}
                onPlay={() => animation.play()}
                onPause={() => animation.pause()}
                onStepForward={() => animation.stepForward()}
                onStepBackward={() => animation.stepBackward()}
                onReset={() => animation.reset()}
                onSpeedChange={(speed) => animation.setSpeed(speed)}
                onSeek={(index) => animation.seekTo(index)}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Content wrapper that loads project data from backend based on URL
 */
function StatesPageContent() {
  const { isLoading } = useProjectLoader();
  const [activeTab, setActiveTab] = useState<
    "definition" | "state-view" | "transitions"
  >("definition");

  if (isLoading) {
    return <LoadingFallback />;
  }

  return (
    <div className="h-full flex flex-col">
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as typeof activeTab)}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="px-4 pt-4 pb-2">
          <TabsList>
            <TabsTrigger value="definition" className="gap-2">
              <Network className="h-4 w-4" />
              Definition
            </TabsTrigger>
            <TabsTrigger value="state-view" className="gap-2">
              <Eye className="h-4 w-4" />
              State View
            </TabsTrigger>
            <TabsTrigger value="transitions" className="gap-2">
              <ArrowRight className="h-4 w-4" />
              Transitions
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Definition Tab - State Machine Editor */}
        <TabsContent value="definition" className="flex-1 min-h-0 mt-0">
          <StateStructure />
        </TabsContent>

        {/* State View Tab - Spatial Visualization */}
        <TabsContent value="state-view" className="flex-1 min-h-0 mt-0 p-4">
          <StateVisualizationTab />
        </TabsContent>

        {/* Transitions Tab - Transition Animation */}
        <TabsContent value="transitions" className="flex-1 min-h-0 mt-0 p-4">
          <TransitionVisualizationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function StatesPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RequireProject pageName="State Machine">
        <StatesPageContent />
      </RequireProject>
    </Suspense>
  );
}
