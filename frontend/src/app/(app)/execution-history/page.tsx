"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useProject } from "@/hooks/automation/useProject";
import { useExecutionWorkflows, useExecutionRuns } from "@/hooks/useExecution";
import { RequireProject } from "@/components/require-project";
import { ExecutionHistoryView } from "@/components/execution/ExecutionHistoryView";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  History,
  Workflow,
  Play,
  CheckCircle2,
  XCircle,
  Clock,
  Calendar,
} from "lucide-react";
import { safeParseUTCDate } from "@/lib/time-utils";

/**
 * Format a date string for display in the run dropdown
 */
function formatRunDateTime(dateString: string): string {
  const date = safeParseUTCDate(dateString);
  if (!date) return "Unknown";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Format time
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  // Format date based on how recent
  if (diffDays === 0) {
    return `Today at ${timeStr}`;
  } else if (diffDays === 1) {
    return `Yesterday at ${timeStr}`;
  } else if (diffDays < 7) {
    const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
    return `${dayName} at ${timeStr}`;
  } else {
    const dateStr = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
    return `${dateStr} at ${timeStr}`;
  }
}

/**
 * Get status icon component for a run status
 */
function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="w-4 h-4 text-green-500" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-red-500" />;
    case "running":
      return <Clock className="w-4 h-4 text-blue-500 animate-pulse" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

