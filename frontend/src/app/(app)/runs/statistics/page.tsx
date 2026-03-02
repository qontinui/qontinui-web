"use client";

import { useState } from "react";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./statistics.spec.uibridge.json";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, RefreshCw } from "lucide-react";
import { useStatistics } from "./_hooks/useStatistics";
import { SummaryCards } from "./_components/SummaryCards";
import { StatusBreakdown } from "./_components/StatusBreakdown";
import { DurationExtremes } from "./_components/DurationExtremes";
import { RecentRunsTable } from "./_components/RecentRunsTable";
import { PerformanceView } from "./_components/PerformanceView";

const pageSpec = pageSpecJson as unknown as SpecConfig;

export default function StatisticsPage() {
  usePageSpecs({ statistics: pageSpec });
  const { runs, stats, isLoading, error, isRunnerOffline, refetch } =
    useStatistics();

  const [viewMode, setViewMode] = useState<"overview" | "performance">(
    "overview"
  );

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Statistics</h1>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <p className="text-muted-foreground text-sm">
          Performance analytics computed from recent task runs.
        </p>

        {isRunnerOffline && <RunnerPartialState />}

        <div className="flex items-center gap-2">
          <Button
            variant={viewMode === "overview" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("overview")}
            className={
              viewMode === "overview"
                ? "bg-primary text-primary-foreground"
                : ""
            }
          >
            Overview
          </Button>
          <Button
            variant={viewMode === "performance" ? "default" : "outline"}
            size="sm"
            onClick={() => setViewMode("performance")}
            className={
              viewMode === "performance"
                ? "bg-primary text-primary-foreground"
                : ""
            }
          >
            Performance
          </Button>
        </div>

        {isLoading ? (
          <div className="text-center py-16 text-muted-foreground">
            <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
            Computing statistics...
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-400">
            Error loading data: {error?.message ?? "Unknown error"}
          </div>
        ) : !stats ? (
          <Card className="bg-muted border-border">
            <CardContent className="py-16">
              <div className="text-center text-muted-foreground">
                <BarChart3 className="size-16 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-muted-foreground mb-2">
                  No Data Available
                </h3>
                <p className="text-sm">
                  Run some tasks in the Runner to see performance statistics.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {viewMode === "overview" && (
              <>
                <SummaryCards stats={stats} />
                <StatusBreakdown stats={stats} />
                <DurationExtremes stats={stats} />
                <RecentRunsTable runs={runs || []} stats={stats} />
              </>
            )}

            {viewMode === "performance" && <PerformanceView stats={stats} />}
          </>
        )}
      </main>
    </div>
  );
}
