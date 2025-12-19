/**
 * Performance Analyzer Component
 *
 * Performance analysis and optimization suggestions for workflows:
 * - Bottleneck detection and visualization
 * - Action timing analysis with heatmap
 * - Optimization suggestions (parallelization, waits, loops)
 * - Interactive suggestion application
 * - Impact estimates and metrics
 */

"use client";

import React, { useState, useMemo } from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Zap,
  Clock,
  TrendingUp,
  GitBranch,
  Repeat,
  Sparkles,
  Play,
  CheckCircle,
  XCircle,
  Info,
  Activity,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

// ============================================================================
// Types
// ============================================================================

export interface PerformanceAnalyzerProps {
  workflow: Workflow;
  performanceData?: PerformanceData;
  onAnalyze: () => void;
  onApplySuggestion: (suggestion: OptimizationSuggestion) => void;
  className?: string;
}

export interface PerformanceData {
  bottlenecks: Bottleneck[];
  actionTimings: ActionTiming[];
  suggestions: OptimizationSuggestion[];
  parallelizationOpportunities: ParallelizationOpportunity[];
  waitAnalysis: WaitAnalysis[];
  loopAnalysis: LoopAnalysis[];
  totalDuration: number;
  estimatedOptimizedDuration: number;
}

interface Bottleneck {
  actionId: string;
  actionName: string;
  actionType: string;
  duration: number;
  percentOfTotal: number;
  severity: "low" | "medium" | "high";
}

interface ActionTiming {
  actionId: string;
  actionName: string;
  actionType: string;
  duration: number;
  percentile: number;
}

interface OptimizationSuggestion {
  id: string;
  type:
    | "parallelization"
    | "wait-optimization"
    | "loop-optimization"
    | "caching"
    | "action-removal";
  severity: "low" | "medium" | "high";
  title: string;
  description: string;
  estimatedImprovement: number; // Time saved in ms
  impactPercentage: number; // % of total time
  affectedActions: string[];
  applied?: boolean;
}

interface ParallelizationOpportunity {
  groupId: string;
  actions: string[];
  currentDuration: number;
  parallelDuration: number;
  savings: number;
}

interface WaitAnalysis {
  actionId: string;
  actionName: string;
  waitDuration: number;
  suggestion: string;
  potentialSavings: number;
}

interface LoopAnalysis {
  actionId: string;
  actionName: string;
  estimatedIterations: number;
  avgIterationDuration: number;
  totalDuration: number;
  suggestion: string;
  potentialSavings: number;
}

// ============================================================================
// Constants
// ============================================================================

const SEVERITY_COLORS = {
  low: "#10b981",
  medium: "#f59e0b",
  high: "#ef4444",
};

const SUGGESTION_ICONS = {
  parallelization: GitBranch,
  "wait-optimization": Clock,
  "loop-optimization": Repeat,
  caching: Sparkles,
  "action-removal": XCircle,
};

// ============================================================================
// Helper Functions
// ============================================================================

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

function getSeverityColor(severity: string): string {
  return (
    SEVERITY_COLORS[severity as keyof typeof SEVERITY_COLORS] ||
    SEVERITY_COLORS.low
  );
}

// ============================================================================
// Mock Data Generator (for demonstration)
// ============================================================================

