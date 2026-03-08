"use client";

import { useState, useMemo } from "react";
import { useUnifiedWorkflows } from "@/lib/api/unified-workflows";
import type { UnifiedWorkflow } from "@/types/unified-workflow";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GitBranch,
  Search,
  Workflow,
  ArrowRight,
  Layers,
  MousePointer2,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";

function formatDate(dateStr?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function countSteps(workflow: UnifiedWorkflow): number {
  return (
    (workflow.setup_steps?.length ?? 0) +
    (workflow.agentic_steps?.length ?? 0) +
    (workflow.verification_steps?.length ?? 0) +
    (workflow.completion_steps?.length ?? 0)
  );
}

export default function FlowDesignerPage() {
  const { data: workflows, isLoading, error, isOffline, refetch } =
    useUnifiedWorkflows();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedWorkflow, setSelectedWorkflow] =
    useState<UnifiedWorkflow | null>(null);

  const filteredWorkflows = useMemo(() => {
    if (!workflows) return [];
    if (!searchQuery.trim()) return workflows;
    const q = searchQuery.toLowerCase();
    return workflows.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        (w.description && w.description.toLowerCase().includes(q))
    );
  }, [workflows, searchQuery]);

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <GitBranch className="w-6 h-6 text-brand-primary" />
            <h1 className="text-2xl font-bold text-text-primary">
              Flow Designer
            </h1>
          </div>
          {selectedWorkflow && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm">
                <ZoomOut className="size-4" />
              </Button>
              <Button variant="outline" size="sm">
                <ZoomIn className="size-4" />
              </Button>
              <Button variant="outline" size="sm">
                <Maximize2 className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto">
        <div className="flex gap-6">
          {/* Workflow Selector Sidebar */}
          <div className="w-80 shrink-0">
            <div className="mb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
                <Input
                  placeholder="Search workflows..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-surface-raised/50 border-border-subtle text-sm"
                />
              </div>
            </div>

            {isLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="h-16 w-full bg-surface-raised/50 rounded-lg"
                  />
                ))}
              </div>
            ) : error ? (
              <Card className="bg-surface-raised/50 border-border-subtle/50">
                <CardContent className="py-6 text-center">
                  <p className="text-sm text-red-400">{error}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => refetch()}
                  >
                    Retry
                  </Button>
                </CardContent>
              </Card>
            ) : filteredWorkflows.length === 0 ? (
              <Card className="bg-surface-raised/50 border-border-subtle/50">
                <CardContent className="py-6 text-center">
                  <p className="text-sm text-text-muted">
                    {searchQuery ? "No matching workflows" : "No workflows"}
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-1.5 max-h-[calc(100vh-220px)] overflow-y-auto">
                {filteredWorkflows.map((workflow) => (
                  <Card
                    key={workflow.id}
                    className={`bg-surface-raised/50 border-border-subtle/50 cursor-pointer transition-all hover:border-brand-primary/40 ${
                      selectedWorkflow?.id === workflow.id
                        ? "border-brand-primary/60 bg-surface-raised/80"
                        : ""
                    }`}
                    onClick={() => setSelectedWorkflow(workflow)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="min-w-0">
                          <h3 className="font-medium text-text-primary truncate text-sm">
                            {workflow.name}
                          </h3>
                          <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
                            <span data-content-role="metric" data-content-label="step count">{countSteps(workflow)} steps</span>
                            {(workflow.modified_at || workflow.created_at) && (
                              <>
                                <span>&middot;</span>
                                <span>
                                  {formatDate(
                                    workflow.modified_at || workflow.created_at
                                  )}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <ArrowRight className="size-4 text-text-muted shrink-0" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Flow Canvas */}
          <div className="flex-1">
            {selectedWorkflow ? (
              <div className="space-y-4">
                <Card className="bg-surface-raised/50 border-border-subtle/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base text-text-primary flex items-center gap-2">
                      <Workflow className="size-5" />
                      {selectedWorkflow.name}
                      <Badge variant="secondary" className="text-xs ml-auto">
                        {countSteps(selectedWorkflow)} steps
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                </Card>

                {/* Visual Flow Representation */}
                <Card className="bg-surface-raised/30 border-border-subtle/50 border-dashed">
                  <CardContent className="p-0">
                    <div className="min-h-[500px] flex flex-col items-center justify-center gap-6 p-8">
                      {/* Phase indicators as flow blocks */}
                      {(selectedWorkflow.setup_steps?.length ?? 0) > 0 && (
                        <div className="w-full max-w-md">
                          <Card className="bg-blue-500/10 border-blue-500/30">
                            <CardContent className="p-4 text-center">
                              <Badge
                                variant="outline"
                                className="bg-blue-500/20 text-blue-400 border-blue-500/30 mb-2"
                              >
                                Setup Phase
                              </Badge>
                              <p className="text-sm text-text-muted">
                                {selectedWorkflow.setup_steps?.length} step
                                {(selectedWorkflow.setup_steps?.length ?? 0) !== 1
                                  ? "s"
                                  : ""}
                              </p>
                            </CardContent>
                          </Card>
                          <div className="flex justify-center py-2">
                            <div className="w-px h-6 bg-border-subtle" />
                          </div>
                        </div>
                      )}

                      {(selectedWorkflow.verification_steps?.length ?? 0) >
                        0 && (
                        <div className="w-full max-w-md">
                          <Card className="bg-yellow-500/10 border-yellow-500/30">
                            <CardContent className="p-4 text-center">
                              <Badge
                                variant="outline"
                                className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 mb-2"
                              >
                                Verification Phase
                              </Badge>
                              <p className="text-sm text-text-muted">
                                {selectedWorkflow.verification_steps?.length}{" "}
                                step
                                {(selectedWorkflow.verification_steps?.length ??
                                  0) !== 1
                                  ? "s"
                                  : ""}
                              </p>
                            </CardContent>
                          </Card>
                          <div className="flex justify-center py-2">
                            <div className="w-px h-6 bg-border-subtle" />
                          </div>
                        </div>
                      )}

                      {(selectedWorkflow.agentic_steps?.length ?? 0) > 0 && (
                        <div className="w-full max-w-md">
                          <Card className="bg-purple-500/10 border-purple-500/30">
                            <CardContent className="p-4 text-center">
                              <Badge
                                variant="outline"
                                className="bg-purple-500/20 text-purple-400 border-purple-500/30 mb-2"
                              >
                                Agentic Phase
                              </Badge>
                              <p className="text-sm text-text-muted">
                                {selectedWorkflow.agentic_steps?.length} step
                                {(selectedWorkflow.agentic_steps?.length ?? 0) !== 1
                                  ? "s"
                                  : ""}
                              </p>
                            </CardContent>
                          </Card>
                          <div className="flex justify-center py-2">
                            <div className="w-px h-6 bg-border-subtle" />
                          </div>
                        </div>
                      )}

                      {(selectedWorkflow.completion_steps?.length ?? 0) > 0 && (
                        <div className="w-full max-w-md">
                          <Card className="bg-green-500/10 border-green-500/30">
                            <CardContent className="p-4 text-center">
                              <Badge
                                variant="outline"
                                className="bg-green-500/20 text-green-400 border-green-500/30 mb-2"
                              >
                                Completion Phase
                              </Badge>
                              <p className="text-sm text-text-muted">
                                {selectedWorkflow.completion_steps?.length} step
                                {(selectedWorkflow.completion_steps?.length ??
                                  0) !== 1
                                  ? "s"
                                  : ""}
                              </p>
                            </CardContent>
                          </Card>
                        </div>
                      )}

                      {countSteps(selectedWorkflow) === 0 && (
                        <div className="text-center py-12">
                          <Layers className="w-12 h-12 mx-auto mb-3 text-text-muted" />
                          <p className="text-sm text-text-muted">
                            This workflow has no steps yet.
                          </p>
                          <p className="text-xs text-text-muted mt-1">
                            Add steps to the workflow to design its flow.
                          </p>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <div className="flex items-center justify-center gap-4 text-xs text-text-muted">
                  <span data-content-role="body-text" data-content-label="interaction hint" className="flex items-center gap-1">
                    <MousePointer2 className="size-3" />
                    Click to select steps
                  </span>
                  <span data-content-role="body-text" data-content-label="interaction hint" className="flex items-center gap-1">
                    <Layers className="size-3" />
                    Drag to reorder phases
                  </span>
                </div>
              </div>
            ) : (
              <Card className="bg-surface-raised/30 border-border-subtle/50 border-dashed">
                <CardContent className="min-h-[600px] flex flex-col items-center justify-center">
                  <GitBranch className="w-16 h-16 mb-4 text-text-muted" />
                  <h3 className="text-xl font-medium text-text-secondary mb-2">
                    Select a Workflow to Design its Flow
                  </h3>
                  <p className="text-sm text-text-muted max-w-md text-center">
                    Choose a workflow from the sidebar to visualize and design
                    its execution flow. The flow editor lets you arrange steps,
                    define transitions, and configure phases.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
