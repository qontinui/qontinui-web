"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  XCircle,
  Clock,
  Image as ImageIcon,
  ChevronRight,
  Search,
  RefreshCw,
  Calendar,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { listExecutionRuns } from "@/services/execution-service";
import {
  RunStatus,
  type ExecutionRunResponse,
} from "@/types/generated/execution";

export function SessionHistory() {
  const [runs, setRuns] = useState<ExecutionRunResponse[]>([]);
  const [selectedRun, setSelectedRun] = useState<ExecutionRunResponse | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterStatus]);

  const loadRuns = async () => {
    try {
      setLoading(true);
      const params: {
        limit: number;
        status?: RunStatus;
      } = { limit: 50 };
      if (filterStatus !== "all") {
        // Map filter value to RunStatus enum
        const statusMap: Record<string, RunStatus> = {
          running: RunStatus.RUNNING,
          completed: RunStatus.COMPLETED,
          failed: RunStatus.FAILED,
        };
        params.status = statusMap[filterStatus];
      }
      const data = await listExecutionRuns(params);
      setRuns(data.runs);
    } catch (error) {
      console.error("Failed to load execution runs:", error);
      toast.error("Failed to load execution history");
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <Clock className="h-4 w-4 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="h-4 w-4 text-gray-500" />;
    }
  };

  const getStatusVariant = (
    status: string
  ): "default" | "secondary" | "destructive" | "outline" => {
    switch (status) {
      case "completed":
        return "default";
      case "failed":
        return "destructive";
      case "running":
        return "secondary";
      default:
        return "outline";
    }
  };

  const filteredRuns = runs.filter((run) => {
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        run.id.toLowerCase().includes(query) ||
        run.run_name?.toLowerCase().includes(query) ||
        run.project_id?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const formatDuration = (seconds: number | null | undefined): string => {
    if (seconds === null || seconds === undefined) return "N/A";
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-full">
      {/* Runs List */}
      <Card
        className="lg:col-span-1 flex flex-col"
        data-awas-action="list_automation_sessions"
      >
        <CardHeader>
          <div className="flex items-center justify-between mb-4">
            <CardTitle>Execution History</CardTitle>
            <Button
              size="sm"
              variant="outline"
              onClick={loadRuns}
              data-awas-trigger="click"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search runs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger data-awas-param-status={filterStatus}>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Runs</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="flex-1 min-h-0 p-0">
          <ScrollArea className="h-[600px]">
            {loading ? (
              <div className="flex items-center justify-center p-8">
                <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-8 text-center">
                <Calendar className="h-12 w-12 text-muted-foreground mb-2" />
                <p className="text-muted-foreground">No execution runs found</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Run a workflow to see execution history
                </p>
              </div>
            ) : (
              <div className="space-y-1 p-2">
                {filteredRuns.map((run) => (
                  <button
                    key={run.id}
                    onClick={() => setSelectedRun(run)}
                    className={`w-full text-left p-3 rounded-md transition-colors ${
                      selectedRun?.id === run.id
                        ? "bg-primary/10 border border-primary"
                        : "hover:bg-muted/50 border border-transparent"
                    }`}
                    data-awas-action="get_automation_session"
                    data-awas-trigger="click"
                    data-awas-param-session_id={run.id}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(run.status)}
                        <Badge variant={getStatusVariant(run.status)}>
                          {run.status}
                        </Badge>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium mb-1 truncate">
                      {run.run_name || "Unnamed Run"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(run.started_at), {
                        addSuffix: true,
                      })}
                    </p>
                    {run.duration_seconds !== null &&
                      run.duration_seconds !== undefined && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Duration: {formatDuration(run.duration_seconds)}
                        </p>
                      )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Run Details */}
      <div className="lg:col-span-2 space-y-4">
        {selectedRun ? (
          <>
            {/* Run Info */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Play className="h-5 w-5" />
                      {selectedRun.run_name || "Execution Run"}
                    </CardTitle>
                    <CardDescription className="mt-1 font-mono text-xs">
                      {selectedRun.id}
                    </CardDescription>
                  </div>
                  <Badge variant={getStatusVariant(selectedRun.status)}>
                    {selectedRun.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Run Type:</span>
                    <p className="font-medium">
                      {selectedRun.run_type || "N/A"}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Started:</span>
                    <p className="font-medium">
                      {new Date(selectedRun.started_at).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Duration:</span>
                    <p className="font-medium">
                      {formatDuration(selectedRun.duration_seconds)}
                    </p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Ended:</span>
                    <p className="font-medium">
                      {selectedRun.ended_at
                        ? new Date(selectedRun.ended_at).toLocaleString()
                        : "In progress..."}
                    </p>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Project ID:</span>
                    <p className="font-mono text-xs mt-1">
                      {selectedRun.project_id || "N/A"}
                    </p>
                  </div>
                </div>

                {/* Runner Metadata */}
                {selectedRun.runner_metadata && (
                  <div className="mt-4 p-3 bg-muted/50 rounded-md">
                    <p className="text-sm font-medium mb-2">Runner Info</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {selectedRun.runner_metadata.runner_version && (
                        <div>
                          <span className="text-muted-foreground">
                            Version:
                          </span>
                          <span className="ml-1">
                            {selectedRun.runner_metadata.runner_version}
                          </span>
                        </div>
                      )}
                      {selectedRun.runner_metadata.os && (
                        <div>
                          <span className="text-muted-foreground">OS:</span>
                          <span className="ml-1">
                            {selectedRun.runner_metadata.os}
                          </span>
                        </div>
                      )}
                      {selectedRun.runner_metadata.hostname && (
                        <div>
                          <span className="text-muted-foreground">
                            Hostname:
                          </span>
                          <span className="ml-1">
                            {selectedRun.runner_metadata.hostname}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Placeholder for detailed view */}
            <Card>
              <CardContent className="py-8 text-center">
                <ImageIcon className="h-12 w-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-muted-foreground">
                  For detailed execution tree view, visit the{" "}
                  <Link
                    href="/execution-history"
                    className="text-primary hover:underline"
                  >
                    Execution History
                  </Link>{" "}
                  page
                </p>
              </CardContent>
            </Card>
          </>
        ) : (
          <Card className="h-full flex items-center justify-center">
            <CardContent className="text-center py-12">
              <Calendar className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <p className="text-lg font-medium mb-2">No Run Selected</p>
              <p className="text-sm text-muted-foreground">
                Select an execution run from the list to view details
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
