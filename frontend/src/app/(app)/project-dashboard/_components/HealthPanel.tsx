"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle } from "lucide-react";
import { HealthScoreGauge } from "./health-score-gauge";
import { HealthIssuesList } from "./health-issues-list";
import type { ProjectData } from "../_lib/types";

interface HealthPanelProps {
  data: ProjectData;
}

export function HealthPanel({ data }: HealthPanelProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Health Score</CardTitle>
        </CardHeader>
        <CardContent>
          <HealthScoreGauge
            score={data.healthScore}
            factors={data.healthFactors}
          />
        </CardContent>
      </Card>

      <div className="lg:col-span-2">
        <Card className="bg-surface-raised/50 border-border-subtle/50 backdrop-blur-sm h-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-error" />
              Health Issues
            </CardTitle>
            <CardDescription>Issues requiring attention</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-4">
              <HealthIssuesList issues={data.healthIssues} />
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
