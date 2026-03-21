/**
 * Analytics Components Usage Example
 *
 * Demonstrates how to use the three analytics components together
 * in a complete workflow analytics page.
 */

"use client";

import React, { useState, useMemo } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import {
  workflowAnalyticsService,
  WorkflowMetrics,
} from "@/services/workflow-analytics-service";
import { workflowComplexityAnalyzer } from "@/services/workflow-complexity-analyzer";
import dynamic from "next/dynamic";

const AnalyticsDashboard = dynamic(
  () =>
    import("./AnalyticsDashboard").then((m) => ({
      default: m.AnalyticsDashboard,
    })),
  { ssr: false }
);
const WorkflowMetricsPanel = dynamic(
  () =>
    import("./WorkflowMetricsPanel").then((m) => ({
      default: m.WorkflowMetricsPanel,
    })),
  { ssr: false }
);
const PerformanceAnalyzer = dynamic(
  () =>
    import("./PerformanceAnalyzer").then((m) => ({
      default: m.PerformanceAnalyzer,
    })),
  { ssr: false }
);
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { createLogger } from "@/lib/logger";

const log = createLogger("AnalyticsExample");

// ============================================================================
// Example Component
// ============================================================================

export function WorkflowAnalyticsExample() {
  // State
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | null>(
    null
  );
  const [timeRange, setTimeRange] = useState({
    start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
    end: new Date(),
  });

  // Mock workflows (replace with actual data)
  const workflows: Workflow[] = useMemo(() => {
    return [
      {
        id: "wf-1",
        name: "User Login Flow",
        version: "1.0.0",
        format: "graph",
        category: "Main",
        description: "Complete user authentication workflow",
        actions: [
          {
            id: "a1",
            type: "FIND",
            config: { pattern: "login-button", similarity: 0.9 },
            position: [100, 100],
          },
          {
            id: "a2",
            type: "CLICK",
            config: { clickType: "single", button: "left" },
            position: [100, 250],
          },
          {
            id: "a3",
            type: "TYPE",
            config: { text: "username" },
            position: [100, 400],
          },
          {
            id: "a4",
            type: "FIND",
            config: {
              pattern: "submit-button",
              similarity: 0.85,
              strategy: "FIRST",
            },
            position: [100, 550],
          },
        ],
        connections: {
          a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
          a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
          a3: { main: [[{ action: "a4", type: "main", index: 0 }]] },
        },
      },
      {
        id: "wf-2",
        name: "Data Extraction",
        version: "1.0.0",
        format: "graph",
        category: "Utilities",
        description: "Extract data from web application",
        actions: [
          {
            id: "a1",
            type: "FIND",
            config: { pattern: "data-table", similarity: 0.85 },
            position: [100, 100],
          },
          {
            id: "a2",
            type: "CLICK",
            config: { clickType: "single", button: "left" },
            position: [100, 250],
          },
          {
            id: "a3",
            type: "LOOP",
            config: { maxIterations: 10 },
            position: [100, 400],
          },
        ],
        connections: {
          a1: { main: [[{ action: "a2", type: "main", index: 0 }]] },
          a2: { main: [[{ action: "a3", type: "main", index: 0 }]] },
        },
      },
    ] as Workflow[];
  }, []);

  // Get all metrics
  const allMetrics = useMemo(() => {
    const metricsMap: Record<string, WorkflowMetrics> = {};

    workflows.forEach((workflow) => {
      metricsMap[workflow.id] = workflowAnalyticsService.getWorkflowMetrics(
        workflow.id
      ) || {
        workflowId: workflow.id,
        workflowName: workflow.name,
        totalExecutions: Math.floor(Math.random() * 100),
        successfulExecutions: Math.floor(Math.random() * 80),
        failedExecutions: Math.floor(Math.random() * 20),
        successRate: 0.8 + Math.random() * 0.2,
        avgDuration: 1000 + Math.random() * 5000,
        minDuration: 500 + Math.random() * 500,
        maxDuration: 5000 + Math.random() * 5000,
        lastExecuted: new Date(
          Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000
        ).toISOString(),
        firstExecuted: new Date(
          Date.now() - 30 * 24 * 60 * 60 * 1000
        ).toISOString(),
      };
    });

    return metricsMap;
  }, [workflows]);

  // Selected workflow
  const selectedWorkflow = useMemo(() => {
    return workflows.find((w) => w.id === selectedWorkflowId) || null;
  }, [workflows, selectedWorkflowId]);

  // Get complexity metrics for selected workflow
  const complexityMetrics = useMemo(() => {
    if (!selectedWorkflow) return null;
    return workflowComplexityAnalyzer.analyzeComplexity(selectedWorkflow);
  }, [selectedWorkflow]);

  // Mock execution history
  const executionHistory = useMemo(() => {
    if (!selectedWorkflowId) return [];

    return Array.from({ length: 30 }, (_, i) => ({
      id: `result-${i}`,
      testCaseId: `test-${i}`,
      testCaseName: `Test ${i + 1}`,
      workflowId: selectedWorkflowId,
      workflowName: selectedWorkflow?.name || "",
      passed: Math.random() > 0.2,
      startTime: new Date(
        Date.now() - (30 - i) * 24 * 60 * 60 * 1000
      ).toISOString(),
      endTime: new Date(
        Date.now() - (30 - i) * 24 * 60 * 60 * 1000 + Math.random() * 10000
      ).toISOString(),
      duration: 1000 + Math.random() * 5000,
      assertions: [],
    }));
  }, [selectedWorkflowId, selectedWorkflow]);

  // Handle analyze
  const handleAnalyze = () => {
    log.debug("Running performance analysis...");
    // Implement actual analysis logic
  };

  // Handle apply suggestion
  const handleApplySuggestion = (suggestion: unknown) => {
    log.debug("Applying suggestion:", suggestion);
    // Implement suggestion application logic
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold">Workflow Analytics</h1>
          <p className="text-muted-foreground mt-2">
            Monitor performance, analyze complexity, and optimize workflows
          </p>
        </div>
      </div>

      <Tabs defaultValue="dashboard" className="space-y-4">
        <TabsList>
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="workflow" disabled={!selectedWorkflowId}>
            Workflow Metrics
          </TabsTrigger>
          <TabsTrigger value="performance" disabled={!selectedWorkflowId}>
            Performance
          </TabsTrigger>
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard" className="space-y-4">
          <AnalyticsDashboard
            workflows={workflows}
            metrics={allMetrics}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
          />
        </TabsContent>

        {/* Workflow Metrics Tab */}
        <TabsContent value="workflow" className="space-y-4">
          {/* Workflow Selector */}
          <Card className="p-4">
            <Select
              value={selectedWorkflowId || ""}
              onValueChange={setSelectedWorkflowId}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Select a workflow" />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>

          {selectedWorkflow &&
            complexityMetrics &&
            allMetrics[selectedWorkflow.id] && (
              <WorkflowMetricsPanel
                workflow={selectedWorkflow}
                metrics={allMetrics[selectedWorkflow.id]!}
                complexityMetrics={complexityMetrics}
                executionHistory={executionHistory}
              />
            )}
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          {/* Workflow Selector */}
          <Card className="p-4">
            <Select
              value={selectedWorkflowId || ""}
              onValueChange={setSelectedWorkflowId}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Select a workflow" />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Card>

          {selectedWorkflow && (
            <PerformanceAnalyzer
              workflow={selectedWorkflow}
              onAnalyze={handleAnalyze}
              onApplySuggestion={handleApplySuggestion}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default WorkflowAnalyticsExample;

// ============================================================================
// Usage Example in a Page
// ============================================================================

/**
 * Example usage in a Next.js page:
 *
 * ```tsx
 * // app/analytics/page.tsx
 * import { WorkflowAnalyticsExample } from '@/components/workflow-analytics/AnalyticsExample';
 *
 * export default function AnalyticsPage() {
 *   return <WorkflowAnalyticsExample />;
 * }
 * ```
 */

/**
 * Example usage with custom data:
 *
 * ```tsx
 * import { AnalyticsDashboard } from '@/components/workflow-analytics';
 * import { workflowAnalyticsService } from '@/services/workflow-analytics-service';
 *
 * function MyAnalyticsPage() {
 *   const [workflows, setWorkflows] = useState<Workflow[]>([]);
 *   const [timeRange, setTimeRange] = useState({
 *     start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
 *     end: new Date(),
 *   });
 *
 *   // Load workflows from your API
 *   useEffect(() => {
 *     async function loadWorkflows() {
 *       const data = await fetch('/api/workflows').then(r => r.json());
 *       setWorkflows(data);
 *     }
 *     loadWorkflows();
 *   }, []);
 *
 *   // Get metrics for all workflows
 *   const metrics = useMemo(() => {
 *     const metricsMap: Record<string, WorkflowMetrics> = {};
 *     workflows.forEach(workflow => {
 *       const metric = workflowAnalyticsService.getWorkflowMetrics(workflow.id);
 *       if (metric) {
 *         metricsMap[workflow.id] = metric;
 *       }
 *     });
 *     return metricsMap;
 *   }, [workflows]);
 *
 *   return (
 *     <AnalyticsDashboard
 *       workflows={workflows}
 *       metrics={metrics}
 *       timeRange={timeRange}
 *       onTimeRangeChange={setTimeRange}
 *     />
 *   );
 * }
 * ```
 */

/**
 * Example usage of WorkflowMetricsPanel:
 *
 * ```tsx
 * import { WorkflowMetricsPanel } from '@/components/workflow-analytics';
 * import { workflowAnalyticsService } from '@/services/workflow-analytics-service';
 * import { workflowComplexityAnalyzer } from '@/services/workflow-complexity-analyzer';
 *
 * function WorkflowDetailsPage({ workflowId }: { workflowId: string }) {
 *   const workflow = useWorkflow(workflowId); // Your custom hook
 *   const metrics = workflowAnalyticsService.getWorkflowMetrics(workflowId);
 *   const complexity = workflowComplexityAnalyzer.analyzeComplexity(workflow);
 *   const history = useExecutionHistory(workflowId); // Your custom hook
 *
 *   return (
 *     <WorkflowMetricsPanel
 *       workflow={workflow}
 *       metrics={metrics}
 *       complexityMetrics={complexity}
 *       executionHistory={history}
 *     />
 *   );
 * }
 * ```
 */

/**
 * Example usage of PerformanceAnalyzer:
 *
 * ```tsx
 * import { PerformanceAnalyzer } from '@/components/workflow-analytics';
 *
 * function WorkflowOptimizationPage({ workflow }: { workflow: Workflow }) {
 *   const handleAnalyze = async () => {
 *     // Run your performance analysis
 *     const result = await analyzeWorkflowPerformance(workflow.id);
 *     console.log('Analysis complete:', result);
 *   };
 *
 *   const handleApplySuggestion = async (suggestion: OptimizationSuggestion) => {
 *     // Apply the optimization suggestion
 *     await applyOptimization(workflow.id, suggestion);
 *     toast.success('Optimization applied successfully');
 *   };
 *
 *   return (
 *     <PerformanceAnalyzer
 *       workflow={workflow}
 *       onAnalyze={handleAnalyze}
 *       onApplySuggestion={handleApplySuggestion}
 *     />
 *   );
 * }
 * ```
 */
