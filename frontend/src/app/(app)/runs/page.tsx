"use client";

import { useState, useMemo } from "react";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import { useDiscoveredSpec } from "@/lib/ui-bridge/use-discovered-specs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import { useRouter } from "next/navigation";
import { useTaskRunList } from "@/hooks/useTaskRunData";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { runnerApi } from "@/lib/runner";
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
      return <Clock className="size-4 text-muted-foreground" />;
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
  const discoveredSpec = useDiscoveredSpec("runs");
  usePageSpecs(
    discoveredSpec ? { runs: discoveredSpec.config as SpecConfig } : {}
  );
  const router = useRouter();
  const {
    data: runs,
    isLoading,
    error,
    isRunnerOffline,
    refetch,
  } = useTaskRunList({ limit: 100 });
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
    if (isRunnerOffline) {
      toast.error("Cannot delete runs while runner is offline");
      return;
    }
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

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <h1 className="text-lg font-semibold">Run History</h1>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4 mr-2" />
          Refresh
        </Button>
      </header>

      <main className="flex-1 overflow-y-auto p-6 space-y-6">
        <p className="text-muted-foreground text-sm">
          Browse and filter all task runs from the Qontinui Runner.
        </p>

        {isRunnerOffline && <RunnerPartialState />}

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="Search by run name or workflow..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[160px]">
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
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground"
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
        {selectedRuns.size > 0 && (
          <div className="flex items-center justify-end">
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
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
            Loading runs...
          </div>
        ) : error ? (
          <div className="text-center py-12 text-red-400">
            Error loading runs: {error?.message ?? String(error)}
          </div>
        ) : filteredRuns.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <History className="size-12 mx-auto mb-4 text-muted-foreground" />
            <p className="font-medium">No runs found</p>
            <p className="text-sm mt-1">
              {runs && runs.length > 0
                ? "Try adjusting your filters."
                : "Runs will appear here when you execute tasks in the Runner."}
            </p>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/80 backdrop-blur-sm sticky top-0">
                  <tr>
                    <th className="w-10 px-3 py-2">
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
                    </th>
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Status
                    </th>
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Name
                    </th>
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Phase
                    </th>
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Started
                    </th>
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Duration
                    </th>
                    <th className="text-left px-3 py-2 text-xs text-muted-foreground uppercase tracking-wider font-medium">
                      Error
                    </th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredRuns.map((run) => (
                    <tr
                      key={run.id}
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={() => router.push(`/runs/${run.id}`)}
                    >
                      <td className="px-3 py-2.5">
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
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(run.status)}
                          {getStatusBadge(run.status)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div
                          className="font-medium text-foreground"
                          data-content-role="label"
                          data-content-label="task-name"
                        >
                          {run.task_name}
                        </div>
                        {run.workflow_name && (
                          <div
                            className="text-xs text-muted-foreground mt-0.5"
                            data-content-role="body-text"
                            data-content-label="workflow-name"
                          >
                            {run.workflow_name}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {run.phase ? (
                          <Badge variant="outline" className="text-xs">
                            {run.phase}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td
                        className="px-3 py-2.5 text-sm text-muted-foreground tabular-nums"
                        data-content-role="body-text"
                        data-content-label="started-at"
                      >
                        {formatDateTime(run.created_at)}
                      </td>
                      <td
                        className="px-3 py-2.5 text-sm tabular-nums"
                        data-content-role="metric"
                        data-content-label="duration"
                      >
                        {formatDuration(run.duration_seconds)}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-red-400 max-w-[200px] truncate">
                        {run.status === "failed"
                          ? (
                              run.summary ||
                              run.output_summary ||
                              "Failed"
                            ).substring(0, 80)
                          : "-"}
                      </td>
                      <td className="px-3 py-2.5">
                        <ArrowRight className="size-4 text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
