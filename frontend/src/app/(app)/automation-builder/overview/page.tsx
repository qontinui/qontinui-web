"use client";

/**
 * Project Overview Page
 *
 * Dashboard showing project summary, statistics, and quick navigation.
 * Visualizations have been moved to the State Machine page (Build → State Machine).
 */

import { useMemo, Suspense } from "react";
import { useRouter } from "next/navigation";
import { useAutomation } from "@/contexts/automation-context";
import { useRunnerMonitors } from "@/hooks/useRunnerMonitors";
import { RequireProject } from "@/components/require-project";
import { useProjectLoader } from "@/hooks/use-project-loader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Layers,
  ArrowRight,
  Network,
  Image,
  Workflow,
  Variable,
  Monitor,
  Eye,
  Play,
} from "lucide-react";

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-brand-primary" />
    </div>
  );
}

function OverviewPageContent() {
  const router = useRouter();
  const { isLoading } = useProjectLoader();
  const { states, images, transitions, workflows } = useAutomation();
  const { monitors, isRunnerConnected } = useRunnerMonitors();

  // Calculate statistics
  const stats = useMemo(() => {
    const outgoingTransitions = transitions.filter(
      (t) => t.type === "OutgoingTransition"
    );
    const incomingTransitions = transitions.filter(
      (t) => t.type === "IncomingTransition"
    );

    // States with visual elements
    const statesWithElements = states.filter((state) => {
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

    // Total actions across workflows
    const totalActions = workflows.reduce(
      (sum, w) => sum + (w.actions?.length ?? 0),
      0
    );

    return {
      stateCount: states.length,
      statesWithElements: statesWithElements.length,
      transitionCount: transitions.length,
      outgoingCount: outgoingTransitions.length,
      incomingCount: incomingTransitions.length,
      workflowCount: workflows.length,
      totalActions,
      imageCount: images.length,
      monitorCount: monitors.length,
    };
  }, [states, transitions, workflows, images, monitors]);

  if (isLoading) {
    return <LoadingFallback />;
  }

  return (
    <div className="container mx-auto py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-2">
          <Layers className="h-8 w-8" />
          Project Overview
        </h1>
        <p className="text-muted-foreground">
          Summary of your automation project
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* States */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              States
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-3xl font-bold">{stats.stateCount}</div>
              <Network className="h-8 w-8 text-primary opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.statesWithElements} with visual elements
            </p>
          </CardContent>
        </Card>

        {/* Transitions */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Transitions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-3xl font-bold">{stats.transitionCount}</div>
              <ArrowRight className="h-8 w-8 text-fuchsia-500 opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.outgoingCount} outgoing, {stats.incomingCount} incoming
            </p>
          </CardContent>
        </Card>

        {/* Workflows */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Workflows
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-3xl font-bold">{stats.workflowCount}</div>
              <Workflow className="h-8 w-8 text-cyan-500 opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats.totalActions} total actions
            </p>
          </CardContent>
        </Card>

        {/* Images */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pattern Images
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-3xl font-bold">{stats.imageCount}</div>
              <Image className="h-8 w-8 text-green-500 opacity-50" />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Used for visual recognition
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* State Visualization */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              State Visualization
            </CardTitle>
            <CardDescription>
              View states positioned on a canvas based on their screen locations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {stats.statesWithElements} states with positioned elements
              </div>
              <Button
                onClick={() =>
                  router.push("/automation-builder/states?tab=state-view")
                }
              >
                Open State View
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Transition Animation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Transition Visualization
            </CardTitle>
            <CardDescription>
              Animate transitions to see how actions execute between states
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {stats.transitionCount} transitions available
              </div>
              <Button
                onClick={() =>
                  router.push("/automation-builder/states?tab=transitions")
                }
              >
                Open Transitions
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Additional Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Variables */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Variable className="h-4 w-4" />
              Variables
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Global project variables
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/automation-builder/variables")}
              >
                Manage
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Runner Status */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Monitor className="h-4 w-4" />
              Runner Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant={isRunnerConnected ? "default" : "secondary"}>
                  {isRunnerConnected ? "Connected" : "Disconnected"}
                </Badge>
                {isRunnerConnected && (
                  <span className="text-sm text-muted-foreground">
                    {stats.monitorCount} monitor
                    {stats.monitorCount !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/runners")}
              >
                Manage
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* State Machine */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Network className="h-4 w-4" />
              State Machine
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Edit states & transitions
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push("/automation-builder/states")}
              >
                Open
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function OverviewPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <RequireProject pageName="Project Overview">
        <OverviewPageContent />
      </RequireProject>
    </Suspense>
  );
}
