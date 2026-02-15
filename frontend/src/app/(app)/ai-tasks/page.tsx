"use client";

export const dynamic = "force-dynamic";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RequireProject } from "@/components/require-project";
import {
  ArrowLeft,
  Sparkles,
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

export default function AITasksPage() {
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
        return <StopCircle className="w-4 h-4 text-text-muted" />;
      default:
        return <Clock className="w-4 h-4 text-text-muted" />;
    }
  };

  const getStatusBadge = (status: TaskRunStatus) => {
    switch (status) {
      case "complete":
        return (
          <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
            Complete
          </Badge>
        );
      case "failed":
        return (
          <Badge className="bg-red-500/20 text-red-500 border-red-500/30">
            Failed
          </Badge>
        );
      case "running":
        return (
          <Badge className="bg-purple-500/20 text-purple-500 border-purple-500/30">
            Running
          </Badge>
        );
      case "stopped":
        return (
          <Badge className="bg-surface-raised/20 text-text-muted border-border-default/30">
            Stopped
          </Badge>
        );
      default:
        return (
          <Badge className="bg-surface-raised/20 text-text-muted border-border-default/30">
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
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
        {/* Header */}
        <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center justify-between px-6 py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                onClick={() => router.push("/dashboard")}
                className="text-text-muted hover:text-white"
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Sparkles className="w-6 h-6 text-[#9333EA]" />
                <h1 className="text-2xl font-bold bg-gradient-to-r from-[#9333EA] to-brand-secondary bg-clip-text text-transparent">
                  AI Tasks
                </h1>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-border-default hover:border-[#9333EA] hover:text-[#9333EA]"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </Button>
          </div>
        </header>

        {/* Main Content */}
        <main className="p-6 max-w-7xl mx-auto">
          <div className="mb-6">
            <p className="text-text-muted">
              View and manage AI-powered development tasks
            </p>
          </div>

          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#9333EA]" />
                  Task History
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Select
                    value={statusFilter}
                    onValueChange={handleStatusFilterChange}
                  >
                    <SelectTrigger className="w-[150px] bg-surface-canvas/50 border-border-default">
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
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-12 text-text-muted">
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
                <div className="text-center py-12 text-text-muted">
                  <Sparkles className="w-12 h-12 mx-auto mb-4 text-text-muted" />
                  <p>No AI tasks found.</p>
                  <p className="text-sm mt-2">
                    AI tasks are created when running Claude-powered development
                    workflows.
                  </p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-border-subtle/50">
                          <TableHead>Status</TableHead>
                          <TableHead>Task Name</TableHead>
                          <TableHead>Sessions</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead>Duration</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tasks.map((task: TaskRunBackend) => (
                          <TableRow
                            key={task.id}
                            className="border-border-subtle/50 hover:bg-surface-raised/30 cursor-pointer"
                            onClick={() =>
                              router.push(
                                `/ai-tasks/${task.id}${projectId ? `?project=${projectId}` : ""}`
                              )
                            }
                          >
                            <TableCell>
                              <div className="flex items-center gap-2">
                                {getStatusIcon(task.status)}
                                {getStatusBadge(task.status)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">
                                {task.task_name}
                              </div>
                              {task.prompt && (
                                <div className="text-xs text-text-muted truncate max-w-[300px]">
                                  {task.prompt.substring(0, 100)}
                                  {task.prompt.length > 100 ? "..." : ""}
                                </div>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className="bg-purple-500/20 text-purple-400 border-purple-500/30"
                              >
                                {task.sessions_count || 0}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm text-text-muted">
                                {format(
                                  new Date(task.created_at),
                                  "MMM dd, yyyy HH:mm"
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="text-sm">
                                {formatDuration(task.duration_seconds)}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-6">
                      <div className="text-sm text-text-muted">
                        Page {currentPage} of {totalPages}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePageChange("prev")}
                          disabled={currentPage === 1}
                          className="border-border-default hover:border-[#9333EA] hover:text-[#9333EA]"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          Previous
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePageChange("next")}
                          disabled={currentPage === totalPages}
                          className="border-border-default hover:border-[#9333EA] hover:text-[#9333EA]"
                        >
                          Next
                          <ChevronRight className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </main>
      </div>
    </RequireProject>
  );
}
