import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Stats } from "../types";
import { formatDuration } from "../types";

interface PerformanceViewProps {
  stats: Stats;
}

const TIME_RANGES = ["1h", "24h", "7d", "30d", "all"] as const;

export function PerformanceView({ stats }: PerformanceViewProps) {
  const [timeRange, setTimeRange] = useState("all");

  return (
    <>
      <div className="flex gap-1">
        {TIME_RANGES.map((range) => (
          <Button
            key={range}
            variant={timeRange === range ? "default" : "outline"}
            size="sm"
            onClick={() => setTimeRange(range)}
            className={`text-xs ${
              timeRange === range
                ? "bg-primary text-primary-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            {range}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <Card className="bg-muted border-border">
          <CardContent className="pt-6 text-center">
            <div
              className="text-3xl font-bold text-foreground"
              data-content-role="metric"
              data-content-label="perf-total-executions"
            >
              {stats.totalRuns}
            </div>
            <div
              className="text-xs text-muted-foreground mt-1"
              data-content-role="label"
            >
              Total Executions
            </div>
          </CardContent>
        </Card>
        <Card className="bg-muted border-border">
          <CardContent className="pt-6 text-center">
            <div
              className="text-3xl font-bold text-green-500"
              data-content-role="metric"
              data-content-label="perf-success-rate"
            >
              {stats.successRate.toFixed(0)}%
            </div>
            <div
              className="text-xs text-muted-foreground mt-1"
              data-content-role="label"
            >
              Success Rate
            </div>
          </CardContent>
        </Card>
        <Card className="bg-muted border-border">
          <CardContent className="pt-6 text-center">
            <div
              className="text-3xl font-bold text-foreground"
              data-content-role="metric"
              data-content-label="perf-avg-duration"
            >
              {formatDuration(stats.avgDuration)}
            </div>
            <div
              className="text-xs text-muted-foreground mt-1"
              data-content-role="label"
            >
              Avg Duration
            </div>
          </CardContent>
        </Card>
        <Card className="bg-muted border-border">
          <CardContent className="pt-6 text-center">
            <div
              className="text-3xl font-bold text-foreground"
              data-content-role="metric"
              data-content-label="perf-total-time"
            >
              {formatDuration(stats.totalDuration)}
            </div>
            <div
              className="text-xs text-muted-foreground mt-1"
              data-content-role="label"
            >
              Total Time
            </div>
          </CardContent>
        </Card>
        <Card className="bg-muted border-border">
          <CardContent className="pt-6 text-center">
            <div
              className="text-3xl font-bold text-blue-500"
              data-content-role="metric"
              data-content-label="perf-currently-running"
            >
              {stats.runningRuns}
            </div>
            <div
              className="text-xs text-muted-foreground mt-1"
              data-content-role="label"
            >
              Currently Running
            </div>
          </CardContent>
        </Card>
        <Card className="bg-muted border-border">
          <CardContent className="pt-6 text-center">
            <div
              className="text-3xl font-bold text-red-500"
              data-content-role="metric"
              data-content-label="perf-failed-runs"
            >
              {stats.failedRuns}
            </div>
            <div
              className="text-xs text-muted-foreground mt-1"
              data-content-role="label"
            >
              Failed Runs
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
