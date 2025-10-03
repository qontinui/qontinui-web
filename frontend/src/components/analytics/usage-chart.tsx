"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";

interface UsageChartProps {
  data: Array<{
    date: string;
    api_calls: number;
  }>;
}

export function UsageChart({ data }: UsageChartProps) {
  // Format data for chart
  const chartData = data.map((item) => ({
    name: new Date(item.date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    value: item.api_calls,
  }));

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">API Usage Over Time</CardTitle>
        <p className="text-sm text-gray-400">Last 7 days</p>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00D9FF" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00D9FF" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#333" />
            <XAxis
              dataKey="name"
              stroke="#666"
              style={{ fontSize: "12px" }}
            />
            <YAxis stroke="#666" style={{ fontSize: "12px" }} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1A1A1B",
                border: "1px solid #333",
                borderRadius: "8px",
                color: "#fff",
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke="#00D9FF"
              strokeWidth={2}
              fill="url(#colorValue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
