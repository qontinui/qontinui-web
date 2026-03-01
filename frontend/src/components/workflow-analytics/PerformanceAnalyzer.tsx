"use client";

import React from "react";
import { Zap, TrendingUp, Play, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { formatDuration, formatPercentage } from "./performance-analyzer-utils";
import { usePerformanceAnalyzer } from "./_hooks/usePerformanceAnalyzer";
import { SummaryCards } from "./_components/SummaryCards";
import { SuggestionsTab } from "./_components/SuggestionsTab";
import { BottlenecksTab } from "./_components/BottlenecksTab";
import { ParallelizationTab } from "./_components/ParallelizationTab";
import { WaitAnalysisTab } from "./_components/WaitAnalysisTab";
import { LoopAnalysisTab } from "./_components/LoopAnalysisTab";

export type {
  PerformanceAnalyzerProps,
  PerformanceData,
} from "./performance-analyzer-types";

import type { PerformanceAnalyzerProps } from "./performance-analyzer-types";

export function PerformanceAnalyzer({
  workflow,
  performanceData: propPerformanceData,
  onAnalyze,
  onApplySuggestion,
  className,
}: PerformanceAnalyzerProps) {
  const {
    analyzing,
    performanceData,
    activeSuggestions,
    totalPotentialSavings,
    heatmapData,
    handleAnalyze,
    handleApplySuggestion,
    handleDismissSuggestion,
  } = usePerformanceAnalyzer(
    workflow,
    propPerformanceData,
    onAnalyze,
    onApplySuggestion
  );

  return (
    <div className={cn("space-y-6", className)}>
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

      <SummaryCards
        totalDuration={performanceData.totalDuration}
        estimatedOptimizedDuration={performanceData.estimatedOptimizedDuration}
        totalPotentialSavings={totalPotentialSavings}
        bottleneckCount={performanceData.bottlenecks.length}
      />

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

        <TabsContent value="suggestions" className="space-y-4">
          <SuggestionsTab
            suggestions={activeSuggestions}
            onApply={handleApplySuggestion}
            onDismiss={handleDismissSuggestion}
          />
        </TabsContent>

        <TabsContent value="bottlenecks" className="space-y-4">
          <BottlenecksTab
            heatmapData={heatmapData}
            bottlenecks={performanceData.bottlenecks}
          />
        </TabsContent>

        <TabsContent value="parallelization" className="space-y-4">
          <ParallelizationTab
            opportunities={performanceData.parallelizationOpportunities}
          />
        </TabsContent>

        <TabsContent value="waits" className="space-y-4">
          <WaitAnalysisTab waitAnalysis={performanceData.waitAnalysis} />
        </TabsContent>

        <TabsContent value="loops" className="space-y-4">
          <LoopAnalysisTab loopAnalysis={performanceData.loopAnalysis} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default PerformanceAnalyzer;
