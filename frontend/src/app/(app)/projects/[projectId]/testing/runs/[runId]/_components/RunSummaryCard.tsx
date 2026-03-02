"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, PlayCircle } from "lucide-react";
import type { TestRunDetail } from "@/services/testing-service";
import { format } from "date-fns";

interface RunSummaryCardProps {
  run: TestRunDetail;
  displayStatus: string;
}

export function RunSummaryCard({ run, displayStatus }: RunSummaryCardProps) {
  const successRate =
    run.total_transitions > 0
      ? ((run.successful_transitions / run.total_transitions) * 100).toFixed(1)
      : "0";

  return (
    <Card className="bg-muted border-border">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="text-2xl mb-2">{run.workflow_name}</CardTitle>
            <CardDescription className="text-muted-foreground">
              Run ID: {run.id} &bull; Started{" "}
              {format(new Date(run.start_time), "MMM dd, yyyy HH:mm:ss")}
            </CardDescription>
          </div>
          <Badge
            variant={
              displayStatus === "completed"
                ? "success"
                : displayStatus === "failed"
                  ? "destructive"
                  : "default"
            }
            className={
              displayStatus === "running"
                ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                : ""
            }
          >
            {displayStatus === "running" && (
              <PlayCircle className="w-3 h-3 mr-1 animate-pulse" />
            )}
            {displayStatus}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Duration
            </div>
            <div className="text-2xl font-bold">
              {run.duration_seconds
                ? `${Math.floor(run.duration_seconds / 60)}m ${run.duration_seconds % 60}s`
                : "-"}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Coverage</div>
            <div className="text-2xl font-bold text-primary">
              {run.coverage_percentage.toFixed(1)}%
            </div>
            <div className="text-xs text-muted-foreground">
              {run.states_covered} / {run.total_states} states
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Success Rate</div>
            <div className="text-2xl font-bold text-green-500">
              {successRate}%
            </div>
            <div className="text-xs text-muted-foreground">
              {run.successful_transitions} / {run.total_transitions} transitions
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Deficiencies</div>
            <div className="text-2xl font-bold text-red-400">
              {run.deficiencies_found}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground">Runner</div>
            <div className="text-sm font-mono truncate">
              {run.runner_id.slice(0, 8)}...
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
