"use client";

import React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
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
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import type {
  Bottleneck,
  HeatmapDataPoint,
} from "../performance-analyzer-types";
import {
  formatDuration,
  formatPercentage,
  getSeverityColor,
} from "../performance-analyzer-utils";

interface BottlenecksTabProps {
  heatmapData: HeatmapDataPoint[];
  bottlenecks: Bottleneck[];
}

export function BottlenecksTab({
  heatmapData,
  bottlenecks,
}: BottlenecksTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Action Timing Heatmap</CardTitle>
          <CardDescription>
            Actions consuming the most time (red = high, yellow = medium, green
            = low)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={heatmapData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
              <YAxis tickFormatter={formatDuration} />
              <Tooltip formatter={(value) => formatDuration(Number(value))} />
              <Bar dataKey="duration" radius={[8, 8, 0, 0]}>
                {heatmapData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Bottlenecks</CardTitle>
          <CardDescription>
            Actions taking the most execution time
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {bottlenecks.map((bottleneck, index) => (
                <div key={bottleneck.actionId} className="space-y-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">
                          #{index + 1}
                        </span>
                        <span className="text-sm font-medium">
                          {bottleneck.actionName}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {bottleneck.actionType}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        {formatPercentage(bottleneck.percentOfTotal)} of total
                        execution time
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold">
                        {formatDuration(bottleneck.duration)}
                      </div>
                      <Badge
                        variant="outline"
                        className="text-xs mt-1"
                        style={{
                          borderColor: getSeverityColor(bottleneck.severity),
                        }}
                      >
                        {bottleneck.severity}
                      </Badge>
                    </div>
                  </div>
                  <Progress
                    value={bottleneck.percentOfTotal}
                    className="h-2"
                    style={{
                      background: `linear-gradient(to right, ${getSeverityColor(bottleneck.severity)} ${bottleneck.percentOfTotal}%, transparent ${bottleneck.percentOfTotal}%)`,
                    }}
                  />
                  {index < bottlenecks.length - 1 && (
                    <Separator className="mt-3" />
                  )}
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
