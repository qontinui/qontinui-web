"use client";

import React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import {
  formatDuration,
  formatPercentage,
  formatNumber,
} from "../analytics-utils";
import type { TopWorkflows, ExecutionRecord } from "../analytics-types";

interface TopWorkflowsTabProps {
  topWorkflows: TopWorkflows;
  onSelectWorkflow: (workflowId: string) => void;
  onSelectExecution: (execution: ExecutionRecord) => void;
}

export function TopWorkflowsTab({
  topWorkflows,
  onSelectWorkflow,
  onSelectExecution,
}: TopWorkflowsTabProps) {
  return (
    <Tabs defaultValue="most-executed">
      <TabsList className="bg-muted border-border">
        <TabsTrigger value="most-executed">Most Executed</TabsTrigger>
        <TabsTrigger value="slowest">Slowest</TabsTrigger>
        <TabsTrigger value="highest-error">Highest Error Rate</TabsTrigger>
        <TabsTrigger value="recently-failed">Recently Failed</TabsTrigger>
      </TabsList>

      <TabsContent value="most-executed">
        <Card className="bg-muted border-border">
          <CardHeader>
            <CardTitle>Most Executed Workflows</CardTitle>
            <CardDescription>
              Top 10 workflows by execution count
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topWorkflows.mostExecuted.map((metric, index) => (
                <div
                  key={metric.workflowId}
                  className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-border transition-colors cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectWorkflow(metric.workflowId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectWorkflow(metric.workflowId);
                    }
                  }}
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary font-bold">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{metric.workflowName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {formatPercentage(metric.successRate)} success rate
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-primary">
                      {formatNumber(metric.totalExecutions)}
                    </p>
                    <p className="text-xs text-muted-foreground">executions</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground ml-4" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="slowest">
        <Card className="bg-muted border-border">
          <CardHeader>
            <CardTitle>Slowest Workflows</CardTitle>
            <CardDescription>
              Top 10 workflows by average duration
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topWorkflows.slowest.map((metric, index) => (
                <div
                  key={metric.workflowId}
                  className="flex items-center justify-between p-4 rounded-lg border border-border hover:border-border transition-colors cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectWorkflow(metric.workflowId)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectWorkflow(metric.workflowId);
                    }
                  }}
                >
                  <div className="flex items-center gap-4 flex-1">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-secondary/20 text-brand-secondary font-bold">
                      {index + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium">{metric.workflowName}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs">
                          Min: {formatDuration(metric.minDuration)}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          Max: {formatDuration(metric.maxDuration)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-brand-secondary">
                      {formatDuration(metric.avgDuration)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      avg duration
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground ml-4" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="highest-error">
        <Card className="bg-muted border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Highest Error Rate
            </CardTitle>
            <CardDescription>Workflows with the most failures</CardDescription>
          </CardHeader>
          <CardContent>
            {topWorkflows.highestError.length > 0 ? (
              <div className="space-y-3">
                {topWorkflows.highestError.map((metric, index) => (
                  <div
                    key={metric.workflowId}
                    className="flex items-center justify-between p-4 rounded-lg border border-red-500/20 bg-red-500/5 hover:border-red-500/30 transition-colors cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectWorkflow(metric.workflowId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectWorkflow(metric.workflowId);
                      }
                    }}
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-red-500/20 text-red-500 font-bold">
                        {index + 1}
                      </div>
                      <div className="flex-1">
                        <p className="font-medium">{metric.workflowName}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">
                            {metric.failedExecutions} failures
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {metric.totalExecutions} total runs
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-red-500">
                        {formatPercentage(1 - metric.successRate)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        error rate
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-muted-foreground ml-4" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  No Failures Detected
                </h3>
                <p className="text-muted-foreground">
                  All workflows are running successfully!
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="recently-failed">
        <Card className="bg-muted border-border">
          <CardHeader>
            <CardTitle>Recently Failed Executions</CardTitle>
            <CardDescription>Most recent workflow failures</CardDescription>
          </CardHeader>
          <CardContent>
            {topWorkflows.recentlyFailed.length > 0 ? (
              <div className="space-y-3">
                {topWorkflows.recentlyFailed.map((execution) => (
                  <div
                    key={execution.id}
                    className="p-4 rounded-lg border border-red-500/20 bg-red-500/5 hover:border-red-500/30 transition-colors cursor-pointer"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectExecution(execution)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelectExecution(execution);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <p className="font-medium">{execution.workflowName}</p>
                        <p className="text-sm text-muted-foreground mt-1">
                          {new Date(execution.startTime).toLocaleString()}
                        </p>
                      </div>
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        Failed
                      </Badge>
                    </div>
                    {execution.error && (
                      <Alert className="mt-2 bg-red-500/10 border-red-500/20">
                        <AlertCircle className="h-4 w-4" />
                        <AlertTitle className="text-sm">Error</AlertTitle>
                        <AlertDescription className="text-xs">
                          {execution.error}
                        </AlertDescription>
                      </Alert>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">
                  No Recent Failures
                </h3>
                <p className="text-muted-foreground">
                  All recent executions were successful!
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
