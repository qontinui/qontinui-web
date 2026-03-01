"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, TrendingUp } from "lucide-react";
import type { CoverageUpdate } from "@/hooks/useTestStream";

interface CoverageHeatmapProps {
  coverage: CoverageUpdate | null;
  allStates?: string[];
}

const DEFAULT_ALL_STATES: string[] = [];

export function CoverageHeatmap({
  coverage,
  allStates = DEFAULT_ALL_STATES,
}: CoverageHeatmapProps) {
  const heatmapData = useMemo(() => {
    if (!coverage) {
      return {
        covered: [],
        uncovered: allStates.map((state) => ({
          name: state,
          status: "untested" as const,
        })),
        recentlyCovered: [],
      };
    }

    const coveredStates = allStates
      .filter((state) => !coverage.uncoveredStates.includes(state))
      .map((state) => ({
        name: state,
        status: coverage.newlyCoveredStates.includes(state)
          ? ("new" as const)
          : ("covered" as const),
      }));

    const uncoveredStates = coverage.uncoveredStates.map((state) => ({
      name: state,
      status: "untested" as const,
    }));

    return {
      covered: coveredStates,
      uncovered: uncoveredStates,
      recentlyCovered: coverage.newlyCoveredStates,
    };
  }, [coverage, allStates]);

  const getStateColor = (status: "covered" | "new" | "untested") => {
    switch (status) {
      case "covered":
        return "bg-green-500/30 border-green-500/50 hover:bg-green-500/40";
      case "new":
        return "bg-brand-primary/30 border-brand-primary/50 hover:bg-brand-primary/40 animate-pulse";
      case "untested":
        return "bg-border-default/20 border-border-default/40 hover:bg-border-default/30";
    }
  };

  const getStateIcon = (status: "covered" | "new" | "untested") => {
    switch (status) {
      case "covered":
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />;
      case "new":
        return <CheckCircle2 className="w-3.5 h-3.5 text-brand-primary" />;
      case "untested":
        return <Circle className="w-3.5 h-3.5 text-text-muted" />;
    }
  };

  const stats = useMemo(() => {
    if (!coverage) {
      return {
        totalStates: allStates.length,
        coveredCount: 0,
        uncoveredCount: allStates.length,
        newCount: 0,
        coveragePercent: 0,
      };
    }

    return {
      totalStates: coverage.totalStates,
      coveredCount: coverage.statesCovered,
      uncoveredCount: coverage.uncoveredStates.length,
      newCount: coverage.newlyCoveredStates.length,
      coveragePercent: coverage.coveragePercentage,
    };
  }, [coverage, allStates]);

  if (!coverage && allStates.length === 0) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardHeader>
          <CardTitle className="text-lg">State Coverage</CardTitle>
        </CardHeader>
        <CardContent className="p-12 text-center">
          <Circle className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <div className="text-text-muted">Waiting for coverage data...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">State Coverage</CardTitle>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-brand-primary" />
            <span className="text-2xl font-bold text-brand-primary">
              {stats.coveragePercent.toFixed(1)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Overall progress */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Overall Progress</span>
            <span className="text-white font-medium">
              {stats.coveredCount} / {stats.totalStates} states
            </span>
          </div>
          <Progress
            value={stats.coveragePercent}
            className="h-3 bg-surface-raised"
          />

          {/* Stats breakdown */}
          <div className="grid grid-cols-3 gap-3 pt-2">
            <div className="bg-green-500/10 rounded-lg p-3 border border-green-500/30">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-xs text-text-muted">Covered</span>
              </div>
              <div className="text-xl font-bold text-green-500">
                {stats.coveredCount}
              </div>
            </div>

            {stats.newCount > 0 && (
              <div className="bg-brand-primary/10 rounded-lg p-3 border border-brand-primary/30">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-4 h-4 text-brand-primary" />
                  <span className="text-xs text-text-muted">New</span>
                </div>
                <div className="text-xl font-bold text-brand-primary">
                  {stats.newCount}
                </div>
              </div>
            )}

            <div className="bg-border-default/10 rounded-lg p-3 border border-border-default/30">
              <div className="flex items-center gap-2 mb-1">
                <Circle className="w-4 h-4 text-text-muted" />
                <span className="text-xs text-text-muted">Untested</span>
              </div>
              <div className="text-xl font-bold text-text-muted">
                {stats.uncoveredCount}
              </div>
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-text-muted border-t border-border-subtle pt-4">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-green-500/30 border border-green-500/50" />
            <span>Covered</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-brand-primary/30 border border-brand-primary/50" />
            <span>Recently Covered</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-border-default/20 border border-border-default/40" />
            <span>Not Tested</span>
          </div>
        </div>

        {/* State grid */}
        <div className="space-y-4">
          {/* Covered states */}
          {heatmapData.covered.length > 0 && (
            <div>
              <div className="text-xs text-text-muted mb-2 font-medium">
                Covered States ({heatmapData.covered.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {heatmapData.covered.map((state) => (
                  <div
                    key={state.name}
                    className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-all ${getStateColor(state.status)} flex items-center gap-1.5`}
                  >
                    {getStateIcon(state.status)}
                    <span className="text-white">{state.name}</span>
                    {state.status === "new" && (
                      <Badge className="ml-1 px-1.5 py-0 text-[10px] bg-brand-primary text-black border-none">
                        NEW
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Uncovered states */}
          {heatmapData.uncovered.length > 0 && (
            <div>
              <div className="text-xs text-text-muted mb-2 font-medium">
                Untested States ({heatmapData.uncovered.length})
              </div>
              <div className="flex flex-wrap gap-2">
                {heatmapData.uncovered.map((state) => (
                  <div
                    key={state.name}
                    className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-all ${getStateColor(state.status)} flex items-center gap-1.5`}
                  >
                    {getStateIcon(state.status)}
                    <span className="text-text-muted">{state.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Empty state */}
        {heatmapData.covered.length === 0 &&
          heatmapData.uncovered.length === 0 && (
            <div className="text-center py-8 text-text-muted">
              No state data available yet
            </div>
          )}
      </CardContent>
    </Card>
  );
}
