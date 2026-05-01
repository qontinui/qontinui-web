"use client";

import React from "react";
import { Workflow } from "@/lib/action-schema/action-types";
import { WorkflowDocumentationService } from "@/services/workflow-documentation-service";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  FileText,
  Sparkles,
  Download,
  Upload,
  FileCode,
  Eye,
  Edit,
  BarChart3,
  Clock,
  TrendingUp,
  AlertCircle,
  ExternalLink,
  Settings,
} from "lucide-react";
import type { DocumentationStats } from "../documentation-utils";

export interface DocumentationDashboardProps {
  stats: DocumentationStats;
  workflows: Workflow[];
  onSelectWorkflow: (workflow: Workflow) => void;
}

export function DocumentationDashboard({
  stats,
  workflows,
  onSelectWorkflow,
}: DocumentationDashboardProps) {
  const undocumentedWorkflows = workflows.filter((wf) => {
    const docService = WorkflowDocumentationService.getInstance();
    return !docService.getDocumentation(wf.id);
  });

  return (
    <div className="flex-1 overflow-auto p-6 space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Documentation Dashboard</h2>
        <p className="text-muted-foreground mt-1">
          Manage and maintain your workflow documentation
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-muted border-border">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                <FileText className="size-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Documents</p>
                <p className="text-2xl font-bold text-primary">
                  {stats.documented}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-muted border-border">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-green-500/20 flex items-center justify-center">
                <BarChart3 className="size-6 text-green-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Coverage</p>
                <p className="text-2xl font-bold text-green-500">
                  {stats.coverage.toFixed(1)}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-muted border-border">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-primary/20 flex items-center justify-center">
                <Clock className="size-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Recently Updated
                </p>
                <p className="text-2xl font-bold text-primary">
                  {stats.recentlyUpdated}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-muted border-border">
          <CardContent className="p-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                <TrendingUp className="size-6 text-yellow-500" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Health Score</p>
                <p className="text-2xl font-bold text-yellow-500">
                  {stats.healthScore}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-muted border-border">
        <CardHeader>
          <CardTitle>Documentation Coverage</CardTitle>
          <CardDescription>
            {stats.documented} of {stats.total} workflows documented
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Progress value={stats.coverage} className="h-3" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-muted border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="size-5 text-yellow-500" />
                  Undocumented Workflows
                </CardTitle>
                <CardDescription>
                  {undocumentedWorkflows.length} workflows need documentation
                </CardDescription>
              </div>
              {undocumentedWorkflows.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-primary text-primary hover:bg-primary/20"
                >
                  <Sparkles className="size-4 mr-2" />
                  Generate All
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="space-y-2">
                {undocumentedWorkflows.slice(0, 10).map((workflow) => (
                  <div
                    role="button"
                    tabIndex={0}
                    key={workflow.id}
                    className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-border transition-colors cursor-pointer"
                    onClick={() => onSelectWorkflow(workflow)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).click();
                      }
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <FileCode className="size-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{workflow.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {workflow.category}
                        </p>
                      </div>
                    </div>
                    <Button size="sm" variant="ghost">
                      <Edit className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        <Card className="bg-muted border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="size-5 text-primary" />
              Most Viewed
            </CardTitle>
            <CardDescription>Popular documentation pages</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {stats.mostViewed.map((name, idx) => (
                <div
                  key={name}
                  className="flex items-center justify-between p-3 rounded-lg border border-border hover:border-border transition-colors cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary font-bold text-sm">
                      {idx + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{name}</p>
                      <p className="text-xs text-muted-foreground">
                        {[329, 552, 418, 267, 385][idx] || 200} views
                      </p>
                    </div>
                  </div>
                  <ExternalLink className="size-4 text-muted-foreground" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-muted border-border">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>Common documentation tasks</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 p-4 border-border hover:border-primary hover:text-primary bg-transparent"
            >
              <Sparkles className="size-6" />
              <span className="text-xs">Auto-Generate</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 p-4 border-border hover:border-primary hover:text-primary bg-transparent"
            >
              <Download className="size-6" />
              <span className="text-xs">Export All</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 p-4 border-border hover:border-green-500 hover:text-green-500 bg-transparent"
            >
              <Upload className="size-6" />
              <span className="text-xs">Import Docs</span>
            </Button>
            <Button
              variant="outline"
              className="h-auto flex-col gap-2 p-4 border-border hover:border-yellow-500 hover:text-yellow-500 bg-transparent"
            >
              <Settings className="size-6" />
              <span className="text-xs">Templates</span>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
