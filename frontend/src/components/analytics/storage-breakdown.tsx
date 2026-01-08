"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

interface StorageBreakdownProps {
  data: {
    avatars: number;
    images: number;
    screenshots: number;
    exports: number;
  };
}

const COLORS = {
  avatars: "var(--color-brand-primary)",
  images: "var(--color-brand-secondary)",
  screenshots: "var(--color-brand-success)",
  exports: "#FFB800",
};

export function StorageBreakdown({ data }: StorageBreakdownProps) {
  const chartData = [
    { name: "Avatars", value: data.avatars, color: COLORS.avatars },
    { name: "Images", value: data.images, color: COLORS.images },
    { name: "Screenshots", value: data.screenshots, color: COLORS.screenshots },
    { name: "Exports", value: data.exports, color: COLORS.exports },
  ].filter((item) => item.value > 0);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const totalStorage = Object.values(data).reduce((acc, val) => acc + val, 0);

  return (
    <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="text-lg">Storage Breakdown</CardTitle>
        <p className="text-sm text-text-muted">
          Total: {formatBytes(totalStorage)}
        </p>
      </CardHeader>
      <CardContent>
        {chartData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                  label={({ name, percent }) =>
                    `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                >
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--surface-raised))",
                    border: "1px solid hsl(var(--border-subtle))",
                    borderRadius: "8px",
                    color: "#fff",
                  }}
                  formatter={(value) => formatBytes(Number(value))}
                />
              </PieChart>
            </ResponsiveContainer>

            <div className="grid grid-cols-2 gap-4 mt-6">
              {chartData.map((item) => (
                <div key={item.name} className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <div className="flex-1">
                    <p className="text-sm text-text-muted">{item.name}</p>
                    <p className="text-sm font-semibold">
                      {formatBytes(item.value)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="h-64 flex items-center justify-center text-text-muted">
            No storage data available
          </div>
        )}
      </CardContent>
    </Card>
  );
}
