import React from "react";
import { CheckCircle, XCircle } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TestResult } from "@/services/workflow-testing-service";
import {
  CHART_COLORS,
  formatDuration,
  formatRelativeTime,
} from "../workflow-metrics-panel-utils";
import type { TimelineDataPoint } from "../workflow-metrics-panel-types";

interface ExecutionHistoryTabProps {
  timelineData: TimelineDataPoint[];
  recentRuns: TestResult[];
  executionHistoryLength: number;
}

export function ExecutionHistoryTab({
  timelineData,
  recentRuns,
  executionHistoryLength,
}: ExecutionHistoryTabProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Timeline Chart */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Execution Timeline</CardTitle>
          <CardDescription>Last 30 execution runs</CardDescription>
        </CardHeader>
        <CardContent>
          {timelineData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="index" />
                <YAxis />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === "duration")
                      return formatDuration(Number(value));
                    return value;
                  }}
                  labelFormatter={(label) => `Run #${label}`}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="duration"
                  stroke={CHART_COLORS.primary}
                  fill={CHART_COLORS.primary}
                  fillOpacity={0.3}
                  name="Duration (ms)"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex items-center justify-center text-muted-foreground">
              No execution history available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Runs List */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>Last 10 executions</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {recentRuns.map((result, index) => (
                <div
                  key={result.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent"
                >
                  <div className="flex items-center gap-3 flex-1">
                    {result.passed ? (
                      <CheckCircle className="h-4 w-4 text-green-500" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-500" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          Run #{executionHistoryLength - index}
                        </span>
                        <Badge
                          variant={result.passed ? "default" : "destructive"}
                          className="text-xs"
                        >
                          {result.passed ? "Success" : "Failed"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatRelativeTime(result.startTime)} •{" "}
                        {formatDuration(result.duration)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
              {recentRuns.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No execution history available
                </p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
