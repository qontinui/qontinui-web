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
import { useRouter } from "next/navigation";
import { StateStructure } from "@/components/state-machine";
import { RequireProject } from "@/components/require-project";
import { useProjectLoader } from "@/hooks/use-project-loader";
import { useAutomation } from "@/contexts/automation-context";
import { useAutomationStore } from "@/stores/automation";
import { useCreateProject } from "@/hooks/use-projects";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import { useRealtimeConnections } from "@/hooks/useRealtimeConnections";
import { useUIBridgeExploration } from "@/hooks/useUIBridgeExploration";
import { ActiveStatesCanvas } from "@/components/workflow-viz/ActiveStatesCanvas";
import { TransitionAnimationCanvas } from "@/components/workflow-viz/TransitionAnimationCanvas";
import { TransitionPlaybackControls } from "@/components/workflow-viz/TransitionPlaybackControls";
import { TransitionList } from "@/components/workflow-viz/TransitionList";
import { useTransitionAnimation } from "@/components/workflow-viz/TransitionAnimationController";
import { ExplorationConfigPanel } from "@/components/ui-bridge/ExplorationConfigPanel";
import { UIBridgeResultsView } from "@/components/web-extraction/UIBridgeResultsView";
import { ExtractionSaveOptionsDialog, type SaveOption } from "@/components/state-discovery/ExtractionSaveOptionsDialog";
import type { Transition, State } from "@/contexts/automation-context/types";
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
import { Label } from "@/components/ui/label";
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
  Save,
  Info,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
 * State Discovery Tab Content
 *
 * Allows users to automatically explore target applications and discover states
 * using the UI Bridge exploration hook.
 */
