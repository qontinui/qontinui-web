"use client";

import {
  CheckCircle2,
  AlertTriangle,
  Layers,
  Box,
  FileText,
  Footprints,
  GitBranch,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TransitionPreviewPanel } from "@/components/ui-bridge";
import type { UIBridgeResultsViewProps } from "./ui-bridge-results-types";
import { useUIBridgeTransitions } from "./_hooks/useUIBridgeTransitions";
import { MetricsCard } from "./_components/MetricsCard";
import { StatesTable } from "./_components/StatesTable";
import { ElementsTable } from "./_components/ElementsTable";
import { RenderLogsList } from "./_components/RenderLogsList";
import { StepsTable } from "./_components/StepsTable";
import { ErrorsList } from "./_components/ErrorsList";
import { EmptyState } from "./_components/EmptyState";

export type { UIBridgeResultsViewProps } from "./ui-bridge-results-types";

export function UIBridgeResultsView({
  job,
  results,
  onAcceptTransition,
  onAcceptAllTransitions,
}: UIBridgeResultsViewProps) {
  const {
    suggestedTransitions,
    hasEnhancedStepData,
    handleAcceptTransition,
    handleAcceptAllTransitions,
  } = useUIBridgeTransitions(
    results,
    onAcceptTransition,
    onAcceptAllTransitions
  );

  if (!job) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No job data available</p>
      </div>
    );
  }

  if (job.status === "running" || job.status === "pending") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
        <p className="text-muted-foreground">
          {job.progress_message || `Exploration ${job.status}...`}
        </p>
        {job.progress_percent !== undefined && (
          <Progress value={job.progress_percent} className="w-64" />
        )}
        {job.elements_discovered !== undefined && (
          <div className="text-sm text-muted-foreground">
            {job.elements_explored || 0} / {job.elements_discovered} elements
            explored
          </div>
        )}
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">No results available</p>
      </div>
    );
  }

  const states = results.state_discovery?.states || [];
  const elements = results.state_discovery?.elements || [];
  const renderLogs = results.render_logs || [];
  const steps = results.steps || [];
  const errors = results.errors || [];

  return (
    <div className="space-y-4">
      <MetricsCard results={results} />
      <Tabs defaultValue="states" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="states" className="flex items-center gap-1">
            <Layers className="h-4 w-4" />
            States
            <Badge variant="secondary" className="ml-1">
              {states.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="transitions" className="flex items-center gap-1">
            <GitBranch className="h-4 w-4" />
            Transitions
            {suggestedTransitions.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {suggestedTransitions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="elements" className="flex items-center gap-1">
            <Box className="h-4 w-4" />
            Elements
            <Badge variant="secondary" className="ml-1">
              {elements.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="renders" className="flex items-center gap-1">
            <FileText className="h-4 w-4" />
            Logs
            <Badge variant="secondary" className="ml-1">
              {renderLogs.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="steps" className="flex items-center gap-1">
            <Footprints className="h-4 w-4" />
            Steps
            <Badge variant="secondary" className="ml-1">
              {steps.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="errors" className="flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" />
            Errors
            {errors.length > 0 && (
              <Badge variant="destructive" className="ml-1">
                {errors.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="states" className="mt-4">
          {states.length === 0 ? (
            <EmptyState
              icon={Layers}
              message="No states discovered"
              detail="State discovery runs after exploration completes"
            />
          ) : (
            <StatesTable states={states} />
          )}
        </TabsContent>
        <TabsContent value="transitions" className="mt-4">
          {hasEnhancedStepData ? (
            <TransitionPreviewPanel
              suggestedTransitions={suggestedTransitions}
              discoveredStates={states}
              onAccept={handleAcceptTransition}
              onAcceptAll={handleAcceptAllTransitions}
            />
          ) : (
            <EmptyState
              icon={GitBranch}
              message="Transition discovery requires updated runner"
              detail="Please update qontinui-runner to enable transition discovery"
            />
          )}
        </TabsContent>
        <TabsContent value="elements" className="mt-4">
          {elements.length === 0 ? (
            <EmptyState icon={Box} message="No elements discovered" />
          ) : (
            <ElementsTable elements={elements} />
          )}
        </TabsContent>
        <TabsContent value="renders" className="mt-4">
          {renderLogs.length === 0 ? (
            <EmptyState icon={FileText} message="No render logs captured" />
          ) : (
            <RenderLogsList logs={renderLogs} />
          )}
        </TabsContent>
        <TabsContent value="steps" className="mt-4">
          {steps.length === 0 ? (
            <EmptyState
              icon={Footprints}
              message="No exploration steps recorded"
            />
          ) : (
            <StepsTable steps={steps} />
          )}
        </TabsContent>
        <TabsContent value="errors" className="mt-4">
          {errors.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              message="No errors encountered during exploration"
              iconClassName="text-green-500"
            />
          ) : (
            <ErrorsList errors={errors} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
