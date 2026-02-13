"use client";

import { Progress } from "@/components/ui/progress";
import {
  ResponsiveContainer,
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import type { ProjectData } from "../_lib/types";

interface StorageAnalysisProps {
  stats: ProjectData["storageStats"];
}

export function StorageAnalysis({ stats }: StorageAnalysisProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-sm text-text-muted mb-1">Total Storage Used</p>
        <p className="text-3xl font-bold text-brand-primary">
          {stats.totalSize.toFixed(1)} MB
        </p>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <RechartsPieChart>
          <Pie
            data={stats.byType}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={3}
            dataKey="size"
          >
            {stats.byType.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.fill} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--surface-raised)",
              border: "1px solid var(--border-default)",
              borderRadius: "8px",
            }}
            formatter={(value) => `${Number(value).toFixed(1)} MB`}
          />
        </RechartsPieChart>
      </ResponsiveContainer>

      <div className="space-y-3">
        {stats.byType.map((item) => (
          <div key={item.type}>
            <div className="flex items-center justify-between mb-2 text-sm">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded"
                  style={{ backgroundColor: item.fill }}
                />
                <span className="text-text-muted">{item.type}</span>
              </div>
              <div className="text-right">
                <span className="font-medium">{item.size.toFixed(1)} MB</span>
                <span className="text-xs text-text-muted ml-2">
                  ({item.count})
                </span>
              </div>
            </div>
            <Progress
              value={(item.size / stats.totalSize) * 100}
              className="h-2"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
