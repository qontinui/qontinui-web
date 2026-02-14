"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useTaskRuns, runnerApi } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  History,
  Search,
  RefreshCw,
  CheckCircle2,
  XCircle,
  PlayCircle,
  Clock,
  ArrowRight,
  Trash2,
  Loader2,
  Monitor,
  Brain,
} from "lucide-react";
import { toast } from "sonner";

function getStatusBadge(status: string) {
  switch (status) {
    case "completed":
      return <Badge variant="success">Completed</Badge>;
    case "failed":
      return <Badge variant="destructive">Failed</Badge>;
    case "running":
      return <Badge variant="info">Running</Badge>;
    case "stopped":
      return <Badge variant="secondary">Stopped</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle2 className="size-4 text-green-500" />;
    case "failed":
      return <XCircle className="size-4 text-red-500" />;
    case "running":
      return <PlayCircle className="size-4 text-blue-500 animate-pulse" />;
    default:
      return <Clock className="size-4 text-text-muted" />;
  }
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatDateTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

export default function RunHistoryPage() {
  const router = useRouter();
  const {
    data: runs,
    isLoading,
    error,
    isOffline,
    refetch,
  } = useTaskRuns({ limit: 100 });
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  const filteredRuns = useMemo(() => {
    if (!runs) return [];
    return runs.filter((run) => {
      const matchesSearch =
        !searchQuery ||
        run.task_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        run.workflow_name?.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        statusFilter === "all" || run.status === statusFilter;
      const matchesType =
        typeFilter === "all" ||
        run.workflow_type === typeFilter ||
        run.task_type === typeFilter;
      return matchesSearch && matchesStatus && matchesType;
    });
  }, [runs, searchQuery, statusFilter, typeFilter]);

  const handleBulkDelete = async () => {
    setIsDeleting(true);
    try {
      await Promise.all(
        Array.from(selectedRuns).map((id) => runnerApi.deleteTaskRun(id))
      );
      toast.success(`Deleted ${selectedRuns.size} runs`);
      setSelectedRuns(new Set());
      refetch();
    } catch {
      toast.error("Failed to delete some runs");
    } finally {
      setIsDeleting(false);
    }
  };

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <History className="size-6 text-brand-primary" />
            <h1 className="text-2xl font-bold text-text-primary">
              Run History
            </h1>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-border-default"
          >
            <RefreshCw className="size-4 mr-2" />
            Refresh
          </Button>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <p className="text-text-muted">
          Browse and filter all task runs from the Qontinui Runner.
        </p>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-text-muted" />
            <Input
              placeholder="Search by run name or workflow..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-surface-raised/50 border-border-default"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px] bg-surface-raised/50 border-border-default">
              <SelectValue placeholder="Filter status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="running">Running</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="stopped">Stopped</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            {(["all", "gui", "ai"] as const).map((type) => (
              <Button
                key={type}
                variant={typeFilter === type ? "default" : "outline"}
                size="sm"
                onClick={() => setTypeFilter(type)}
                className={
                  typeFilter === type
                    ? "bg-brand-primary text-black"
                    : "border-border-default text-text-muted"
                }
              >
                {type === "all" ? "All" : type.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>

        {/* Stats Bar */}
        {runs && runs.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge variant="secondary">{filteredRuns.length} total</Badge>
            <Badge variant="success" className="gap-1">
              <CheckCircle2 className="size-3" />
              {filteredRuns.filter((r) => r.status === "completed").length}{" "}
              passed
            </Badge>
            <Badge variant="destructive" className="gap-1">
              <XCircle className="size-3" />
              {filteredRuns.filter((r) => r.status === "failed").length} failed
            </Badge>
            {filteredRuns.filter(
              (r) => r.workflow_type === "gui" || r.task_type === "gui"
            ).length > 0 && (
              <Badge variant="outline" className="gap-1">
                <Monitor className="size-3" />
                {
                  filteredRuns.filter(
                    (r) => r.workflow_type === "gui" || r.task_type === "gui"
                  ).length
                }{" "}
                GUI
              </Badge>
            )}
            {filteredRuns.filter(
              (r) => r.workflow_type === "ai" || r.task_type === "ai"
            ).length > 0 && (
              <Badge variant="outline" className="gap-1">
                <Brain className="size-3" />
                {
                  filteredRuns.filter(
                    (r) => r.workflow_type === "ai" || r.task_type === "ai"
                  ).length
                }{" "}
                AI
              </Badge>
            )}
          </div>
        )}

        {/* Results */}
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <History className="size-5 text-brand-primary" />
                Task Runs
                {filteredRuns.length > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {filteredRuns.length}
                  </Badge>
                )}
              </CardTitle>
              {selectedRuns.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isDeleting}
                  onClick={handleBulkDelete}
                >
                  {isDeleting ? (
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="size-4 mr-1" />
                  )}
                  Delete {selectedRuns.size}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-12 text-text-muted">
                <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
                Loading runs...
              </div>
            ) : error ? (
              <div className="text-center py-12 text-red-400">
                Error loading runs: {error}
              </div>
            ) : filteredRuns.length === 0 ? (
              <div className="text-center py-12 text-text-muted">
                <History className="size-12 mx-auto mb-4 text-text-muted" />
                <p className="font-medium">No runs found</p>
                <p className="text-sm mt-1">
                  {runs && runs.length > 0
                    ? "Try adjusting your filters."
                    : "Runs will appear here when you execute tasks in the Runner."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-border-subtle/50">
                      <TableHead className="w-10">
                        <Checkbox
                          checked={
                            filteredRuns.length > 0 &&
                            filteredRuns.every((r) => selectedRuns.has(r.id))
                          }
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedRuns(
                                new Set(filteredRuns.map((r) => r.id))
                              );
                            } else {
                              setSelectedRuns(new Set());
                            }
                          }}
                        />
                      </TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Phase</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRuns.map((run) => (
                      <TableRow
                        key={run.id}
                        className="border-border-subtle/50 hover:bg-surface-raised/30 cursor-pointer"
                        onClick={() => router.push(`/runs/${run.id}`)}
                      >
                        <TableCell>
                          <Checkbox
                            checked={selectedRuns.has(run.id)}
                            onCheckedChange={(checked) => {
                              const next = new Set(selectedRuns);
                              if (checked) {
                                next.add(run.id);
                              } else {
                                next.delete(run.id);
                              }
                              setSelectedRuns(next);
                            }}
                            onClick={(e) => e.stopPropagation()}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {getStatusIcon(run.status)}
                            {getStatusBadge(run.status)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div
                            className="font-medium text-text-primary"
                            data-content-role="label"
                            data-content-label="task-name"
                          >
                            {run.task_name}
                          </div>
                          {run.workflow_name && (
                            <div
                              className="text-xs text-text-muted mt-0.5"
                              data-content-role="body-text"
                              data-content-label="workflow-name"
                            >
                              {run.workflow_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {run.phase ? (
                            <Badge variant="outline" className="text-xs">
                              {run.phase}
                            </Badge>
                          ) : (
                            <span className="text-text-muted">-</span>
                          )}
                        </TableCell>
                        <TableCell
                          className="text-sm text-text-muted"
                          data-content-role="body-text"
                          data-content-label="started-at"
                        >
                          {formatDateTime(run.created_at)}
                        </TableCell>
                        <TableCell
                          className="text-sm"
                          data-content-role="metric"
                          data-content-label="duration"
                        >
                          {formatDuration(run.duration_seconds)}
                        </TableCell>
                        <TableCell className="text-xs text-red-400 max-w-[200px] truncate">
                          {run.status === "failed"
                            ? (
                                run.summary ||
                                run.ai_summary ||
                                "Failed"
                              ).substring(0, 80)
                            : "-"}
                        </TableCell>
                        <TableCell>
                          <ArrowRight className="size-4 text-text-muted" />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