function generateMockPerformanceData(workflow: Workflow): PerformanceData {
  const actionTimings: ActionTiming[] = workflow.actions.map(
    (action, index) => ({
      actionId: action.id,
      actionName: action.name || `Action ${index + 1}`,
      actionType: action.type,
      duration: Math.random() * 5000 + 500,
      percentile: Math.random() * 100,
    })
  );

  const totalDuration = actionTimings.reduce((sum, t) => sum + t.duration, 0);

  const bottlenecks: Bottleneck[] = actionTimings
    .filter((t) => t.duration > totalDuration * 0.1)
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5)
    .map((t) => ({
      actionId: t.actionId,
      actionName: t.actionName,
      actionType: t.actionType,
      duration: t.duration,
      percentOfTotal: (t.duration / totalDuration) * 100,
      severity:
        t.duration > totalDuration * 0.3
          ? "high"
          : t.duration > totalDuration * 0.2
            ? "medium"
            : "low",
    }));

  const suggestions: OptimizationSuggestion[] = [
    {
      id: "opt-1",
      type: "parallelization",
      severity: "high",
      title: "Parallelize Independent Actions",
      description:
        "Actions 3, 4, and 5 can be executed in parallel as they have no dependencies.",
      estimatedImprovement: 2500,
      impactPercentage: 25,
      affectedActions: workflow.actions.slice(2, 5).map((a) => a.id),
    },
    {
      id: "opt-2",
      type: "wait-optimization",
      severity: "medium",
      title: "Optimize Wait Duration",
      description:
        "WAIT action is using a fixed 5s delay. Consider using a dynamic wait with timeout.",
      estimatedImprovement: 3000,
      impactPercentage: 30,
      affectedActions: workflow.actions
        .filter((a) => a.type === "WAIT")
        .map((a) => a.id),
    },
    {
      id: "opt-3",
      type: "loop-optimization",
      severity: "medium",
      title: "Reduce Loop Iterations",
      description:
        "Loop is executing 50 times. Consider batching operations or reducing iterations.",
      estimatedImprovement: 1500,
      impactPercentage: 15,
      affectedActions: workflow.actions
        .filter((a) => a.type === "LOOP")
        .map((a) => a.id),
    },
    {
      id: "opt-4",
      type: "caching",
      severity: "low",
      title: "Cache Pattern Search Results",
      description:
        "Multiple FIND actions search for the same pattern. Cache results to avoid redundant searches.",
      estimatedImprovement: 800,
      impactPercentage: 8,
      affectedActions: workflow.actions
        .filter((a) => a.type === "FIND")
        .map((a) => a.id),
    },
  ];

  const parallelizationOpportunities: ParallelizationOpportunity[] = [
    {
      groupId: "group-1",
      actions: workflow.actions.slice(2, 5).map((a) => a.id),
      currentDuration: 7500,
      parallelDuration: 5000,
      savings: 2500,
    },
  ];

  const waitAnalysis: WaitAnalysis[] = workflow.actions
    .filter((a) => a.type === "WAIT")
    .map((a, i) => ({
      actionId: a.id,
      actionName: a.name || `Wait ${i + 1}`,
      waitDuration: 5000,
      suggestion: "Replace with dynamic wait with 10s timeout",
      potentialSavings: 3000,
    }));

  const loopAnalysis: LoopAnalysis[] = workflow.actions
    .filter((a) => a.type === "LOOP")
    .map((a, i) => ({
      actionId: a.id,
      actionName: a.name || `Loop ${i + 1}`,
      estimatedIterations: 50,
      avgIterationDuration: 100,
      totalDuration: 5000,
      suggestion: "Batch operations or use parallel execution",
      potentialSavings: 1500,
    }));

  const estimatedOptimizedDuration =
    totalDuration -
    suggestions.reduce((sum, s) => sum + s.estimatedImprovement, 0);

  return {
    bottlenecks,
    actionTimings,
    suggestions,
    parallelizationOpportunities,
    waitAnalysis,
    loopAnalysis,
    totalDuration,
    estimatedOptimizedDuration,
  };
}

// ============================================================================
// Suggestion Card Component
// ============================================================================

interface SuggestionCardProps {
  suggestion: OptimizationSuggestion;
  onApply: () => void;
  onDismiss: () => void;
}

