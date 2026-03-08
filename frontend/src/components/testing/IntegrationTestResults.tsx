"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Route,
  Activity,
  Info,
  Shield,
} from "lucide-react";
import { mockStepToUnifiedStep } from "@/lib/tree-event-adapter";
import type {
  IntegrationTestResponse,
  IntegrationTestRun,
} from "@/types/integration-testing";
import type { UnifiedExecutionStep } from "@/types/tree-events";
import { formatDuration } from "./utils";
import { SummaryHeader } from "./_components/SummaryHeader";
import { ExecutionStepsPanel } from "./_components/ExecutionStepsPanel";
import { InsightsPanel } from "./_components/InsightsPanel";

interface IntegrationTestResultsProps {
  run: IntegrationTestResponse | IntegrationTestRun;
  onStepClick?: (step: UnifiedExecutionStep, index: number) => void;
  showPlaybackToggle?: boolean;
  onToggleVisualMode?: () => void;
  nameMap?: Map<string, string>;
}

export function IntegrationTestResults({
  run,
  onStepClick,
  showPlaybackToggle = true,
  onToggleVisualMode,
  nameMap,
}: IntegrationTestResultsProps) {
  const [expandedStepIndex, setExpandedStepIndex] = useState<number | null>(
    null
  );
  const [activeTab, setActiveTab] = useState<"steps" | "insights">("steps");

  const normalizedRun = {
    ...run,
    steps: run.steps ?? [],
    initial_states: run.initial_states ?? [],
    final_states: run.final_states ?? [],
    reliability_insights: run.reliability_insights ?? [],
    stochasticity_warnings: run.stochasticity_warnings ?? [],
    coverage_gaps: run.coverage_gaps ?? [],
    coverage_data: run.coverage_data ?? {
      states_covered: 0,
      total_states: 0,
      transitions_covered: 0,
      total_transitions: 0,
      coverage_percentage: 0,
    },
  };

  const unifiedSteps = normalizedRun.steps.map(mockStepToUnifiedStep);

  const handleStepToggle = (index: number) => {
    setExpandedStepIndex(expandedStepIndex === index ? null : index);
    if (onStepClick && unifiedSteps[index]) {
      onStepClick(unifiedSteps[index], index);
    }
  };

  const getStatusBadge = () => {
    switch (run.status) {
      case "completed":
        return (
          <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
            <XCircle className="w-3 h-3 mr-1" />
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
            <Activity className="w-3 h-3 mr-1 animate-pulse" />
            Running
          </Badge>
        );
      case "timeout":
        return (
          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
            <Clock className="w-3 h-3 mr-1" />
            Timeout
          </Badge>
        );
      default:
        return (
          <Badge className="bg-surface-raised/20 text-text-muted border-border-subtle">
            <Info className="w-3 h-3 mr-1" />
            {run.status}
          </Badge>
        );
    }
  };

  const insightsCount =
    normalizedRun.reliability_insights.length +
    normalizedRun.stochasticity_warnings.length +
    normalizedRun.coverage_gaps.length;

  return (
    <div className="space-y-6">
      <SummaryHeader
        run={normalizedRun}
        getStatusBadge={getStatusBadge}
        formatDuration={formatDuration}
        showPlaybackToggle={showPlaybackToggle}
        onToggleVisualMode={onToggleVisualMode}
        nameMap={nameMap}
      />

      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as "steps" | "insights")}
      >
        <TabsList className="bg-surface-raised/50 border border-border-subtle/50">
          <TabsTrigger
            value="steps"
            className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary"
          >
            <Route className="w-4 h-4 mr-2" />
            Execution Steps ({unifiedSteps.length})
          </TabsTrigger>
          <TabsTrigger
            value="insights"
            className="data-[state=active]:bg-brand-primary/20 data-[state=active]:text-brand-primary"
          >
            <Shield className="w-4 h-4 mr-2" />
            Insights
            {insightsCount > 0 && (
              <Badge className="ml-2 bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-xs">
                {insightsCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="steps" className="mt-4">
          <ExecutionStepsPanel
            steps={unifiedSteps}
            expandedStepIndex={expandedStepIndex}
            onStepToggle={handleStepToggle}
            nameMap={nameMap}
          />
        </TabsContent>

        <TabsContent value="insights" className="mt-4">
          <InsightsPanel
            reliabilityInsights={normalizedRun.reliability_insights}
            stochasticityWarnings={normalizedRun.stochasticity_warnings}
            coverageGaps={normalizedRun.coverage_gaps}
            nameMap={nameMap}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default IntegrationTestResults;
