"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration } from "../performance-analyzer-utils";

interface SummaryCardsProps {
  totalDuration: number;
  estimatedOptimizedDuration: number;
  totalPotentialSavings: number;
  bottleneckCount: number;
}

export function SummaryCards({
  totalDuration,
  estimatedOptimizedDuration,
  totalPotentialSavings,
  bottleneckCount,
}: SummaryCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Current Duration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {formatDuration(totalDuration)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Optimized Duration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-green-500">
            {formatDuration(estimatedOptimizedDuration)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Potential Savings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-blue-500">
            {formatDuration(totalPotentialSavings)}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Bottlenecks Found
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{bottleneckCount}</div>
        </CardContent>
      </Card>
    </div>
  );
}
