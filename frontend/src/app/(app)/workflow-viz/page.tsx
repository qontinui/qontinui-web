"use client";

/**
 * Workflow Visualization Page
 *
 * Shows workflow execution with states appearing/disappearing as actions execute
 * Left panel: Workflow structure (graph or sequential)
 * Right panel: Active states canvas with bounds and layering
 */

import { useEffect, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { projectDB } from "@/lib/project-db";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { State, Transition } from "@/contexts/automation-context/types";
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
} from "lucide-react";
import { toast } from "sonner";
import { WorkflowStructurePanel } from "@/components/workflow-viz/WorkflowStructurePanel";
import { ActiveStatesCanvas } from "@/components/workflow-viz/ActiveStatesCanvas";
import { RequireProject } from "@/components/require-project";

export default function WorkflowVisualizationPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Data
  const [workflows, setWorkflows] = useState<
    (Workflow & { projectName?: string })[]
  >([]);
  const [states, setStates] = useState<State[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
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
        const [loadedWorkflows, loadedStates, loadedTransitions] =
          await Promise.all([
            projectDB.getAllWorkflows(),
            projectDB.getAllStates(),
            projectDB.getAllTransitions(),
          ]);

        setWorkflows(loadedWorkflows as any);
        setStates(loadedStates);
        setTransitions(loadedTransitions);

        // Extract unique project names
        const projectNames = Array.from(
          new Set([
            ...loadedWorkflows.map((w: any) => w.projectName).filter(Boolean),
            ...loadedStates.map((s) => s.projectName).filter(Boolean),
          ])
        ) as string[];
        setProjects(projectNames);

        // Auto-select first workflow
        if (loadedWorkflows.length > 0 && !selectedWorkflowId) {
          setSelectedWorkflowId(loadedWorkflows[0].id);
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
      // Set initial states from workflow
      const initialStateIds = selectedWorkflow.initialStateIds || [];
      setActiveStateIds(initialStateIds);
      setCurrentActionIndex(0);
      setIsPlaying(false);
    }
  }, [selectedWorkflowId]);

  // Playback control
  useEffect(() => {
    if (!isPlaying || !selectedWorkflow) return;

    const timer = setTimeout(() => {
      handleStepForward();
    }, playbackSpeed);

    return () => clearTimeout(timer);
  }, [isPlaying, currentActionIndex, playbackSpeed]);

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
      setActiveStateIds(selectedWorkflow.initialStateIds || []);
    }
  };

  // Toggle play/pause
  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  // Update active states based on action execution
  const updateActiveStates = (actionIndex: number, success: boolean) => {
    if (!selectedWorkflow) return;

    const action = selectedWorkflow.actions[actionIndex];
    if (!action) return;

    // Find transitions that reference this action
    // This is a simplified version - in reality, we'd need to track which
    // actions trigger which transitions based on the workflow structure

    // For STATE_ACTIVATOR actions, activate the specified state
    if (action.type === "STATE_ACTIVATOR" && action.config) {
      const config = action.config as any;
      const stateIds = config.stateIds || [];
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
              {/* Left Panel - Workflow Structure */}
              <Card className="lg:col-span-1 flex flex-col">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Workflow Structure</span>
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
                    <span>Active States</span>
                    <Badge variant="outline">
                      {activeStateIds.length} active
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    Action {currentActionIndex + 1} of{" "}
                    {selectedWorkflow.actions.length}
                    {selectedWorkflow.actions[currentActionIndex] && (
                      <>
                        {" "}
                        - {selectedWorkflow.actions[currentActionIndex].type}
                      </>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex-1 min-h-0 flex flex-col">
                  <ActiveStatesCanvas
                    states={states.filter((s) => activeStateIds.includes(s.id))}
                    highlightStateId={activeStateIds[activeStateIds.length - 1]}
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
                        setCurrentActionIndex(value);
                        updateActiveStates(value, assumeSuccess);
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
