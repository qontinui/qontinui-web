import React from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WorkflowMetrics } from "@/services/workflow-analytics-service";
import { formatDuration } from "../analytics-dashboard-utils";
import type {
  TimelineDataPoint,
  SuccessRateDataPoint,
  DurationDataPoint,
} from "../analytics-dashboard-types";

interface ChartTabsProps {
  timelineData: TimelineDataPoint[];
  successRateData: SuccessRateDataPoint[];
  durationData: DurationDataPoint[];
  mostExecuted: WorkflowMetrics[];
}

export function ChartTabs({
  timelineData,
  successRateData,
  durationData,
  mostExecuted,
}: ChartTabsProps) {
  return (
    <Tabs defaultValue="timeline" className="space-y-4">
      <TabsList>
        <TabsTrigger value="timeline">Execution Timeline</TabsTrigger>
        <TabsTrigger value="success">Success Rates</TabsTrigger>
        <TabsTrigger value="duration">Duration Analysis</TabsTrigger>
        <TabsTrigger value="usage">Usage Patterns</TabsTrigger>
      </TabsList>

      <TabsContent value="timeline" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Execution Timeline</CardTitle>
            <CardDescription>Workflow executions over time</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="executions"
                  stroke="#3b82f6"
                  name="Total"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="success"
                  stroke="#10b981"
                  name="Success"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="failed"
                  stroke="#ef4444"
                  name="Failed"
                  strokeWidth={2}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="success" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Success Rate by Workflow</CardTitle>
            <CardDescription>
              Top 10 workflows by execution count
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={successRateData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" domain={[0, 100]} />
                <YAxis type="category" dataKey="name" width={150} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="successRate"
                  fill="#10b981"
                  name="Success Rate %"
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="duration" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Average Duration by Workflow</CardTitle>
            <CardDescription>Top 10 slowest workflows</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={durationData} layout="horizontal">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={150} />
                <Tooltip
                  formatter={(value) => formatDuration(Number(value))}
                  labelFormatter={(label) => `Workflow: ${label}`}
                />
                <Legend />
                <Bar dataKey="duration" fill="#3b82f6" name="Avg Duration" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="usage" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Workflow Usage Distribution</CardTitle>
            <CardDescription>Most and least used workflows</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={mostExecuted}
                layout="horizontal"
                margin={{ left: 100 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis
                  type="category"
                  dataKey="workflowName"
                  width={150}
                  tick={{ fontSize: 12 }}
                />
                <Tooltip />
                <Bar
                  dataKey="totalExecutions"
                  fill="#8b5cf6"
                  name="Executions"
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
