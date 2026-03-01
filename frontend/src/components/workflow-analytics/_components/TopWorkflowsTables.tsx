import React from "react";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { WorkflowMetrics } from "@/services/workflow-analytics-service";
import { formatDuration, formatPercentage } from "../analytics-dashboard-utils";
import type { TopWorkflows } from "../analytics-dashboard-types";

interface TopWorkflowsTablesProps {
  topWorkflows: TopWorkflows;
}

function WorkflowList({
  items,
  emptyMessage,
  renderBadge,
}: {
  items: WorkflowMetrics[];
  emptyMessage: string;
  renderBadge: (metric: WorkflowMetrics) => React.ReactNode;
}) {
  return (
    <ScrollArea className="h-[300px]">
      <div className="space-y-2">
        {items.map((metric, index) => (
          <div
            key={metric.workflowId}
            className="flex items-center justify-between p-2 rounded hover:bg-accent"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm font-medium text-muted-foreground">
                #{index + 1}
              </span>
              <span className="text-sm truncate">{metric.workflowName}</span>
            </div>
            {renderBadge(metric)}
          </div>
        ))}
        {items.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            {emptyMessage}
          </p>
        )}
      </div>
    </ScrollArea>
  );
}

export function TopWorkflowsTables({ topWorkflows }: TopWorkflowsTablesProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Most Executed</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowList
            items={topWorkflows.mostExecuted}
            emptyMessage="No data available"
            renderBadge={(metric) => (
              <Badge variant="secondary">{metric.totalExecutions}</Badge>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Slowest Workflows</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowList
            items={topWorkflows.slowest}
            emptyMessage="No data available"
            renderBadge={(metric) => (
              <Badge variant="outline">
                {formatDuration(metric.avgDuration)}
              </Badge>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-orange-500" />
            Highest Error Rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowList
            items={topWorkflows.highestError}
            emptyMessage="No failures detected"
            renderBadge={(metric) => (
              <Badge variant="destructive">
                {formatPercentage(1 - metric.successRate)}
              </Badge>
            )}
          />
        </CardContent>
      </Card>
    </div>
  );
}
