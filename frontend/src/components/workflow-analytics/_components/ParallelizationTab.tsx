"use client";

import React from "react";
import { GitBranch, Info } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ParallelizationOpportunity } from "../performance-analyzer-types";
import { formatDuration } from "../performance-analyzer-utils";

interface ParallelizationTabProps {
  opportunities: ParallelizationOpportunity[];
}

export function ParallelizationTab({ opportunities }: ParallelizationTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-5 w-5" />
          Parallelization Opportunities
        </CardTitle>
        <CardDescription>
          Actions that can be executed in parallel to reduce total duration
        </CardDescription>
      </CardHeader>
      <CardContent>
        {opportunities.length > 0 ? (
          <div className="space-y-4">
            {opportunities.map((opp) => (
              <div
                key={opp.groupId}
                className="border rounded-lg p-4 space-y-3"
              >
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold">Group {opp.groupId}</h4>
                  <Badge variant="secondary">
                    {opp.actions.length} actions
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <div className="text-muted-foreground">
                      Current Duration
                    </div>
                    <div className="font-bold">
                      {formatDuration(opp.currentDuration)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">
                      Parallel Duration
                    </div>
                    <div className="font-bold text-green-500">
                      {formatDuration(opp.parallelDuration)}
                    </div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Time Saved</div>
                    <div className="font-bold text-blue-500">
                      {formatDuration(opp.savings)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    Actions have no dependencies and can run simultaneously
                  </span>
                </div>

                <Button size="sm" className="w-full">
                  Apply Parallelization
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No parallelization opportunities found
          </div>
        )}
      </CardContent>
    </Card>
  );
}
