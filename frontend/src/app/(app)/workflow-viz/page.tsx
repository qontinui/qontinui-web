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

import { useEffect, useState, Suspense, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { useAutomation } from "@/contexts/automation-context";
import {
  workflowRepository,
  stateRepository,
  transitionRepository,
  imageRepository,
} from "@/lib/repositories";
import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  State,
  Transition,
  ImageAsset,
} from "@/contexts/automation-context/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  LayoutDashboard,
  Shield,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  RotateCcw,
  Layers,
  Activity,
  Loader2,
  Radio,
  WifiOff,
  Eye,
  History,
} from "lucide-react";
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Test run summary for selector */
interface TestRunSummary {
  id: string;
  run_name: string;
  status: string;
  started_at: string;
  ended_at?: string;
  workflow_name?: string;
}

/** Historical result from a test run */
interface HistoricalResult {
  id: number;
  sequence_number: number | null;
  pattern_id: string | null;
  pattern_name: string | null;
  action_type: string;
  active_states: string[] | null;
  success: boolean;
  match_x: number | null;
  match_y: number | null;
  match_width: number | null;
  match_height: number | null;
}
import { toast } from "sonner";
import { WorkflowStructurePanel } from "@/components/workflow-viz/WorkflowStructurePanel";
import { ActiveStatesCanvas } from "@/components/workflow-viz/ActiveStatesCanvas";
import { RequireProject } from "@/components/require-project";
import { useExecutionEvents } from "@/hooks/useExecutionEvents";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";

