"use client";

import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info } from "lucide-react";
import dynamic from "next/dynamic";
import type { SelectedWorkflowData, TopWorkflows } from "../analytics-types";

const WorkflowMetricsPanel = dynamic(
  () =>
    import("@/components/workflow-analytics/WorkflowMetricsPanel").then(
      (m) => ({ default: m.WorkflowMetricsPanel })
    ),
  { ssr: false }
);
const PerformanceAnalyzer = dynamic(
  () =>
    import("@/components/workflow-analytics/PerformanceAnalyzer").then((m) => ({
      default: m.PerformanceAnalyzer,
    })),
  { ssr: false }
);

interface PerformanceTabProps {
  selectedWorkflow: string | null;
  selectedWorkflowData: SelectedWorkflowData | null;
  topWorkflows: TopWorkflows;
  onSelectWorkflow: (workflowId: string) => void;
}

export function PerformanceTab({
  selectedWorkflow,
  selectedWorkflowData,
  topWorkflows,
  onSelectWorkflow,
}: PerformanceTabProps) {
  if (selectedWorkflow && selectedWorkflowData) {
    return (
      <>
        <WorkflowMetricsPanel
          workflow={selectedWorkflowData.workflow}
          metrics={selectedWorkflowData.metrics}
          complexityMetrics={selectedWorkflowData.complexityMetrics}
          executionHistory={selectedWorkflowData.executionHistory}
        />
        <PerformanceAnalyzer
          workflow={selectedWorkflowData.workflow}
          onAnalyze={() => {}}
          onApplySuggestion={() => {}}
        />
      </>
    );
  }

  return (
    <Card className="bg-muted border-border">
      <CardContent className="flex flex-col items-center justify-center py-16">
        <Info className="h-16 w-16 text-muted-foreground mb-4" />
        <h3 className="text-xl font-semibold mb-2">Select a Workflow</h3>
        <p className="text-muted-foreground text-center mb-6">
          Choose a workflow from the Top Workflows tab to view detailed
          performance analysis
        </p>
        <Button
          onClick={() => {
            const firstWorkflow = topWorkflows.mostExecuted[0];
            if (firstWorkflow) {
              onSelectWorkflow(firstWorkflow.workflowId);
            }
          }}
          disabled={topWorkflows.mostExecuted.length === 0}
        >
          View Top Workflow
        </Button>
      </CardContent>
    </Card>
  );
}
