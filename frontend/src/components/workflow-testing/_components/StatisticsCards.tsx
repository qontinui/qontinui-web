"use client";

import {
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Calendar,
  BarChart3,
  FileText,
} from "lucide-react";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { TestStatistics } from "@/services/workflow-testing-service";
import type { Trend } from "../test-results-types";

interface StatisticsCardsProps {
  statistics: TestStatistics;
  trend: Trend;
}

export function StatisticsCards({ statistics, trend }: StatisticsCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Total Runs */}
      <Card>
        <CardHeader className="pb-3">
          <CardDescription className="flex items-center gap-2">
            <FileText className="size-4" />
            Total Runs
          </CardDescription>
          <CardTitle className="text-3xl">{statistics.totalRuns}</CardTitle>
        </CardHeader>
      </Card>

      {/* Pass Rate */}
      <Card>
        <CardHeader className="pb-3">
          <CardDescription className="flex items-center gap-2">
            <BarChart3 className="size-4" />
            Pass Rate
          </CardDescription>
          <CardTitle className="text-3xl flex items-center gap-2">
            {statistics.passRate.toFixed(0)}%
            {trend === "improving" && (
              <TrendingUp className="size-5 text-green-500" />
            )}
            {trend === "declining" && (
              <TrendingDown className="size-5 text-red-500" />
            )}
            {trend === "stable" && (
              <Minus className="size-5 text-muted-foreground" />
            )}
          </CardTitle>
        </CardHeader>
        <CardFooter>
          <div className="text-xs text-muted-foreground">
            {statistics.successfulRuns} passed, {statistics.failedRuns} failed
          </div>
        </CardFooter>
      </Card>

      {/* Average Duration */}
      <Card>
        <CardHeader className="pb-3">
          <CardDescription className="flex items-center gap-2">
            <Clock className="size-4" />
            Avg Duration
          </CardDescription>
          <CardTitle className="text-3xl">
            {(statistics.avgDuration / 1000).toFixed(2)}s
          </CardTitle>
        </CardHeader>
        <CardFooter>
          <div className="text-xs text-muted-foreground">
            Min: {(statistics.minDuration / 1000).toFixed(2)}s, Max:{" "}
            {(statistics.maxDuration / 1000).toFixed(2)}s
          </div>
        </CardFooter>
      </Card>

      {/* Last Run */}
      <Card>
        <CardHeader className="pb-3">
          <CardDescription className="flex items-center gap-2">
            <Calendar className="size-4" />
            Last Run
          </CardDescription>
          <CardTitle className="text-lg">
            {statistics.lastRun
              ? new Date(statistics.lastRun).toLocaleString()
              : "Never"}
          </CardTitle>
        </CardHeader>
        <CardFooter>
          {statistics.lastPassed !== undefined && (
            <Badge
              variant={statistics.lastPassed ? "default" : "destructive"}
              className="w-fit"
            >
              {statistics.lastPassed ? "Passed" : "Failed"}
            </Badge>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
