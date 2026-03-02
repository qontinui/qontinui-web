import React from "react";
import {
  LineChart,
  Line,
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
import { CHART_COLORS, formatDuration } from "../workflow-metrics-panel-utils";
import type {
  PerformanceTrendDataPoint,
  SuccessRateTrendDataPoint,
} from "../workflow-metrics-panel-types";

interface PerformanceTrendsTabProps {
  performanceTrendData: PerformanceTrendDataPoint[];
  successRateTrendData: SuccessRateTrendDataPoint[];
}

export function PerformanceTrendsTab({
  performanceTrendData,
  successRateTrendData,
}: PerformanceTrendsTabProps) {
  return (
    <>
      {/* Duration Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Duration Over Time</CardTitle>
          <CardDescription>Last 20 executions</CardDescription>
        </CardHeader>
        <CardContent>
          {performanceTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={performanceTrendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="run" />
                <YAxis
                  tickFormatter={(value) => formatDuration(Number(value))}
                />
                <Tooltip
                  formatter={(value) => formatDuration(Number(value))}
                  labelFormatter={(label) => `Run ${label}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="duration"
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  name="Duration"
                  dot={{ r: 3 }}
                />
                <Line
                  type="monotone"
                  dataKey="avgDuration"
                  stroke={CHART_COLORS.warning}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  name="Average"
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-muted-foreground">
              Insufficient data for trend analysis
            </div>
          )}
        </CardContent>
      </Card>

      {/* Success Rate Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Success Rate Trend</CardTitle>
          <CardDescription>Success rate over execution batches</CardDescription>
        </CardHeader>
        <CardContent>
          {successRateTrendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={successRateTrendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="run" />
                <YAxis domain={[0, 100]} />
                <Tooltip
                  formatter={(value) => `${Number(value).toFixed(1)}%`}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="successRate"
                  stroke={CHART_COLORS.success}
                  fill={CHART_COLORS.success}
                  fillOpacity={0.3}
                  name="Success Rate %"
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[250px] flex items-center justify-center text-muted-foreground">
              Insufficient data for trend analysis
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
