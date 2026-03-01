"use client";

import React from "react";
import { Clock } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { WaitAnalysis } from "../performance-analyzer-types";
import { formatDuration } from "../performance-analyzer-utils";

interface WaitAnalysisTabProps {
  waitAnalysis: WaitAnalysis[];
}

export function WaitAnalysisTab({ waitAnalysis }: WaitAnalysisTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Wait Action Analysis
        </CardTitle>
        <CardDescription>
          Optimize wait durations and use dynamic waits
        </CardDescription>
      </CardHeader>
      <CardContent>
        {waitAnalysis.length > 0 ? (
          <div className="space-y-3">
            {waitAnalysis.map((wait) => (
              <div
                key={wait.actionId}
                className="border rounded-lg p-4 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{wait.actionName}</span>
                  <Badge variant="outline">
                    {formatDuration(wait.waitDuration)}
                  </Badge>
                </div>

                <p className="text-sm text-muted-foreground">
                  {wait.suggestion}
                </p>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    Potential savings:
                  </span>
                  <span className="font-bold text-green-500">
                    {formatDuration(wait.potentialSavings)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No VANISH actions found in this workflow
          </div>
        )}
      </CardContent>
    </Card>
  );
}
