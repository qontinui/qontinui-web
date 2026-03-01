"use client";

import React from "react";
import {
  GitBranch,
  AlertCircle,
  TrendingUp,
  BarChart3,
  Trash2,
  Target,
  ArrowRight,
  Info,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  workflowDependencyAnalyzer,
  type DependencyGraph,
  type DependencyStats,
} from "@/services/workflow-dependency-analyzer";
import type { Workflow } from "@/lib/action-schema/action-types";
import { getImpactBadge } from "../dependencies-types";

interface AnalysisPanelProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  graph: DependencyGraph;
  stats: DependencyStats | null;
  workflows: Workflow[];
  unusedWorkflows: Workflow[];
  criticalWorkflows: Workflow[];
  onHighlightCycle: (cycle: string[]) => void;
}

export function AnalysisPanel({
  activeTab,
  setActiveTab,
  graph,
  stats,
  workflows,
  unusedWorkflows,
  criticalWorkflows,
  onHighlightCycle,
}: AnalysisPanelProps) {
  return (
    <div className="w-[400px] flex flex-col bg-background">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col"
      >
        <div className="border-b px-4 py-2">
          <TabsList className="w-full">
            <TabsTrigger value="overview" className="flex-1">
              <BarChart3 className="size-4" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="circular" className="flex-1">
              <GitBranch className="size-4" />
              Circular
            </TabsTrigger>
            <TabsTrigger value="unused" className="flex-1">
              <Trash2 className="size-4" />
              Unused
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1">
          {/* Overview Tab */}
          <TabsContent value="overview" className="p-4 space-y-4 m-0">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Statistics</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Total Workflows</span>
                  <span className="font-semibold">
                    {stats?.totalWorkflows || 0}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Total Dependencies
                  </span>
                  <span className="font-semibold">
                    {stats?.totalDependencies || 0}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Avg. Dependencies
                  </span>
                  <span className="font-semibold">
                    {stats?.avgDependenciesPerWorkflow.toFixed(1) || 0}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Max Depth</span>
                  <span className="font-semibold">{stats?.maxDepth || 0}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Circular Dependencies
                  </span>
                  <Badge
                    variant={
                      graph.cycles.length > 0 ? "destructive" : "secondary"
                    }
                  >
                    {graph.cycles.length}
                  </Badge>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    Unused Workflows
                  </span>
                  <Badge
                    variant={
                      unusedWorkflows.length > 0 ? "default" : "secondary"
                    }
                  >
                    {unusedWorkflows.length}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            {stats && stats.mostDepended.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Most Depended On</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stats.mostDepended.slice(0, 5).map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="truncate flex-1">{item.name}</span>
                      <Badge variant="secondary">{item.count}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {stats && stats.mostDependencies.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Most Dependencies</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stats.mostDependencies.slice(0, 5).map((item) => (
                    <div key={item.id} className="flex justify-between text-sm">
                      <span className="truncate flex-1">{item.name}</span>
                      <Badge variant="secondary">{item.count}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* Circular Dependencies Tab */}
          <TabsContent value="circular" className="p-4 space-y-4 m-0">
            {graph.cycles.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-8">
                  <CheckCircle2 className="size-12 text-green-500 mb-4" />
                  <p className="text-sm text-muted-foreground text-center">
                    No circular dependencies found
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <AlertCircle className="size-4 text-destructive" />
                  <span className="font-semibold">
                    {graph.cycles.length} circular{" "}
                    {graph.cycles.length === 1 ? "dependency" : "dependencies"}{" "}
                    detected
                  </span>
                </div>
                {graph.cycles.map((cycle, idx) => {
                  const workflowNames = cycle
                    .map((id) => workflows.find((w) => w.id === id)?.name || id)
                    .slice(0, -1); // Remove duplicate last item
                  return (
                    <Card key={idx}>
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                          <GitBranch className="size-4" />
                          Cycle {idx + 1}
                          <Badge variant="destructive">
                            {workflowNames.length} workflows
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-xs space-y-1">
                          {workflowNames.map((name, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="truncate">{name}</span>
                              {i < workflowNames.length - 1 && (
                                <ArrowRight className="size-3 text-muted-foreground shrink-0" />
                              )}
                            </div>
                          ))}
                          <div className="flex items-center gap-2 text-destructive">
                            <ArrowRight className="size-3 shrink-0" />
                            <span className="font-semibold">
                              Back to {workflowNames[0]}
                            </span>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full"
                          onClick={() => onHighlightCycle(cycle)}
                        >
                          <Target className="size-4" />
                          Highlight on Graph
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </>
            )}
          </TabsContent>

          {/* Unused Workflows Tab */}
          <TabsContent value="unused" className="p-4 space-y-4 m-0">
            {unusedWorkflows.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-8">
                  <CheckCircle2 className="size-12 text-green-500 mb-4" />
                  <p className="text-sm text-muted-foreground text-center">
                    All workflows are being used
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <Info className="size-4 text-blue-500" />
                  <span className="font-semibold">
                    {unusedWorkflows.length} unused{" "}
                    {unusedWorkflows.length === 1 ? "workflow" : "workflows"}
                  </span>
                </div>
                {unusedWorkflows.map((workflow) => {
                  const node = graph.nodes.get(workflow.id);
                  return (
                    <Card key={workflow.id}>
                      <CardHeader>
                        <CardTitle className="text-sm">
                          {workflow.name}
                        </CardTitle>
                        {workflow.category && (
                          <CardDescription>
                            <Badge variant="outline">{workflow.category}</Badge>
                          </CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Actions
                            </span>
                            <span className="font-medium">
                              {workflow.actions.length}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Dependencies
                            </span>
                            <span className="font-medium">
                              {node?.outDegree || 0}
                            </span>
                          </div>
                        </div>
                        <Separator />
                        <div className="text-xs text-muted-foreground">
                          <p className="font-semibold mb-1">Suggestions:</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {workflow.category !== "Main" && (
                              <li>
                                Convert to Main category if useful standalone
                              </li>
                            )}
                            <li>Delete if no longer needed</li>
                            <li>Add to test suite for verification</li>
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </>
            )}
          </TabsContent>

          {/* Critical Tab */}
          <TabsContent value="critical" className="p-4 space-y-4 m-0">
            {criticalWorkflows.length === 0 ? (
              <Card>
                <CardContent className="flex flex-col items-center justify-center py-8">
                  <Info className="size-12 text-blue-500 mb-4" />
                  <p className="text-sm text-muted-foreground text-center">
                    No critical workflows identified
                  </p>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <TrendingUp className="size-4 text-orange-500" />
                  <span className="font-semibold">
                    {criticalWorkflows.length} critical{" "}
                    {criticalWorkflows.length === 1 ? "workflow" : "workflows"}
                  </span>
                </div>
                {criticalWorkflows.map((workflow) => {
                  const node = graph.nodes.get(workflow.id)!;
                  const impact = workflowDependencyAnalyzer.getImpactAnalysis(
                    workflow.id,
                    workflows
                  );
                  const impactBadge = getImpactBadge(impact.impactLevel);
                  const Icon = impactBadge.icon;

                  return (
                    <Card key={workflow.id}>
                      <CardHeader>
                        <CardTitle className="text-sm flex items-center justify-between">
                          <span className="truncate">{workflow.name}</span>
                          <Badge variant={impactBadge.variant}>
                            <Icon className="size-3" />
                            {impactBadge.label}
                          </Badge>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="text-xs space-y-1">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Dependents
                            </span>
                            <span className="font-medium">{node.inDegree}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">
                              Impact
                            </span>
                            <span className="font-medium">
                              {impact.affectedCount} workflows affected
                            </span>
                          </div>
                        </div>
                        <Separator />
                        <div className="text-xs text-muted-foreground">
                          <p className="font-semibold mb-1">Recommendations:</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            <li>Add comprehensive tests</li>
                            <li>Document expected behavior</li>
                            <li>Consider breaking into smaller workflows</li>
                            <li>Monitor execution carefully</li>
                          </ul>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </>
            )}
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}
