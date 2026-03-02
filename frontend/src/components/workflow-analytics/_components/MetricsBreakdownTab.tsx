import React from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { WorkflowMetrics } from "@/services/workflow-analytics-service";
import {
  formatDuration,
  formatPercentage,
  formatRelativeTime,
} from "../workflow-metrics-panel-utils";
import type { BreakdownDataPoint } from "../workflow-metrics-panel-types";

interface MetricsBreakdownTabProps {
  metrics: WorkflowMetrics;
  breakdownData: BreakdownDataPoint[];
}

export function MetricsBreakdownTab({
  metrics,
  breakdownData,
}: MetricsBreakdownTabProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Success/Failure Pie Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Success vs Failure</CardTitle>
          <CardDescription>Execution outcome distribution</CardDescription>
        </CardHeader>
        <CardContent>
          {metrics.totalExecutions > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={breakdownData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value, percent }) =>
                    `${name}: ${value} (${((percent ?? 0) * 100).toFixed(0)}%)`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {breakdownData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-muted-foreground">
              No execution data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Statistics Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Statistics Summary</CardTitle>
          <CardDescription>Key performance indicators</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Success Rate</span>
              <span className="font-medium">
                {formatPercentage(metrics.successRate)}
              </span>
            </div>
            <Progress value={metrics.successRate * 100} className="h-2" />
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Min Duration</span>
              <span className="font-medium">
                {formatDuration(metrics.minDuration)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Avg Duration</span>
              <span className="font-medium">
                {formatDuration(metrics.avgDuration)}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Max Duration</span>
              <span className="font-medium">
                {formatDuration(metrics.maxDuration)}
              </span>
            </div>
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Executions</span>
              <span className="font-medium">{metrics.totalExecutions}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Successful</span>
              <span className="font-medium text-green-500">
                {metrics.successfulExecutions}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Failed</span>
              <span className="font-medium text-red-500">
                {metrics.failedExecutions}
              </span>
            </div>
          </div>

          {metrics.firstExecuted && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">First Run</span>
                  <span className="font-medium">
                    {formatRelativeTime(metrics.firstExecuted)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Last Run</span>
                  <span className="font-medium">
                    {metrics.lastExecuted
                      ? formatRelativeTime(metrics.lastExecuted)
                      : "Never"}
                  </span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