function SuggestionCard({
  suggestion,
  onApply,
  onDismiss,
}: SuggestionCardProps) {
  const Icon = SUGGESTION_ICONS[suggestion.type];

  return (
    <Card className={cn("border-l-4", suggestion.applied && "opacity-60")}>
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ backgroundColor: getSeverityColor(suggestion.severity) }}
      />
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-base">{suggestion.title}</CardTitle>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-xs">
                  {suggestion.type.replace("-", " ")}
                </Badge>
                <Badge
                  variant="outline"
                  className="text-xs"
                  style={{ borderColor: getSeverityColor(suggestion.severity) }}
                >
                  {suggestion.severity}
                </Badge>
              </div>
            </div>
          </div>
          {suggestion.applied && (
            <CheckCircle className="h-5 w-5 text-green-500" />
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {suggestion.description}
        </p>

        <div className="flex items-center justify-between text-sm">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              <span className="font-medium">Estimated improvement:</span>
            </div>
            <div className="text-lg font-bold text-green-500">
              {formatDuration(suggestion.estimatedImprovement)}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">
              {formatPercentage(suggestion.impactPercentage)}
            </div>
            <div className="text-xs text-muted-foreground">of total time</div>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Affects {suggestion.affectedActions.length} action
          {suggestion.affectedActions.length !== 1 ? "s" : ""}
        </div>

        {!suggestion.applied && (
          <div className="flex items-center gap-2 pt-2">
            <Button onClick={onApply} size="sm" className="flex-1">
              <CheckCircle className="h-4 w-4 mr-2" />
              Apply
            </Button>
            <Button onClick={onDismiss} variant="outline" size="sm">
              Dismiss
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PerformanceAnalyzer({
  workflow,
  performanceData: propPerformanceData,
  onAnalyze,
  onApplySuggestion,
  className,
}: PerformanceAnalyzerProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(
    new Set()
  );

  // Use provided data or generate mock data
  const performanceData = useMemo(() => {
    return propPerformanceData || generateMockPerformanceData(workflow);
  }, [propPerformanceData, workflow]);

  // Filter out dismissed suggestions
  const activeSuggestions = useMemo(() => {
    return performanceData.suggestions.filter(
      (s) => !dismissedSuggestions.has(s.id)
    );
  }, [performanceData.suggestions, dismissedSuggestions]);

  // Calculate potential savings
  const totalPotentialSavings = useMemo(() => {
    return activeSuggestions.reduce(
      (sum, s) => sum + s.estimatedImprovement,
      0
    );
  }, [activeSuggestions]);

  // Bottleneck heatmap data
  const heatmapData = useMemo(() => {
    return performanceData.actionTimings.map((t) => ({
      name: t.actionName.substring(0, 15),
      duration: t.duration,
      fill:
        t.duration > performanceData.totalDuration * 0.2
          ? "#ef4444"
          : t.duration > performanceData.totalDuration * 0.1
            ? "#f59e0b"
            : "#10b981",
    }));
  }, [performanceData]);

  // Handle analyze
  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1500)); // Simulate analysis
      onAnalyze();
    } finally {
      setAnalyzing(false);
    }
  };

  // Handle apply suggestion
  const handleApplySuggestion = (suggestion: OptimizationSuggestion) => {
    onApplySuggestion(suggestion);
  };

  // Handle dismiss suggestion
  const handleDismissSuggestion = (suggestionId: string) => {
    setDismissedSuggestions((prev) => new Set([...prev, suggestionId]));
  };

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-yellow-500" />
            Performance Analyzer
          </h3>
          <p className="text-muted-foreground">
            Identify bottlenecks and optimize workflow performance
          </p>
        </div>
        <Button onClick={handleAnalyze} disabled={analyzing}>
          {analyzing ? (
            <>
              <Activity className="h-4 w-4 mr-2 animate-spin" />
              Analyzing...
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Run Analysis
            </>
          )}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Current Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDuration(performanceData.totalDuration)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Optimized Duration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">
              {formatDuration(performanceData.estimatedOptimizedDuration)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Potential Savings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">
              {formatDuration(totalPotentialSavings)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Bottlenecks Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {performanceData.bottlenecks.length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Improvement Potential */}
      {totalPotentialSavings > 0 && (
        <Alert>
          <TrendingUp className="h-4 w-4" />
          <AlertTitle>Optimization Potential</AlertTitle>
          <AlertDescription>
            You can save up to{" "}
            <strong>{formatDuration(totalPotentialSavings)}</strong> (
            {formatPercentage(
              (totalPotentialSavings / performanceData.totalDuration) * 100
            )}
            ) by applying the suggested optimizations.
          </AlertDescription>
        </Alert>
      )}

      {/* Main Content Tabs */}
      <Tabs defaultValue="suggestions" className="space-y-4">
        <TabsList>
          <TabsTrigger value="suggestions">
            Suggestions
            {activeSuggestions.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {activeSuggestions.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="bottlenecks">Bottlenecks</TabsTrigger>
          <TabsTrigger value="parallelization">Parallelization</TabsTrigger>
          <TabsTrigger value="waits">Wait Analysis</TabsTrigger>
          <TabsTrigger value="loops">Loop Analysis</TabsTrigger>
        </TabsList>

        {/* Suggestions Tab */}
        <TabsContent value="suggestions" className="space-y-4">
          {activeSuggestions.length > 0 ? (
            <div className="grid gap-4">
              {activeSuggestions
                .sort((a, b) => b.estimatedImprovement - a.estimatedImprovement)
                .map((suggestion) => (
                  <SuggestionCard
                    key={suggestion.id}
                    suggestion={suggestion}
                    onApply={() => handleApplySuggestion(suggestion)}
                    onDismiss={() => handleDismissSuggestion(suggestion.id)}
                  />
                ))}
            </div>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <CheckCircle className="h-12 w-12 text-green-500 mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Suggestions</h3>
                <p className="text-muted-foreground text-center">
                  This workflow is already well-optimized, or run an analysis to
                  find improvements.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Bottlenecks Tab */}
        <TabsContent value="bottlenecks" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Action Timing Heatmap</CardTitle>
              <CardDescription>
                Actions consuming the most time (red = high, yellow = medium,
                green = low)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={heatmapData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis
                    dataKey="name"
                    angle={-45}
                    textAnchor="end"
                    height={100}
                  />
                  <YAxis tickFormatter={formatDuration} />
                  <Tooltip
                    formatter={(value) => formatDuration(Number(value))}
                  />
                  <Bar dataKey="duration" radius={[8, 8, 0, 0]}>
                    {heatmapData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top Bottlenecks</CardTitle>
              <CardDescription>
                Actions taking the most execution time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-3">
                  {performanceData.bottlenecks.map((bottleneck, index) => (
                    <div key={bottleneck.actionId} className="space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              #{index + 1}
                            </span>
                            <span className="text-sm font-medium">
                              {bottleneck.actionName}
                            </span>
                            <Badge variant="outline" className="text-xs">
                              {bottleneck.actionType}
                            </Badge>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {formatPercentage(bottleneck.percentOfTotal)} of
                            total execution time
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-bold">
                            {formatDuration(bottleneck.duration)}
                          </div>
                          <Badge
                            variant="outline"
                            className="text-xs mt-1"
                            style={{
                              borderColor: getSeverityColor(
                                bottleneck.severity
                              ),
                            }}
                          >
                            {bottleneck.severity}
                          </Badge>
                        </div>
                      </div>
                      <Progress
                        value={bottleneck.percentOfTotal}
                        className="h-2"
                        style={{
                          background: `linear-gradient(to right, ${getSeverityColor(bottleneck.severity)} ${bottleneck.percentOfTotal}%, transparent ${bottleneck.percentOfTotal}%)`,
                        }}
                      />
                      {index < performanceData.bottlenecks.length - 1 && (
                        <Separator className="mt-3" />
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Parallelization Tab */}
        <TabsContent value="parallelization" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitBranch className="h-5 w-5" />
                Parallelization Opportunities
              </CardTitle>
              <CardDescription>
                Actions that can be executed in parallel to reduce total
                duration
              </CardDescription>
            </CardHeader>
            <CardContent>
              {performanceData.parallelizationOpportunities.length > 0 ? (
                <div className="space-y-4">
                  {performanceData.parallelizationOpportunities.map((opp) => (
                    <div
                      key={opp.groupId}
                      className="border rounded-lg p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold">Group {opp.groupId}</h4>
                        <Badge variant="secondary">
                          {opp.actions.length} actions
                        </Badge>
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <div className="text-muted-foreground">
                            Current Duration
                          </div>
                          <div className="font-bold">
                            {formatDuration(opp.currentDuration)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">
                            Parallel Duration
                          </div>
                          <div className="font-bold text-green-500">
                            {formatDuration(opp.parallelDuration)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">
                            Time Saved
                          </div>
                          <div className="font-bold text-blue-500">
                            {formatDuration(opp.savings)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Info className="h-4 w-4 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">
                          Actions have no dependencies and can run
                          simultaneously
                        </span>
                      </div>

                      <Button size="sm" className="w-full">
                        Apply Parallelization
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No parallelization opportunities found
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Wait Analysis Tab */}
        <TabsContent value="waits" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Wait Action Analysis
              </CardTitle>
              <CardDescription>
                Optimize wait durations and use dynamic waits
              </CardDescription>
            </CardHeader>
            <CardContent>
              {performanceData.waitAnalysis.length > 0 ? (
                <div className="space-y-3">
                  {performanceData.waitAnalysis.map((wait) => (
                    <div
                      key={wait.actionId}
                      className="border rounded-lg p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{wait.actionName}</span>
                        <Badge variant="outline">
                          {formatDuration(wait.waitDuration)}
                        </Badge>
                      </div>

                      <p className="text-sm text-muted-foreground">
                        {wait.suggestion}
                      </p>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Potential savings:
                        </span>
                        <span className="font-bold text-green-500">
                          {formatDuration(wait.potentialSavings)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No WAIT actions found in this workflow
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Loop Analysis Tab */}
        <TabsContent value="loops" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Repeat className="h-5 w-5" />
                Loop Performance Analysis
              </CardTitle>
              <CardDescription>
                Optimize loop iterations and execution
              </CardDescription>
            </CardHeader>
            <CardContent>
              {performanceData.loopAnalysis.length > 0 ? (
                <div className="space-y-3">
                  {performanceData.loopAnalysis.map((loop) => (
                    <div
                      key={loop.actionId}
                      className="border rounded-lg p-4 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{loop.actionName}</span>
                        <Badge variant="secondary">
                          {loop.estimatedIterations} iterations
                        </Badge>
                      </div>

                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-muted-foreground">
                            Avg Iteration
                          </div>
                          <div className="font-bold">
                            {formatDuration(loop.avgIterationDuration)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">
                            Total Duration
                          </div>
                          <div className="font-bold">
                            {formatDuration(loop.totalDuration)}
                          </div>
                        </div>
                      </div>

                      <p className="text-sm text-muted-foreground">
                        {loop.suggestion}
                      </p>

                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Potential savings:
                        </span>
                        <span className="font-bold text-green-500">
                          {formatDuration(loop.potentialSavings)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  No LOOP actions found in this workflow
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default PerformanceAnalyzer;
