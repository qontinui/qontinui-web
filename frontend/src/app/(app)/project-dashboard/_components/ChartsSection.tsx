"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { Activity, Calendar } from "lucide-react";
import type { ProjectData } from "../_lib/types";

const TOOLTIP_STYLE = {
  backgroundColor: "var(--surface-raised)",
  border: "1px solid var(--border-default)",
  borderRadius: "8px",
};

interface ActivityTimelineChartProps {
  timelineData: ProjectData["timelineData"];
}

export function ActivityTimelineChart({
  timelineData,
}: ActivityTimelineChartProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-brand-primary" />
          Project Activity Timeline
        </CardTitle>
        <CardDescription>
          Resource changes over the last 30 days
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <AreaChart data={timelineData}>
            <defs>
              <linearGradient id="colorWorkflows" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--brand-primary)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor="var(--brand-primary)"
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient id="colorStates" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--brand-secondary)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor="var(--brand-secondary)"
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient id="colorImages" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--brand-success)"
                  stopOpacity={0.3}
                />
                <stop
                  offset="95%"
                  stopColor="var(--brand-success)"
                  stopOpacity={0}
                />
              </linearGradient>
              <linearGradient id="colorTransitions" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--warning)"
                  stopOpacity={0.3}
                />
                <stop offset="95%" stopColor="var(--warning)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="date" stroke="#666" style={{ fontSize: "10px" }} />
            <YAxis stroke="#666" style={{ fontSize: "10px" }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend />
            <Area
              type="monotone"
              dataKey="workflows"
              stroke="var(--brand-primary)"
              fill="url(#colorWorkflows)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="states"
              stroke="var(--brand-secondary)"
              fill="url(#colorStates)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="images"
              stroke="var(--brand-success)"
              fill="url(#colorImages)"
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="transitions"
              stroke="var(--warning)"
              fill="url(#colorTransitions)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

interface ActivityLineChartProps {
  timelineData: ProjectData["timelineData"];
}

export function ActivityLineChart({ timelineData }: ActivityLineChartProps) {
  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-brand-secondary" />
          Activity Chart
        </CardTitle>
        <CardDescription>Activity over time</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={timelineData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis dataKey="date" stroke="#666" style={{ fontSize: "10px" }} />
            <YAxis stroke="#666" style={{ fontSize: "10px" }} />
            <Tooltip contentStyle={TOOLTIP_STYLE} />
            <Legend />
            <Line
              type="monotone"
              dataKey="workflows"
              stroke="var(--brand-primary)"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="states"
              stroke="var(--brand-secondary)"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="images"
              stroke="var(--brand-success)"
              strokeWidth={2}
            />
            <Line
              type="monotone"
              dataKey="transitions"
              stroke="var(--warning)"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
