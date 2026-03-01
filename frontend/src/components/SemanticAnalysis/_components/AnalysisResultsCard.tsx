"use client";

import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SemanticScene } from "@/types/semantic-analysis";
import { typeColors, countObjectsByType } from "../semantic-analysis-utils";

interface AnalysisResultsCardProps {
  scene: SemanticScene;
}

export function AnalysisResultsCard({ scene }: AnalysisResultsCardProps) {
  const objectCounts = countObjectsByType(scene.objects);

  return (
    <Card className="bg-surface-raised/50 border-border-default">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Analysis Results</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-text-muted">Total Objects</span>
          <span className="font-bold">{scene.object_count}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-text-muted">Timestamp</span>
          <span>{new Date(scene.timestamp).toLocaleTimeString()}</span>
        </div>
        <div className="space-y-1 mt-3">
          {Object.entries(objectCounts).map(([type, count]) => (
            <div key={type} className="flex justify-between text-xs">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded"
                  style={{
                    backgroundColor: typeColors[type] || typeColors.default,
                  }}
                />
                <span className="capitalize">{type}</span>
              </div>
              <span>{count}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
