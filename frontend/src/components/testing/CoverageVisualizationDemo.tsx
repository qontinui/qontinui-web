"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CoverageSummaryCard } from "./CoverageSummaryCard";
import { StateCoverageHeatMap } from "./StateCoverageHeatMap";
import { StateGraphVisualization } from "./StateGraphVisualization";
import { BarChart3, Map, Network } from "lucide-react";

interface CoverageVisualizationDemoProps {
  projectId: string;
  workflowId: string;
}

/**
 * Demo component showing all coverage visualization options
 *
 * This component demonstrates three different ways to visualize state coverage:
 * 1. Summary Card - High-level metrics and trends
 * 2. Coverage Heat Map - Interactive graph with status coloring
 * 3. State Graph - Traditional success rate visualization
 *
 * Use this as a reference for integrating coverage visualizations into your pages.
 */
export function CoverageVisualizationDemo({
  projectId,
  workflowId,
}: CoverageVisualizationDemoProps) {
  const [selectedView, setSelectedView] = useState<
    "summary" | "heatmap" | "graph"
  >("summary");

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>Coverage Visualization Demo</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400 mb-4">
            Explore different ways to visualize test coverage for your workflow.
            Each view provides unique insights into testing completeness and
            quality.
          </p>

          {/* View Selector */}
          <div className="flex items-center gap-2">
            <Button
              variant={selectedView === "summary" ? "default" : "outline"}
              onClick={() => setSelectedView("summary")}
              className={
                selectedView === "summary"
                  ? "bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
                  : "border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
              }
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              Summary
            </Button>
            <Button
              variant={selectedView === "heatmap" ? "default" : "outline"}
              onClick={() => setSelectedView("heatmap")}
              className={
                selectedView === "heatmap"
                  ? "bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
                  : "border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
              }
            >
              <Map className="w-4 h-4 mr-2" />
              Heat Map
            </Button>
            <Button
              variant={selectedView === "graph" ? "default" : "outline"}
              onClick={() => setSelectedView("graph")}
              className={
                selectedView === "graph"
                  ? "bg-[#00D9FF] hover:bg-[#00D9FF]/80 text-black"
                  : "border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
              }
            >
              <Network className="w-4 h-4 mr-2" />
              Graph
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Visualization Content */}
      {selectedView === "summary" && (
        <div className="space-y-4">
          <div className="p-4 bg-[#1A1A1B]/30 border border-gray-800/50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              About Summary View
            </h3>
            <p className="text-xs text-gray-400">
              The summary card provides a high-level overview of coverage
              metrics including state coverage, transition coverage, unique
              paths, and total executions. It also shows a trend indicator and a
              mini sparkline of recent coverage history.
            </p>
          </div>
          <CoverageSummaryCard projectId={projectId} workflowId={workflowId} />
        </div>
      )}

      {selectedView === "heatmap" && (
        <div className="space-y-4">
          <div className="p-4 bg-[#1A1A1B]/30 border border-gray-800/50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              About Heat Map View
            </h3>
            <p className="text-xs text-gray-400 mb-2">
              The heat map visualization uses color coding to show the status of
              each state:
            </p>
            <ul className="text-xs text-gray-400 space-y-1 ml-4">
              <li>
                <span className="text-green-500 font-medium">Green</span> -
                Passing states (90%+ success rate)
              </li>
              <li>
                <span className="text-yellow-500 font-medium">Yellow</span> -
                Partial states (70-90% success rate)
              </li>
              <li>
                <span className="text-red-500 font-medium">Red</span> - Failing
                states (&lt;70% success rate)
              </li>
              <li>
                <span className="text-gray-500 font-medium">Gray</span> -
                Untested states (no visits yet)
              </li>
            </ul>
            <p className="text-xs text-gray-400 mt-2">
              Click on any state to view detailed execution statistics.
            </p>
          </div>
          <StateCoverageHeatMap
            projectId={projectId}
            workflowId={workflowId}
          />
        </div>
      )}

      {selectedView === "graph" && (
        <div className="space-y-4">
          <div className="p-4 bg-[#1A1A1B]/30 border border-gray-800/50 rounded-lg">
            <h3 className="text-sm font-medium text-gray-300 mb-2">
              About Graph View
            </h3>
            <p className="text-xs text-gray-400">
              The traditional state graph visualization focuses on success rates
              rather than coverage status. All states are shown with color
              gradients based on their success rates, making it easier to
              identify reliability patterns across the workflow.
            </p>
          </div>
          <StateGraphVisualization
            projectId={projectId}
            workflowId={workflowId}
          />
        </div>
      )}

      {/* Alternative: Tabbed Layout */}
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>Alternative: Tabbed Layout</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400 mb-4">
            You can also use tabs to organize multiple visualizations:
          </p>
          <Tabs defaultValue="summary" className="w-full">
            <TabsList className="grid w-full grid-cols-3 bg-[#0A0A0B]/50">
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="heatmap">Heat Map</TabsTrigger>
              <TabsTrigger value="graph">Graph</TabsTrigger>
            </TabsList>
            <TabsContent value="summary" className="mt-4">
              <CoverageSummaryCard
                projectId={projectId}
                workflowId={workflowId}
              />
            </TabsContent>
            <TabsContent value="heatmap" className="mt-4">
              <StateCoverageHeatMap
                projectId={projectId}
                workflowId={workflowId}
              />
            </TabsContent>
            <TabsContent value="graph" className="mt-4">
              <StateGraphVisualization
                projectId={projectId}
                workflowId={workflowId}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
