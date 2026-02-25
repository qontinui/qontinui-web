"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
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
      return <Clock className="w-4 h-4 text-text-muted" />;
  }
}

export default function ExecutionHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
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

  // Handle auth redirect
  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg text-muted-foreground">Loading...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <RequireProject pageName="Execution History">
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
        {/* Header */}
        <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <History className="w-6 h-6 text-[#F59E0B]" />
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[#F59E0B] to-[#F97316] bg-clip-text text-transparent">
                Execution History
              </h1>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-6 max-w-7xl mx-auto">
          {selectedRunId ? (
            <ExecutionHistoryView
              runId={selectedRunId}
              onBack={() => setSelectedRunId(null)}
              showBackButton={true}
            />
          ) : (
            <div className="space-y-6">
              {/* Workflow and Run Selection */}
              <Card className="bg-surface-raised/50 border-border-subtle/50">
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
                      <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                        <Workflow className="w-4 h-4" />
                        Workflow
                      </label>
                      {workflowsLoading ? (
                        <Skeleton className="h-9 w-full bg-surface-raised/50" />
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
                          <SelectTrigger className="w-full bg-surface-raised/50 border-border-default">
                            <SelectValue placeholder="Select a workflow..." />
                          </SelectTrigger>
                          <SelectContent className="bg-surface-raised border-border-default">
                            {workflows.map((workflow, index) => (
                              <SelectItem
                                key={
                                  workflow.workflow_id ||
                                  `${workflow.workflow_name}-${index}`
                                }
                                value={workflow.workflow_name}
                                textValue={workflow.workflow_name}
                                className="text-white hover:bg-surface-raised"
                              >
                                <span className="flex-1">
                                  {workflow.workflow_name}
                                </span>
                                <span className="text-xs text-text-muted ml-2">
                                  {workflow.run_count} run
                                  {workflow.run_count !== 1 ? "s" : ""}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-sm text-text-muted py-2">
                          No workflows with execution history found
                        </div>
                      )}
                    </div>

                    {/* Run Selector */}
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-text-muted flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Execution Run
                      </label>
                      {!selectedWorkflow ? (
                        <div className="text-sm text-text-muted py-2">
                          Select a workflow first
                        </div>
                      ) : runsLoading ? (
                        <Skeleton className="h-9 w-full bg-surface-raised/50" />
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
                          <SelectTrigger className="w-full bg-surface-raised/50 border-border-default">
                            <SelectValue placeholder="Select a run..." />
                          </SelectTrigger>
                          <SelectContent className="bg-[#1A1A1B] border-border-default max-h-[300px]">
                            {runs.map((run) => (
                              <SelectItem
                                key={run.id}
                                value={run.id}
                                textValue={formatRunDateTime(run.started_at)}
                                className="text-white hover:bg-surface-raised"
                              >
                                <div className="flex items-center gap-3">
                                  {getStatusIcon(run.status)}
                                  <span>
                                    {formatRunDateTime(run.started_at)}
                                  </span>
                                  {run.duration_seconds !== null &&
                                    run.duration_seconds !== undefined && (
                                      <span className="text-xs text-text-muted">
                                        ({run.duration_seconds}s)
                                      </span>
                                    )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-sm text-text-muted py-2">
                          No runs found for this workflow
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="text-sm text-text-muted mt-4">
                    Select a workflow and execution run to view its tree event
                    history.
                  </p>
                </CardContent>
              </Card>

              {/* Info Card */}
              <Card className="bg-surface-raised/50 border-border-subtle/50">
                <CardContent className="py-12">
                  <div className="text-center">
                    <History className="w-16 h-16 mx-auto mb-4 text-text-muted" />
                    <h3 className="text-xl font-medium text-text-secondary mb-2">
                      Execution Tree Events
                    </h3>
                    <p className="text-sm text-text-muted max-w-md mx-auto">
                      View detailed tree events for any execution run. This
                      shows the hierarchical structure of workflows, actions,
                      and transitions with timing, status, and metadata
                      information.
                    </p>
                    <div className="flex justify-center gap-4 mt-6">
                      <div className="flex items-center gap-2 text-sm text-text-muted">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        Success
                      </div>
                      <div className="flex items-center gap-2 text-sm text-text-muted">
                        <XCircle className="w-4 h-4 text-red-500" />
                        Failed
                      </div>
                      <div className="flex items-center gap-2 text-sm text-text-muted">
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
