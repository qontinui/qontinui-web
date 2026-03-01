"use client";

import React from "react";
import { Repeat } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { LoopAnalysis } from "../performance-analyzer-types";
import { formatDuration } from "../performance-analyzer-utils";

interface LoopAnalysisTabProps {
  loopAnalysis: LoopAnalysis[];
}

export function LoopAnalysisTab({ loopAnalysis }: LoopAnalysisTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Repeat className="h-5 w-5" />
          Loop Performance Analysis
        </CardTitle>
        <CardDescription>
          Optimize loop iterations and execution
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loopAnalysis.length > 0 ? (
          <div className="space-y-3">
            {loopAnalysis.map((loop) => (
              <div
                key={loop.actionId}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{loop.actionName}</span>
                  <Badge variant="secondary">
                    {loop.estimatedIterations} iterations
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="text-muted-foreground">Avg Iteration</div>
                    <div className="font-bold">
                      {formatDuration(loop.avgIterationDuration)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Total Duration</div>
                    <div className="font-bold">
                      {formatDuration(loop.totalDuration)}
                    </div>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground">
                  {loop.suggestion}
                </p>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Potential savings:
                  </span>
                  <span className="font-bold text-green-500">
                    {formatDuration(loop.potentialSavings)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No LOOP actions found in this workflow
          </div>
        )}
      </CardContent>
    </Card>
  );
}