export default function WorkflowVisualizationPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Data
  const [workflows, setWorkflows] = useState<
    (Workflow & { projectName?: string })[]
  >([]);
  const [states, setStates] = useState<State[]>([]);
  const [images, setImages] = useState<ImageAsset[]>([]);
  const [, setTransitions] = useState<Transition[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null
  );
  const [projects, setProjects] = useState<string[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  // Playback state
  const [currentActionIndex, setCurrentActionIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1000); // ms per step
  const [activeStateIds, setActiveStateIds] = useState<string[]>([]);
  const [assumeSuccess, setAssumeSuccess] = useState<boolean>(true);

  // Live mode state
  const [isLiveMode, setIsLiveMode] = useState(false);

  // Canvas mode: "perception" shows only found images, "config" shows all configured positions
  const [canvasMode, setCanvasMode] = useState<"perception" | "config">(
    "perception"
  );

  // Historical playback state
  const [testRuns, setTestRuns] = useState<TestRunSummary[]>([]);
  const [selectedTestRunId, setSelectedTestRunId] = useState<string | null>(
    null
  );
  const [historicalResults, setHistoricalResults] = useState<
    HistoricalResult[]
  >([]);
  const [loadingTestRuns, setLoadingTestRuns] = useState(false);
  const [loadingHistoricalData, setLoadingHistoricalData] = useState(false);

  // Get current project ID from automation context
  const { projectId } = useAutomation();

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

  // Get monitors from runner for proper canvas sizing
  const { monitors } = useRunnerMonitors();

  // Convert Set to array for display
  const liveActiveStateIdsArray = useMemo(
    () => Array.from(liveActiveStateIds),
    [liveActiveStateIds]
  );

  // Auth protection
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  // Load data from IndexedDB
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const [loadedWorkflows, loadedStates, loadedTransitions, loadedImages] =
          await Promise.all([
            workflowRepository.getAll(),
            stateRepository.getAll(),
            transitionRepository.getAll(),
            imageRepository.getAll(),
          ]);

        setWorkflows(
          loadedWorkflows as Array<Workflow & { projectName?: string }>
        );
        setStates(loadedStates);
        setTransitions(loadedTransitions);
        setImages(loadedImages);

        // Extract unique project names from workflows, states, and images
        const projectNames = Array.from(
          new Set([
            ...loadedWorkflows
              .map((w: unknown) => (w as { projectName?: string }).projectName)
              .filter(Boolean),
            ...loadedStates.map((s) => s.projectName).filter(Boolean),
            ...loadedImages
              .map((img) => (img as { projectName?: string }).projectName)
              .filter(Boolean),
          ])
        ) as string[];
        setProjects(projectNames);

        // Auto-select first workflow
        if (loadedWorkflows.length > 0 && !selectedWorkflowId) {
          setSelectedWorkflowId(loadedWorkflows[0]?.id || null);
        }

        toast.success(`Loaded ${loadedWorkflows.length} workflow(s)`);
      } catch (error) {
        console.error("Error loading data:", error);
        toast.error("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    if (user) {
      loadData();
    }
  }, [user]);

  // Fetch test runs when project changes
  const fetchTestRuns = useCallback(async () => {
    if (!projectId) {
      setTestRuns([]);
      return;
    }

    setLoadingTestRuns(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/v1/testing/runs?project_id=${projectId}&limit=50&sort_order=desc`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch test runs");
      const data = (await res.json()) as {
        runs: TestRunSummary[];
        total: number;
      };
      setTestRuns(data.runs || []);
    } catch (error) {
      console.error("Failed to fetch test runs:", error);
      setTestRuns([]);
    } finally {
      setLoadingTestRuns(false);
    }
  }, [projectId]);

  // Fetch test runs when project changes
  useEffect(() => {
    if (canvasMode === "perception" && !isLiveMode) {
      fetchTestRuns();
    }
  }, [projectId, canvasMode, isLiveMode, fetchTestRuns]);

  // Fetch historical results when test run is selected
  useEffect(() => {
    const fetchHistoricalResults = async () => {
      if (!selectedTestRunId) {
        setHistoricalResults([]);
        return;
      }

      setLoadingHistoricalData(true);
      try {
        const res = await fetch(
          `${API_BASE_URL}/api/v1/historical/test-run/${selectedTestRunId}`,
          { credentials: "include" }
        );
        if (!res.ok) throw new Error("Failed to fetch historical results");
        const data = (await res.json()) as {
          test_run_id: string;
          total_results: number;
          results: HistoricalResult[];
        };
        setHistoricalResults(data.results || []);
        if (data.results?.length > 0) {
          toast.success(`Loaded ${data.results.length} recognition results`);
        }
      } catch (error) {
        console.error("Failed to fetch historical results:", error);
        setHistoricalResults([]);
        toast.error("Failed to load historical data");
      } finally {
        setLoadingHistoricalData(false);
      }
    };

    fetchHistoricalResults();
  }, [selectedTestRunId]);

  // Convert historical results to found images format for canvas
  const historicalFoundImages = useMemo(() => {
    if (historicalResults.length === 0) return new Map();

    const foundMap = new Map<
      string,
      {
        x: number;
        y: number;
        width: number;
        height: number;
        confidence: number;
        found: boolean;
      }
    >();

    for (const result of historicalResults) {
      if (
        result.pattern_id &&
        result.match_x != null &&
        result.match_y != null
      ) {
        foundMap.set(result.pattern_id, {
          x: result.match_x,
          y: result.match_y,
          width: result.match_width || 0,
          height: result.match_height || 0,
          confidence: 1.0,
          found: result.success,
        });
      }
    }

    return foundMap;
  }, [historicalResults]);

  // Get active states from historical results
  const historicalActiveStateIds = useMemo(() => {
    const stateIds = new Set<string>();
    for (const result of historicalResults) {
      if (result.active_states) {
        for (const state of result.active_states) {
          stateIds.add(state);
        }
      }
    }
    return stateIds;
  }, [historicalResults]);

  // Filter workflows by project
  const filteredWorkflows =
    selectedProject === "all"
      ? workflows
      : workflows.filter((w) => w.projectName === selectedProject);

  const selectedWorkflow = filteredWorkflows.find(
    (w) => w.id === selectedWorkflowId
  );

  // Initialize active states when workflow is selected
  useEffect(() => {
    if (selectedWorkflow) {
      // Set initial states from workflow or fall back to states with initial=true
      let initialStateIds = selectedWorkflow.initialStateIds || [];

      // If no initialStateIds on workflow, find states marked as initial
      if (initialStateIds.length === 0) {
        initialStateIds = states
          .filter((s) => s.initial === true)
          .map((s) => s.id);
      }

      setActiveStateIds(initialStateIds);
      setCurrentActionIndex(0);
      setIsPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWorkflowId, states]);

  // Playback control
  useEffect(() => {
    if (!isPlaying || !selectedWorkflow) return;

    const timer = setTimeout(() => {
      handleStepForward();
    }, playbackSpeed);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentActionIndex, playbackSpeed, selectedWorkflow]);

  // Step forward through workflow
  const handleStepForward = () => {
    if (!selectedWorkflow) return;

    const nextIndex = currentActionIndex + 1;
    if (nextIndex >= selectedWorkflow.actions.length) {
      setIsPlaying(false);
      toast.info("Reached end of workflow");
      return;
    }

    setCurrentActionIndex(nextIndex);
    updateActiveStates(nextIndex, assumeSuccess);
  };

  // Step backward through workflow
  const handleStepBack = () => {
    if (currentActionIndex > 0) {
      const prevIndex = currentActionIndex - 1;
      setCurrentActionIndex(prevIndex);
      updateActiveStates(prevIndex, assumeSuccess);
    }
  };

  // Reset to beginning
  const handleReset = () => {
    setCurrentActionIndex(0);
    setIsPlaying(false);
    if (selectedWorkflow) {
      // Use workflow's initialStateIds or fall back to states with initial=true
      let initialStateIds = selectedWorkflow.initialStateIds || [];
      if (initialStateIds.length === 0) {
        initialStateIds = states
          .filter((s) => s.initial === true)
          .map((s) => s.id);
      }
      setActiveStateIds(initialStateIds);
    }
  };

  // Toggle play/pause
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  // Update active states based on action execution
  const updateActiveStates = (actionIndex: number, _success?: boolean) => {
    if (!selectedWorkflow) return;

    const action = selectedWorkflow.actions[actionIndex];
    if (!action) return;

    // Find transitions that reference this action
    // This is a simplified version - in reality, we'd need to track which
    // actions trigger which transitions based on the workflow structure

    // For STATE_ACTIVATOR actions, activate the specified state
    if ((action.type as string) === "STATE_ACTIVATOR" && action.config) {
      const config = action.config as Record<string, unknown>;
      const stateIds = (config.stateIds as string[]) || [];
      setActiveStateIds((prev) => {
        const newIds = [...prev];
        stateIds.forEach((id: string) => {
          if (!newIds.includes(id)) {
            newIds.push(id);
          }
        });
        return newIds;
      });
    }

    // For other actions, we could analyze transitions to determine state changes
    // This would require more complex logic based on your transition structure
  };

  // Manual action selection
  const handleActionSelect = (actionIndex: number, success: boolean) => {
    setCurrentActionIndex(actionIndex);
    setAssumeSuccess(success);
    updateActiveStates(actionIndex, success);
  };

  // Don't render until auth is confirmed
  if (!user) {
    return null;
  }

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
        </div>
      }
    >
      <RequireProject pageName="Workflow Visualization">
        <div className="container mx-auto py-8 h-screen flex flex-col">
          {/* Navigation Links */}
          <div className="mb-6 flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => router.push("/dashboard")}
              className="hover:bg-primary/10"
            >
              <LayoutDashboard className="mr-2 h-4 w-4" />
              Dashboard
            </Button>
            {user.is_superuser && (
              <Button
                variant="ghost"
                onClick={() => router.push("/admin")}
                className="hover:bg-secondary/10"
              >
                <Shield className="mr-2 h-4 w-4" />
                Admin
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() => router.push("/states")}
              className="hover:bg-secondary/10"
            >
              <Layers className="mr-2 h-4 w-4" />
              States
            </Button>
          </div>

          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
                  <Activity className="h-8 w-8" />
                  Workflow Visualization
                </h1>
                <p className="text-muted-foreground">
                  Visualize workflow execution with dynamic state changes
                </p>
              </div>

              {/* Workflow Selection */}
              <div className="flex gap-4 items-end">
                {projects.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Project</label>
                    <Select
                      value={selectedProject}
                      onValueChange={setSelectedProject}
                    >
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select project" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Projects</SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project} value={project}>
                            {project}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-sm font-medium">Workflow</label>
                  <Select
                    value={selectedWorkflowId || ""}
                    onValueChange={setSelectedWorkflowId}
                  >
                    <SelectTrigger className="w-[300px]">
                      <SelectValue placeholder="Select workflow" />
                    </SelectTrigger>
                    <SelectContent>
                      {filteredWorkflows.map((workflow) => (
                        <SelectItem key={workflow.id} value={workflow.id}>
                          {workflow.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content */}
          {selectedWorkflow ? (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-6 min-h-0">
              {/* Left Panel - Workflow */}
              <Card className="lg:col-span-1 flex flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className="bg-muted px-2 py-0.5 rounded text-sm font-medium">
                        Workflow
                      </span>
                      {selectedWorkflow.name}
                    </span>
                    <Badge
                      variant={
                        selectedWorkflow.metadata?.viewMode === "graph"
                          ? "default"
                          : "secondary"
                      }
                    >
                      {selectedWorkflow.metadata?.viewMode || "graph"}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {selectedWorkflow.actions.length} action(s)
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 min-h-0">
                  <WorkflowStructurePanel
                    workflow={selectedWorkflow}
                    currentActionIndex={currentActionIndex}
                    onActionSelect={handleActionSelect}
                  />
                </CardContent>
              </Card>

              {/* Right Panel - Active States Canvas */}
              <Card className="lg:col-span-2 flex flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span>Active States</span>
                      {/* Live Mode Toggle */}
                      <div className="flex items-center gap-2">
                        <Switch
                          id="live-mode"
                          checked={isLiveMode}
                          onCheckedChange={(checked) => {
                            setIsLiveMode(checked);
                            if (checked) {
                              clearExecutionState();
                              setIsPlaying(false);
                            }
                          }}
                        />
                        <Label
                          htmlFor="live-mode"
                          className="text-sm font-normal cursor-pointer"
                        >
                          {isLiveMode ? (
                            <span className="flex items-center gap-1 text-green-600">
                              <Radio className="h-3 w-3 animate-pulse" />
                              Live
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              Playback
                            </span>
                          )}
                        </Label>
                      </div>
                      {/* Canvas Mode Toggle */}
                      <div className="flex items-center gap-2 ml-4 pl-4 border-l">
                        <Switch
                          id="canvas-mode"
                          checked={canvasMode === "config"}
                          onCheckedChange={(checked) => {
                            setCanvasMode(checked ? "config" : "perception");
                          }}
                        />
                        <Label
                          htmlFor="canvas-mode"
                          className="text-sm font-normal cursor-pointer"
                        >
                          {canvasMode === "perception" ? (
                            <span className="flex items-center gap-1 text-muted-foreground">
                              <Eye className="h-3 w-3" />
                              Perception
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-blue-600">
                              <Layers className="h-3 w-3" />
                              Config
                            </span>
                          )}
                        </Label>
                      </div>
                    </div>
                    <Badge variant="outline">
                      {isLiveMode
                        ? `${liveActiveStateIdsArray.length} active`
                        : `${activeStateIds.length} active`}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {canvasMode === "config" ? (
                      <span className="text-blue-600 flex items-center gap-1">
                        <Layers className="h-3 w-3" />
                        Showing configured positions
                      </span>
                    ) : isLiveMode ? (
                      isConnected ? (
                        <span className="text-green-600">
                          Connected - watching for execution events
                        </span>
                      ) : connectionState === "connecting" ||
                        connectionState === "reconnecting" ? (
                        <span className="text-yellow-600">
                          Connecting to runner...
                        </span>
                      ) : (
                        <span className="text-muted-foreground flex items-center gap-1">
                          <WifiOff className="h-3 w-3" />
                          Disconnected - start runner to enable live perception
                        </span>
                      )
                    ) : (
                      <div className="flex items-center gap-3">
                        <History className="h-3 w-3 text-purple-600" />
                        <span className="text-purple-600">
                          Historical Playback
                        </span>
                        {loadingTestRuns ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Select
                            value={selectedTestRunId || ""}
                            onValueChange={(value) =>
                              setSelectedTestRunId(value || null)
                            }
                          >
                            <SelectTrigger className="h-7 w-[250px] text-xs">
                              <SelectValue placeholder="Select a test run..." />
                            </SelectTrigger>
                            <SelectContent>
                              {testRuns.length === 0 ? (
                                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                                  No test runs available
                                </div>
                              ) : (
                                testRuns.map((run) => (
                                  <SelectItem key={run.id} value={run.id}>
                                    <span className="flex items-center gap-2">
                                      <Badge
                                        variant={
                                          run.status === "completed"
                                            ? "default"
                                            : run.status === "failed"
                                              ? "destructive"
                                              : "secondary"
                                        }
                                        className="text-[10px] px-1 py-0"
                                      >
                                        {run.status}
                                      </Badge>
                                      <span className="truncate">
                                        {new Date(
                                          run.started_at
                                        ).toLocaleDateString()}{" "}
                                        {run.workflow_name || run.run_name}
                                      </span>
                                    </span>
                                  </SelectItem>
                                ))
                              )}
                            </SelectContent>
                          </Select>
                        )}
                        {loadingHistoricalData && (
                          <Loader2 className="h-3 w-3 animate-spin text-purple-600" />
                        )}
                        {historicalResults.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {historicalResults.length} results
                          </Badge>
                        )}
                      </div>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 flex flex-col">
                  <ActiveStatesCanvas
                    states={states}
                    images={images}
                    monitors={monitors}
                    mode={canvasMode}
                    activeStateIds={
                      isLiveMode
                        ? liveActiveStateIds
                        : canvasMode === "perception" && selectedTestRunId
                          ? historicalActiveStateIds
                          : activeStateIds
                    }
                    foundImages={
                      isLiveMode
                        ? imageRecognitions
                        : canvasMode === "perception" && selectedTestRunId
                          ? historicalFoundImages
                          : undefined
                    }
                    connectionState={isLiveMode ? connectionState : undefined}
                  />
                </CardContent>
              </Card>
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

          {/* Playback Controls */}
          {selectedWorkflow && (
            <Card className="mt-6">
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  {/* Control Buttons */}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleReset}
                      title="Reset to Start"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleStepBack}
                      disabled={currentActionIndex === 0}
                      title="Step Back"
                    >
                      <SkipBack className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant={isPlaying ? "default" : "outline"}
                      onClick={handlePlayPause}
                      title={isPlaying ? "Pause" : "Play"}
                    >
                      {isPlaying ? (
                        <Pause className="h-4 w-4" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleStepForward}
                      disabled={
                        currentActionIndex >=
                        selectedWorkflow.actions.length - 1
                      }
                      title="Step Forward"
                    >
                      <SkipForward className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Progress Bar */}
                  <div className="flex-1">
                    <Slider
                      value={[currentActionIndex]}
                      max={selectedWorkflow.actions.length - 1}
                      step={1}
                      onValueChange={([value]) => {
                        setCurrentActionIndex(value ?? 0);
                        updateActiveStates(value ?? 0, assumeSuccess);
                      }}
                      className="w-full"
                    />
                  </div>

                  {/* Speed Control */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      Speed:
                    </span>
                    <Select
                      value={playbackSpeed.toString()}
                      onValueChange={(value) =>
                        setPlaybackSpeed(parseInt(value))
                      }
                    >
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="2000">0.5x</SelectItem>
                        <SelectItem value="1000">1x</SelectItem>
                        <SelectItem value="500">2x</SelectItem>
                        <SelectItem value="250">4x</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Assume Success Toggle */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Mode:</span>
                    <Badge
                      variant={assumeSuccess ? "default" : "destructive"}
                      className="cursor-pointer"
                      onClick={() => setAssumeSuccess(!assumeSuccess)}
                    >
                      {assumeSuccess ? "Success" : "Failure"}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </RequireProject>
    </Suspense>
  );
}
