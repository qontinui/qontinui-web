"use client";

import React from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import { WorkflowDocumentationService } from "@/services/workflow-documentation-service";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  TestTube,
  BarChart3,
  Edit,
  Clock,
  Info,
  PlayCircle,
  Tags,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { calculateWorkflowStats } from "../documentation-utils";

export interface WorkflowInfoPanelProps {
  workflow: Workflow;
  onEdit: () => void;
  onRun: () => void;
  onViewTests: () => void;
  onViewMetrics: () => void;
}

export function WorkflowInfoPanel({
  workflow,
  onEdit,
  onRun,
  onViewTests,
  onViewMetrics,
}: WorkflowInfoPanelProps) {
  const stats = calculateWorkflowStats(workflow);
  const docService = WorkflowDocumentationService.getInstance();
  const documentation = docService.getDocumentation(workflow.id);

  return (
    <div className="flex flex-col h-full border-l border-border bg-muted/50">
      <div className="p-4 border-b border-border">
        <h3 className="font-semibold flex items-center gap-2">
          <Info className="size-5 text-primary" />
          Workflow Info
        </h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase">
              Quick Stats
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-background border border-border">
                <p className="text-xs text-muted-foreground">Actions</p>
                <p className="text-lg font-bold text-primary">
                  {stats.actionCount}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-background border border-border">
                <p className="text-xs text-muted-foreground">Complexity</p>
                <p className="text-lg font-bold text-primary">
                  {stats.complexity}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-background border border-border">
                <p className="text-xs text-muted-foreground">Dependencies</p>
                <p className="text-lg font-bold text-yellow-500">
                  {stats.dependencies}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-background border border-border">
                <p className="text-xs text-muted-foreground">Test Coverage</p>
                <p className="text-lg font-bold text-green-500">
                  {stats.testCoverage}%
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase">
              Performance
            </h4>
            {stats.lastRun && (
              <div className="p-3 rounded-lg bg-background border border-border">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-muted-foreground">
                    Last Run
                  </span>
                  <Clock className="size-3 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">
                  {new Date(stats.lastRun).toLocaleDateString()}
                </p>
              </div>
            )}
            {stats.successRate && (
              <div className="p-3 rounded-lg bg-background border border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-muted-foreground">
                    Success Rate
                  </span>
                  <span
                    className={cn(
                      "text-sm font-bold",
                      stats.successRate >= 95
                        ? "text-green-500"
                        : stats.successRate >= 85
                          ? "text-yellow-500"
                          : "text-destructive"
                    )}
                  >
                    {stats.successRate.toFixed(1)}%
                  </span>
                </div>
                <Progress value={stats.successRate} className="h-2" />
              </div>
            )}
          </div>

          {workflow.tags && workflow.tags.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase">
                Tags
              </h4>
              <div className="flex flex-wrap gap-2">
                {workflow.tags.map((tag) => (
                  <Badge
                    key={tag}
                    variant="outline"
                    className="bg-background border-border text-muted-foreground"
                  >
                    <Tags className="size-3 mr-1" />
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {documentation && (
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-muted-foreground uppercase">
                Documentation
              </h4>
              <div className="p-3 rounded-lg bg-background border border-border">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="size-4 text-green-500" />
                  <span className="text-sm font-medium">Documented</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Last updated:{" "}
                  {new Date(documentation.updated).toLocaleDateString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  Version: {documentation.version}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase">
              Quick Actions
            </h4>
            <div className="space-y-2">
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start border-border hover:border-primary hover:text-primary bg-transparent"
                onClick={onEdit}
              >
                <Edit className="size-4 mr-2" />
                Open in Editor
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start border-border hover:border-green-500 hover:text-green-500 bg-transparent"
                onClick={onRun}
              >
                <PlayCircle className="size-4 mr-2" />
                Run Workflow
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start border-border hover:border-primary hover:text-primary bg-transparent"
                onClick={onViewTests}
              >
                <TestTube className="size-4 mr-2" />
                View Tests
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="w-full justify-start border-border hover:border-yellow-500 hover:text-yellow-500 bg-transparent"
                onClick={onViewMetrics}
              >
                <BarChart3 className="size-4 mr-2" />
                View Metrics
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase">
              Related Docs
            </h4>
            <div className="space-y-2">
              <button className="w-full text-left p-2 rounded hover:bg-muted transition-colors">
                <p className="text-sm text-primary">Getting Started Guide</p>
                <p className="text-xs text-muted-foreground">
                  Introduction to this workflow
                </p>
              </button>
              <button className="w-full text-left p-2 rounded hover:bg-muted transition-colors">
                <p className="text-sm text-primary">API Documentation</p>
                <p className="text-xs text-muted-foreground">
                  Related endpoints
                </p>
              </button>
              <button className="w-full text-left p-2 rounded hover:bg-muted transition-colors">
                <p className="text-sm text-primary">Troubleshooting</p>
                <p className="text-xs text-muted-foreground">
                  Common issues and fixes
                </p>
              </button>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