function StateDiscoveryTab() {
  const { states, addState, projectName, setProjectId } = useAutomation();
  const { projectId: _projectId } = useProjectLoader();
  const router = useRouter();

  // Store access for setStates (replace option)
  const setStates = useAutomationStore((s) => s.setStates);

  // Project creation for "new project" option
  const createProject = useCreateProject();

  // Runner connections for exploration
  const { connections, isLoading: connectionsLoading } = useRealtimeConnections();
  const [selectedConnectionId, setSelectedConnectionId] = useState<number | null>(null);

  // Auto-select first runner when connections load and no selection made
  useEffect(() => {
    if (selectedConnectionId === null && connections.length > 0 && !connectionsLoading) {
      const firstConnection = connections[0];
      if (firstConnection) {
        setSelectedConnectionId(firstConnection.id);
      }
    }
  }, [connections, connectionsLoading, selectedConnectionId]);

  // Exploration hook
  const exploration = useUIBridgeExploration();

  // State for discovered states management
  const [selectedElements, setSelectedElements] = useState<Set<string>>(new Set());
  const [_newStateName, setNewStateName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Save options dialog state
  const [showSaveOptionsDialog, setShowSaveOptionsDialog] = useState(false);
  const [pendingStatesToSave, setPendingStatesToSave] = useState<State[]>([]);

  // Helper to construct runner URL from connection (used by multiple handlers)
  const getRunnerUrl = useCallback((connectionId: number | null): string | null => {
    if (connectionId === null) return null;

    const conn = connections.find(c => c.id === connectionId);
    if (!conn?.ip_address) return null;

    // Handle localhost variations
    // Use 127.0.0.1 to force IPv4 (runner only listens on IPv4)
    const ip = conn.ip_address;
    if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('localhost')) {
      return 'http://127.0.0.1:9876';
    }
    return `http://${ip}:9876`;
  }, [connections]);

  // Fetch browser tabs when extension target type is selected and runner is connected
  const handleRefreshBrowserTabs = useCallback(() => {
    const runnerUrl = getRunnerUrl(selectedConnectionId);
    if (!runnerUrl) {
      toast.error("Please select a runner connection first");
      return;
    }
    if (exploration.config.targetType !== "extension") {
      return;
    }
    console.log("[States] Fetching browser tabs from:", runnerUrl);
    exploration.fetchBrowserTabs(runnerUrl);
  }, [exploration, getRunnerUrl, selectedConnectionId]);

  // Auto-fetch browser tabs when extension mode is selected
  useEffect(() => {
    if (exploration.config.targetType === "extension" && selectedConnectionId !== null) {
      handleRefreshBrowserTabs();
    }
  }, [exploration.config.targetType, selectedConnectionId, handleRefreshBrowserTabs]);

  // Handle selecting a browser tab for exploration
  const handleSelectBrowserTab = useCallback(async (tabId: number | null) => {
    console.log("[States] handleSelectBrowserTab called with:", tabId);
    const runnerUrl = getRunnerUrl(selectedConnectionId);
    console.log("[States] Runner URL:", runnerUrl);
    if (runnerUrl) {
      const result = await exploration.selectBrowserTab(runnerUrl, tabId);
      console.log("[States] selectBrowserTab result:", result);
    } else {
      console.warn("[States] No runner URL available");
    }
  }, [exploration, getRunnerUrl, selectedConnectionId]);

  // Handle starting exploration using UI Bridge
  const handleStartExploration = useCallback(async () => {
    const runnerUrl = getRunnerUrl(selectedConnectionId);
    if (!runnerUrl) {
      toast.error("Please select a connected runner");
      return;
    }

    // Clear UI state for new exploration
    setSelectedElements(new Set());
    setNewStateName("");

    try {
      await exploration.startUIBridgeExploration(runnerUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Exploration failed");
    }
  }, [exploration, getRunnerUrl, selectedConnectionId]);

  // Handle stopping exploration
  const handleStopExploration = useCallback(() => {
    const runnerUrl = getRunnerUrl(selectedConnectionId);
    exploration.stopExploration(runnerUrl || undefined);
  }, [exploration, getRunnerUrl, selectedConnectionId]);

  // Toggle element selection
  const toggleElementSelection = useCallback((elementId: string) => {
    setSelectedElements(prev => {
      const newSet = new Set(prev);
      if (newSet.has(elementId)) {
        newSet.delete(elementId);
      } else {
        newSet.add(elementId);
      }
      return newSet;
    });
  }, []);

  // Select all discovered states
  const selectAllElements = useCallback(() => {
    const discoveredStates = exploration.uiBridgeResults?.state_discovery?.states || [];
    const allIds = discoveredStates.map(s => s.id);
    setSelectedElements(new Set(allIds));
  }, [exploration.uiBridgeResults]);

  // Clear selection
  const clearElementSelection = useCallback(() => {
    setSelectedElements(new Set());
  }, []);

  // Build states from selected discovered elements
  const buildStatesFromSelection = useCallback((): State[] => {
    const discoveredStates = exploration.uiBridgeResults?.state_discovery?.states || [];
    const discoveredElements = exploration.uiBridgeResults?.state_discovery?.elements || [];
    const newStates: State[] = [];
    let importedCount = 0;

    for (const discoveredState of discoveredStates) {
      if (!selectedElements.has(discoveredState.id)) continue;

      // Get elements for this state
      const stateElements = discoveredElements.filter(e =>
        discoveredState.state_image_ids.includes(e.id)
      );

      // Create a new state from the discovered state
      const newState: State = {
        id: `state-${Date.now()}-${importedCount}`,
        name: discoveredState.name,
        description: `Discovered from ${exploration.config.targetUrl} (${(discoveredState.confidence * 100).toFixed(0)}% confidence)`,
        stateImages: stateElements.map((element, idx) => ({
          id: `${discoveredState.name.toLowerCase().replace(/\s+/g, '-')}-img-${idx}`,
          name: element.name || element.text_content || `Element ${idx + 1}`,
          patterns: [{
            id: `pattern-${idx}`,
            name: element.name || element.text_content || `Pattern ${idx + 1}`,
            searchRegions: [],
            fixed: false,
          }],
          shared: false,
          searchRegions: [],
        })),
        regions: [],
        locations: [],
        strings: [],
        position: { x: 100 + importedCount * 50, y: 100 + importedCount * 50 },
        initial: importedCount === 0,
        isFinal: false,
      };

      newStates.push(newState);
      importedCount++;
    }

    return newStates;
  }, [selectedElements, exploration.uiBridgeResults, exploration.config.targetUrl]);

  // Import selected discovered states - checks for existing states and shows dialog if needed
  const saveAsState = useCallback(async () => {
    if (selectedElements.size === 0) {
      toast.error("Please select states to import");
      return;
    }

    const newStates = buildStatesFromSelection();
    if (newStates.length === 0) {
      toast.error("No valid states to import");
      return;
    }

    // If there are existing states, show the options dialog
    if (states.length > 0) {
      setPendingStatesToSave(newStates);
      setShowSaveOptionsDialog(true);
      return;
    }

    // No existing states - just add directly
    setIsSaving(true);
    try {
      for (const newState of newStates) {
        addState(newState);
      }
      toast.success(`Imported ${newStates.length} state${newStates.length > 1 ? 's' : ''}`);
      setSelectedElements(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import states");
    } finally {
      setIsSaving(false);
    }
  }, [selectedElements, states.length, buildStatesFromSelection, addState]);

  // Handle save option selection from dialog
  const handleSaveOptionConfirm = useCallback(async (option: SaveOption, newProjectName?: string) => {
    setIsSaving(true);
    setShowSaveOptionsDialog(false);

    try {
      switch (option) {
        case "merge": {
          // Add states, skipping duplicates
          let importedCount = 0;
          let skippedCount = 0;
          for (const newState of pendingStatesToSave) {
            if (states.some(s => s.name.toLowerCase() === newState.name.toLowerCase())) {
              skippedCount++;
              continue;
            }
            // Adjust position based on existing states
            const adjustedState = {
              ...newState,
              position: {
                x: 100 + (states.length + importedCount) * 50,
                y: 100 + (states.length + importedCount) * 50,
              },
              initial: false, // Existing project already has initial state
            };
            addState(adjustedState);
            importedCount++;
          }
          if (skippedCount > 0) {
            toast.warning(`Skipped ${skippedCount} duplicate state${skippedCount > 1 ? 's' : ''}`);
          }
          if (importedCount > 0) {
            toast.success(`Merged ${importedCount} state${importedCount > 1 ? 's' : ''}`);
          }
          break;
        }

        case "replace": {
          // Clear all existing states and add new ones
          setStates([]);
          for (const newState of pendingStatesToSave) {
            addState(newState);
          }
          toast.success(`Replaced with ${pendingStatesToSave.length} state${pendingStatesToSave.length > 1 ? 's' : ''}`);
          break;
        }

        case "new_project": {
          if (!newProjectName?.trim()) {
            toast.error("Project name is required");
            return;
          }

          // Create new project via API
          const result = await createProject.mutateAsync({
            name: newProjectName.trim(),
            description: `Extracted from ${exploration.config.targetUrl}`,
            configuration: {
              states: pendingStatesToSave,
              workflows: [],
              transitions: [],
              images: [],
              categories: [{ name: "Main", automationEnabled: true }],
            },
          });

          // Switch to the new project
          setProjectId(result.id);
          toast.success(`Created new project "${newProjectName}"`);

          // Navigate to the new project
          router.push(`/automation-builder/states?project=${result.id}`);
          break;
        }
      }

      // Reset selection
      setSelectedElements(new Set());
      setPendingStatesToSave([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save states");
    } finally {
      setIsSaving(false);
    }
  }, [pendingStatesToSave, states, addState, setStates, createProject, exploration.config.targetUrl, setProjectId, router]);

  // Get discovered elements from UI Bridge state discovery
  const discoveredElements = exploration.uiBridgeResults?.state_discovery?.elements || [];

  // Get discovered states from UI Bridge state discovery
  const discoveredStates = exploration.uiBridgeResults?.state_discovery?.states || [];

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
      {/* Left Panel - Exploration Configuration */}
      <Card className="lg:col-span-1 flex flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Compass className="h-5 w-5 text-brand-primary" />
            Explore Application
          </CardTitle>
          <CardDescription>
            Automatically discover interactive elements from a target application
          </CardDescription>
          {/* UI Bridge info banner */}
          <Alert className="mt-3 border-blue-500/30 bg-blue-500/5">
            <Info className="h-4 w-4 text-blue-500" />
            <AlertDescription className="text-xs text-blue-300">
              This uses <strong>UI Bridge</strong> to explore apps with the SDK installed.
              For general websites without SDK, use Playwright extraction in the Web Extraction tab.
            </AlertDescription>
          </Alert>
        </CardHeader>
        <CardContent className="flex-1 overflow-auto">
          <ExplorationConfigPanel
            config={exploration.config}
            onConfigChange={exploration.updateConfig}
            progress={exploration.progress}
            isRunning={exploration.isRunning}
            connections={connections}
            connectionsLoading={connectionsLoading}
            selectedConnectionId={selectedConnectionId}
            onConnectionChange={setSelectedConnectionId}
            onStart={handleStartExploration}
            onStop={handleStopExploration}
            browserTabs={exploration.browserTabs}
            browserTabsLoading={exploration.browserTabsLoading}
            browserTabsError={exploration.browserTabsError}
            onRefreshBrowserTabs={handleRefreshBrowserTabs}
            onSelectBrowserTab={handleSelectBrowserTab}
          />
        </CardContent>
      </Card>

      {/* Right Panel - Discovery Results */}
      <Card className="lg:col-span-2 flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <span>Discovery Results</span>
            <div className="flex items-center gap-2">
              {exploration.progress.status !== "idle" && (
                <Badge
                  variant="outline"
                  className={
                    exploration.progress.status === "running"
                      ? "border-brand-primary text-brand-primary animate-pulse"
                      : exploration.progress.status === "completed"
                        ? "border-brand-success text-brand-success"
                        : exploration.progress.status === "failed"
                          ? "border-red-500 text-red-500"
                          : "border-yellow-500 text-yellow-500"
                  }
                >
                  {exploration.progress.status.toUpperCase()}
                </Badge>
              )}
            </div>
          </CardTitle>
        </CardHeader>

        <CardContent className="flex-1 min-h-0 flex flex-col gap-4">
          {/* Empty state */}
          {exploration.progress.status === "idle" && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-text-muted">
                <Compass className="mx-auto h-16 w-16 mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">No Elements Discovered</h3>
                <p className="text-sm max-w-md">
                  Select a connected runner, enter a target URL, and click
                  &quot;Start Exploration&quot; to automatically discover
                  interactive elements from the application.
                </p>
              </div>
            </div>
          )}

          {/* Results display using UIBridgeResultsView component */}
          {exploration.progress.status !== "idle" && (
            <Tabs defaultValue="results" className="flex-1 flex flex-col min-h-0">
              <TabsList className="mb-4">
                <TabsTrigger value="results">Results</TabsTrigger>
                <TabsTrigger value="create-state" disabled={exploration.progress.status !== "completed" || discoveredStates.length === 0}>
                  Create State
                </TabsTrigger>
              </TabsList>

              <TabsContent value="results" className="flex-1 min-h-0 overflow-auto">
                <UIBridgeResultsView
                  job={exploration.uiBridgeJob}
                  results={exploration.uiBridgeResults}
                />
              </TabsContent>

              <TabsContent value="create-state" className="flex-1 min-h-0 flex flex-col gap-4">
                {/* Import discovered states controls */}
                <Card className="p-4 bg-surface-raised/60 border-brand-success/30">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle2 className="h-4 w-4 text-brand-success" />
                    <Label className="text-brand-success font-mono text-sm uppercase tracking-wider">
                      Import Discovered States
                    </Label>
                  </div>

                  <div className="flex items-center gap-3">
                    <Button
                      onClick={saveAsState}
                      disabled={isSaving || selectedElements.size === 0}
                      className="bg-brand-success hover:bg-brand-success/80"
                    >
                      {isSaving ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Import Selected ({selectedElements.size})
                    </Button>
                  </div>

                  <div className="flex gap-2 mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={selectAllElements}
                      disabled={isSaving}
                    >
                      <CheckSquare className="h-4 w-4 mr-1" />
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearElementSelection}
                      disabled={isSaving}
                    >
                      <Square className="h-4 w-4 mr-1" />
                      Clear
                    </Button>
                  </div>
                </Card>

                {/* Discovered States List for selection */}
                <div className="flex-1 min-h-0">
                  <Label className="text-text-muted text-xs mb-2 block">
                    Select states to import ({discoveredStates.length} discovered)
                  </Label>
                  <ScrollArea className="h-full border rounded-lg">
                    <div className="space-y-1 p-2">
                      {discoveredStates.map((discoveredState) => {
                        const stateElements = discoveredElements.filter(e =>
                          discoveredState.state_image_ids.includes(e.id)
                        );
                        return (
                          <div
                            key={discoveredState.id}
                            className={`
                              flex items-center gap-3 p-3 rounded-lg border cursor-pointer
                              transition-colors
                              ${selectedElements.has(discoveredState.id)
                                ? "bg-brand-primary/10 border-brand-primary"
                                : "hover:bg-muted/50 border-transparent"
                              }
                            `}
                            onClick={() => toggleElementSelection(discoveredState.id)}
                          >
                            <Checkbox
                              checked={selectedElements.has(discoveredState.id)}
                              onCheckedChange={() => toggleElementSelection(discoveredState.id)}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-sm truncate">
                                {discoveredState.name}
                              </div>
                              <div className="flex items-center gap-2 text-xs text-text-muted">
                                <Badge variant="outline" className="text-[10px]">
                                  {stateElements.length} elements
                                </Badge>
                                <span className="truncate">
                                  {(discoveredState.confidence * 100).toFixed(0)}% confidence
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>

      {/* Save Options Dialog */}
      <ExtractionSaveOptionsDialog
        open={showSaveOptionsDialog}
        onClose={() => {
          setShowSaveOptionsDialog(false);
          setPendingStatesToSave([]);
        }}
        onConfirm={handleSaveOptionConfirm}
        existingStateCount={states.length}
        newStateCount={pendingStatesToSave.length}
        currentProjectName={projectName}
        isLoading={isSaving}
      />
    </div>
  );
}

/**
 * Content wrapper that loads project data from backend based on URL
 */
function StatesPageContent() {
  const { isLoading } = useProjectLoader();
  const [activeTab, setActiveTab] = useState<
    "definition" | "state-view" | "transitions" | "discovery"
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
            <TabsTrigger value="discovery" className="gap-2">
              <Compass className="h-4 w-4" />
              Discovery
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

        {/* Discovery Tab - State Discovery via Exploration */}
        <TabsContent value="discovery" className="flex-1 min-h-0 mt-0 p-4">
          <StateDiscoveryTab />
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
