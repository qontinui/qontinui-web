"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RequireProject } from "@/components/require-project";
import {
  CheckCircle2,
  XCircle,
  Clock,
  PlayCircle,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  StopCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useBackendTaskRuns } from "@/hooks/useTaskRunsBackend";
import type {
  TaskRunBackend,
  TaskRunFilters,
  TaskRunStatus,
} from "@/types/task-runs";

function AITasksPageContent() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = searchParams.get("project");

  const [filters, setFilters] = useState<TaskRunFilters>({
    project_id: projectId || undefined,
    offset: 0,
    limit: 10,
  });

  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading, error, refetch } = useBackendTaskRuns(filters);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    if (projectId) {
      setFilters((prev) => ({ ...prev, project_id: projectId }));
    }
  }, [projectId]);

  const handlePageChange = (direction: "next" | "prev") => {
    const currentOffset = filters.offset || 0;
    const limit = filters.limit || 10;
    const newOffset =
      direction === "next"
        ? currentOffset + limit
        : Math.max(0, currentOffset - limit);
    setFilters((prev) => ({ ...prev, offset: newOffset }));
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setFilters((prev) => ({
      ...prev,
      status: value === "all" ? undefined : (value as TaskRunStatus),
      offset: 0,
    }));
  };

  const getStatusIcon = (status: TaskRunStatus) => {
    switch (status) {
      case "complete":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "running":
        return <PlayCircle className="w-4 h-4 text-purple-500 animate-pulse" />;
      case "stopped":
        return <StopCircle className="w-4 h-4 text-muted-foreground" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadge = (status: TaskRunStatus) => {
    switch (status) {
      case "complete":
        return (
          <Badge className="bg-green-500/10 text-green-500 border-green-500/30">
            Complete
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/10 text-red-500 border-red-500/30">
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-purple-500/10 text-purple-500 border-purple-500/30">
            Running
          </Badge>
        );
      case "stopped":
        return (
          <Badge className="bg-muted text-muted-foreground border-border">
            Stopped
          </Badge>
        );
      default:
        return (
          <Badge className="bg-muted text-muted-foreground border-border">
            Unknown
          </Badge>
        );
    }
  };

  const formatDuration = (seconds: number | null | undefined): string => {
    if (!seconds) return "-";
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}h ${remainingMinutes}m`;
  };

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

  const tasks = data?.tasks || [];
  const pagination = data?.pagination;
  const currentPage = pagination
    ? Math.floor((pagination.offset || 0) / (pagination.limit || 10)) + 1
    : 1;
  const totalPages = pagination
    ? Math.ceil(pagination.total / (pagination.limit || 10))
    : 1;

  return (
    <RequireProject pageName="AI Tasks">
      <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
        <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-4">
            <h1 className="text-lg font-semibold">AI Tasks</h1>
            <Select
              value={statusFilter}
              onValueChange={handleStatusFilterChange}
            >
              <SelectTrigger className="w-[150px] h-8 text-sm">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="complete">Complete</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="stopped">Stopped</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              <div className="flex items-center justify-center gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                Loading AI tasks...
              </div>
            </div>
          ) : error ? (
            <div className="text-center py-12 text-red-400">
              Error loading AI tasks: {(error as Error).message}
            </div>
          ) : tasks.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p>No AI tasks found.</p>
              <p className="text-sm mt-2">
                AI tasks are created when running Claude-powered development
                workflows.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                    <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
                      <th className="px-6 py-2 font-medium">Status</th>
                      <th className="px-6 py-2 font-medium">Task Name</th>
                      <th className="px-3 py-2 font-medium">Sessions</th>
                      <th className="px-6 py-2 font-medium">Created</th>
                      <th className="px-3 py-2 font-medium">Duration</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {tasks.map((task: TaskRunBackend) => (
                      <tr
                        key={task.id}
                        className="hover:bg-muted/30 transition-colors cursor-pointer"
                        onClick={() =>
                          router.push(
                            `/ai-tasks/${task.id}${projectId ? `?project=${projectId}` : ""}`
                          )
                        }
                      >
                        <td className="px-6 py-2.5">
                          <div className="flex items-center gap-2">
                            {getStatusIcon(task.status)}
                            {getStatusBadge(task.status)}
                          </div>
                        </td>
                        <td className="px-6 py-2.5">
                          <div className="font-medium">{task.task_name}</div>
                          {task.prompt && (
                            <div className="text-xs text-muted-foreground truncate max-w-[300px]">
                              {task.prompt.substring(0, 100)}
                              {task.prompt.length > 100 ? "..." : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge
                            variant="secondary"
                            className="bg-purple-500/10 text-purple-400 border-purple-500/30"
                          >
                            {task.sessions_count || 0}
                          </Badge>
                        </td>
                        <td className="px-6 py-2.5">
                          <div className="text-sm text-muted-foreground">
                            {format(
                              new Date(task.created_at),
                              "MMM dd, yyyy HH:mm"
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="text-sm">
                            {formatDuration(task.duration_seconds)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between px-6 py-3 border-t border-border">
                  <div className="text-sm text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePageChange("prev")}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeft className="w-4 h-4" />
                      Previous
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handlePageChange("next")}
                      disabled={currentPage === totalPages}
                    >
                      Next
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </RequireProject>
  );
}

export default function AITasksPage() {
  return (
    <Suspense fallback={null}>
      <AITasksPageContent />
    </Suspense>
  );
}