function ExecutionHistoryPageContent() {
  const searchParams = useSearchParams();
  const { projectId: storeProjectId } = useProject();

  // URL params - use URL project param with fallback to store
  const urlProjectId = searchParams.get("project");
  const projectId = urlProjectId || storeProjectId;
  const runIdParam = searchParams.get("runId");
  const workflowParam = searchParams.get("workflow");

  // State
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(
    workflowParam
  );
  const [selectedRunId, setSelectedRunId] = useState<string | null>(runIdParam);

  // Fetch workflows for this project
  const {
    data: workflows,
    isLoading: workflowsLoading,
    error: workflowsError,
  } = useExecutionWorkflows(projectId || "", !!projectId);

  // Fetch runs filtered by selected workflow
  const {
    data: runsData,
    isLoading: runsLoading,
    error: runsError,
  } = useExecutionRuns(
    selectedWorkflow && projectId
      ? {
          project_id: projectId,
          workflow_name: selectedWorkflow,
          limit: 100,
        }
      : undefined
  );

  // Get sorted runs (most recent first - already sorted by backend)
  const runs = useMemo(() => {
    return runsData?.runs || [];
  }, [runsData]);

  // Change workflow and reset run selection together
  const handleWorkflowChange = useCallback((workflow: string | null) => {
    setSelectedWorkflow(workflow);
    setSelectedRunId(null);
  }, []);

  // Update URL when selections change
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedWorkflow) {
      url.searchParams.set("workflow", selectedWorkflow);
    } else {
      url.searchParams.delete("workflow");
    }
    if (selectedRunId) {
      url.searchParams.set("runId", selectedRunId);
    } else {
      url.searchParams.delete("runId");
    }
    window.history.replaceState({}, "", url.toString());
  }, [selectedWorkflow, selectedRunId]);

  return (
    <RequireProject pageName="Execution History">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <History className="w-5 h-5 text-[#F59E0B]" />
            <h1 className="text-lg font-semibold text-foreground">
              Execution History
            </h1>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 max-w-7xl mx-auto w-full">
          {selectedRunId ? (
            <ExecutionHistoryView
              runId={selectedRunId}
              onBack={() => setSelectedRunId(null)}
              showBackButton={true}
            />
          ) : (
            <div className="space-y-6">
              {/* Workflow and Run Selection */}
              <Card className="bg-muted border-border">
                <CardHeader>
                  <CardTitle className="text-lg text-white flex items-center gap-2">
                    <Play className="w-5 h-5" />
                    Select Execution Run
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Workflow Selector */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Workflow className="w-4 h-4" />
                        Workflow
                      </p>
                      {workflowsLoading ? (
                        <Skeleton className="h-9 w-full bg-muted" />
                      ) : workflowsError ? (
                        <div className="text-sm text-red-400">
                          Failed to load workflows
                        </div>
                      ) : workflows && workflows.length > 0 ? (
                        <Select
                          value={selectedWorkflow || ""}
                          onValueChange={(value) =>
                            handleWorkflowChange(value || null)
                          }
                        >
                          <SelectTrigger className="w-full bg-muted border-border">
                            <SelectValue placeholder="Select a workflow..." />
                          </SelectTrigger>
                          <SelectContent className="bg-muted border-border">
                            {workflows.map((workflow, index) => (
                              <SelectItem
                                key={
                                  workflow.workflow_id ||
                                  `${workflow.workflow_name}-${index}`
                                }
                                value={workflow.workflow_name}
                                textValue={workflow.workflow_name}
                                className="text-white hover:bg-muted"
                              >
                                <span className="flex-1">
                                  {workflow.workflow_name}
                                </span>
                                <span className="text-xs text-muted-foreground ml-2">
                                  {workflow.run_count} run
                                  {workflow.run_count !== 1 ? "s" : ""}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-sm text-muted-foreground py-2">
                          No workflows with execution history found
                        </div>
                      )}
                    </div>

                    {/* Run Selector */}
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Execution Run
                      </p>
                      {!selectedWorkflow ? (
                        <div className="text-sm text-muted-foreground py-2">
                          Select a workflow first
                        </div>
                      ) : runsLoading ? (
                        <Skeleton className="h-9 w-full bg-muted" />
                      ) : runsError ? (
                        <div className="text-sm text-red-400">
                          Failed to load runs
                        </div>
                      ) : runs.length > 0 ? (
                        <Select
                          value={selectedRunId || ""}
                          onValueChange={(value) =>
                            setSelectedRunId(value || null)
                          }
                        >
                          <SelectTrigger className="w-full bg-muted border-border">
                            <SelectValue placeholder="Select a run..." />
                          </SelectTrigger>
                          <SelectContent className="bg-[#1A1A1B] border-border max-h-[300px]">
                            {runs.map((run) => (
                              <SelectItem
                                key={run.id}
                                value={run.id}
                                textValue={formatRunDateTime(run.started_at)}
                                className="text-white hover:bg-muted"
                              >
                                <div className="flex items-center gap-3">
                                  {getStatusIcon(run.status)}
                                  <span>
                                    {formatRunDateTime(run.started_at)}
                                  </span>
                                  {run.duration_seconds !== null &&
                                    run.duration_seconds !== undefined && (
                                      <span className="text-xs text-muted-foreground">
                                        ({run.duration_seconds}s)
                                      </span>
                                    )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-sm text-muted-foreground py-2">
                          No runs found for this workflow
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground mt-4">
                    Select a workflow and execution run to view its tree event
                    history.
                  </p>
                </CardContent>
              </Card>

              {/* Info Card */}
              <Card className="bg-muted border-border">
                <CardContent className="py-12">
                  <div className="text-center">
                    <History className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-xl font-medium text-muted-foreground mb-2">
                      Execution Tree Events
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-md mx-auto">
                      View detailed tree events for any execution run. This
                      shows the hierarchical structure of workflows, actions,
                      and transitions with timing, status, and metadata
                      information.
                    </p>
                    <div className="flex justify-center gap-4 mt-6">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        Success
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <XCircle className="w-4 h-4 text-red-500" />
                        Failed
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="w-4 h-4 text-blue-500" />
                        Running
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </main>
      </div>
    </RequireProject>
  );
}

export default function ExecutionHistoryPage() {
  return (
    <Suspense fallback={null}>
      <ExecutionHistoryPageContent />
    </Suspense>
  );
}
