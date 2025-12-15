"use client";

import { useMemo } from "react";
import { useCoverageTrends, useStateGraph } from "@/hooks/useTesting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface CoverageSummaryCardProps {
  projectId: string;
  workflowId: string;
}

export function CoverageSummaryCard({
  projectId,
  workflowId,
}: CoverageSummaryCardProps) {
  const {
    data: graphData,
    isLoading: isGraphLoading,
    error: graphError,
  } = useStateGraph(projectId, workflowId);

  const { data: trends, isLoading: isTrendsLoading } =
    useCoverageTrends(projectId);

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!graphData) {
      return null;
    }

    // Calculate state coverage
    const coveredStates = graphData.nodes.filter(
      (node) => node.visit_count > 0
    ).length;
    const totalStates = graphData.nodes.length;
    const stateCoveragePercentage =
      totalStates > 0 ? (coveredStates / totalStates) * 100 : 0;

    // Calculate transition coverage
    const coveredTransitions = graphData.edges.filter(
      (edge) => edge.attempt_count > 0
    ).length;
    const totalTransitions = graphData.edges.length;
    const transitionCoveragePercentage =
      totalTransitions > 0 ? (coveredTransitions / totalTransitions) * 100 : 0;

    // Count unique paths (approximate by counting distinct edge combinations)
    const uniquePaths = new Set(
      graphData.edges.map((edge) => `${edge.source}->${edge.target}`)
    ).size;

    // Total executions
    const totalExecutions = graphData.edges.reduce(
      (sum, edge) => sum + edge.attempt_count,
      0
    );

    return {
      stateCoverage: stateCoveragePercentage,
      transitionCoverage: transitionCoveragePercentage,
      uniquePaths,
      totalExecutions,
      coveredStates,
      totalStates,
      coveredTransitions,
      totalTransitions,
    };
  }, [graphData]);

  // Calculate trend from coverage trends
  const trend = useMemo(() => {
    if (!trends || trends.length < 2) {
      return { direction: "stable" as const, change: 0 };
    }

    const latest = trends[trends.length - 1];
    const previous = trends[trends.length - 2];

    if (!latest || !previous) {
      return { direction: "stable" as const, change: 0 };
    }

    const change = latest.coverage_percentage - previous.coverage_percentage;

    return {
      direction:
        change > 0.5
          ? ("up" as const)
          : change < -0.5
            ? ("down" as const)
            : ("stable" as const),
      change,
    };
  }, [trends]);

  // Calculate mini sparkline data
  const sparklineData = useMemo(() => {
    if (!trends || trends.length === 0) return [];
    // Take last 10 data points for sparkline
    return trends.slice(-10).map((t) => t.coverage_percentage);
  }, [trends]);

  if (isGraphLoading || isTrendsLoading) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">Loading coverage summary...</div>
        </CardContent>
      </Card>
    );
  }

  if (graphError) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-red-400">
            Error loading coverage summary: {graphError.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!metrics) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardHeader>
          <CardTitle>Coverage Summary</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">No coverage data available</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Coverage Summary</CardTitle>
          <div className="flex items-center gap-2">
            {trend.direction === "up" && (
              <div className="flex items-center gap-1 text-green-500">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs font-medium">
                  +{trend.change.toFixed(1)}%
                </span>
              </div>
            )}
            {trend.direction === "down" && (
              <div className="flex items-center gap-1 text-red-500">
                <TrendingDown className="w-4 h-4" />
                <span className="text-xs font-medium">
                  {trend.change.toFixed(1)}%
                </span>
              </div>
            )}
            {trend.direction === "stable" && (
              <div className="flex items-center gap-1 text-gray-500">
                <Minus className="w-4 h-4" />
                <span className="text-xs font-medium">Stable</span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* State Coverage */}
          <div className="p-4 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-2">State Coverage</div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-[#00D9FF]">
                {metrics.stateCoverage.toFixed(1)}%
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {metrics.coveredStates} / {metrics.totalStates} states
            </div>
            <div className="mt-3 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#00D9FF] transition-all duration-300"
                style={{ width: `${metrics.stateCoverage}%` }}
              />
            </div>
          </div>

          {/* Transition Coverage */}
          <div className="p-4 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-2">
              Transition Coverage
            </div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-[#BD00FF]">
                {metrics.transitionCoverage.toFixed(1)}%
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {metrics.coveredTransitions} / {metrics.totalTransitions}{" "}
              transitions
            </div>
            <div className="mt-3 h-2 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-[#BD00FF] transition-all duration-300"
                style={{ width: `${metrics.transitionCoverage}%` }}
              />
            </div>
          </div>

          {/* Unique Paths */}
          <div className="p-4 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-2">Unique Paths</div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-[#00FF88]">
                {metrics.uniquePaths}
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Distinct state transitions
            </div>
          </div>

          {/* Total Executions */}
          <div className="p-4 bg-[#0A0A0B]/50 rounded-lg">
            <div className="text-sm text-gray-400 mb-2">Total Executions</div>
            <div className="flex items-baseline gap-2">
              <div className="text-3xl font-bold text-[#FFB800]">
                {metrics.totalExecutions}
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Transition attempts
            </div>
          </div>
        </div>

        {/* Sparkline */}
        {sparklineData.length > 0 && (
          <div className="mt-6">
            <div className="text-sm text-gray-400 mb-2">Coverage Trend</div>
            <div className="h-16 flex items-end gap-1">
              {sparklineData.map((value, index) => {
                const height = (value / 100) * 100;
                const isLatest = index === sparklineData.length - 1;
                return (
                  <div
                    key={index}
                    className={`flex-1 rounded-t transition-all duration-300 ${
                      isLatest ? "bg-[#00D9FF]" : "bg-[#00D9FF]/40"
                    }`}
                    style={{ height: `${height}%` }}
                    title={`${value.toFixed(1)}%`}
                  />
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-2">
              <span>10 runs ago</span>
              <span>Latest</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
