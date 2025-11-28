"use client";

import { useState } from "react";
import { useTestRuns, useExportTestRun } from "@/hooks/useTesting";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  PlayCircle,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
} from "lucide-react";
import { format } from "date-fns";
import { useRouter } from "next/navigation";
import type { TestRunFilters } from "@/services/testing-service";

interface TestRunsListProps {
  projectId?: string;
  workflowId?: string;
}

export function TestRunsList({ projectId, workflowId }: TestRunsListProps) {
  const router = useRouter();
  const [filters, setFilters] = useState<TestRunFilters>({
    project_id: projectId,
    workflow_id: workflowId,
    page: 1,
    page_size: 10,
    sort_by: "created_at",
    sort_order: "desc",
  });

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateRangeFilter, setDateRangeFilter] = useState<string>("all");

  const { data, isLoading, error } = useTestRuns(filters);
  const exportTestRun = useExportTestRun();

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({ ...prev, page: newPage }));
  };

  const handleStatusFilterChange = (value: string) => {
    setStatusFilter(value);
    setFilters((prev) => ({
      ...prev,
      status: value === "all" ? undefined : (value as any),
      page: 1,
    }));
  };

  const handleExport = async (
    runId: string,
    format: "json" | "csv" | "pdf"
  ) => {
    try {
      await exportTestRun.mutateAsync({ id: runId, format });
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "failed":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "running":
        return <PlayCircle className="w-4 h-4 text-blue-500 animate-pulse" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge className="bg-green-500/20 text-green-500 border-green-500/30">
            Completed
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
          <Badge className="bg-blue-500/20 text-blue-500 border-blue-500/30">
            Running
          </Badge>
        );
      default:
        return (
          <Badge className="bg-gray-500/20 text-gray-500 border-gray-500/30">
            Unknown
          </Badge>
        );
    }
  };

  const getCoverageColor = (percentage: number) => {
    if (percentage >= 80) return "text-green-500";
    if (percentage >= 60) return "text-yellow-500";
    return "text-red-500";
  };

  if (isLoading) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-gray-400">Loading test runs...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
        <CardContent className="p-12 text-center">
          <div className="text-red-400">
            Error loading test runs: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  const runs = data?.items || [];
  const totalPages = data?.total_pages || 1;
  const currentPage = data?.page || 1;

  return (
    <Card className="bg-[#1A1A1B]/50 border-gray-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Test Runs</CardTitle>
          <div className="flex items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={handleStatusFilterChange}
            >
              <SelectTrigger className="w-[150px] bg-[#0A0A0B]/50 border-gray-700">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="running">Running</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {runs.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            No test runs found. Run your first test to see results here.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800/50">
                    <TableHead>Status</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Coverage</TableHead>
                    <TableHead>Success Rate</TableHead>
                    <TableHead>Deficiencies</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow
                      key={run.id}
                      className="border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                      onClick={() => router.push(`/testing/runs/${run.id}`)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {getStatusIcon(run.status)}
                          {getStatusBadge(run.status)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{run.workflow_name}</div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm text-gray-400">
                          {format(
                            new Date(run.start_time),
                            "MMM dd, yyyy HH:mm"
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          {run.duration_seconds
                            ? `${Math.floor(run.duration_seconds / 60)}m ${run.duration_seconds % 60}s`
                            : "-"}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div
                          className={`font-medium ${getCoverageColor(run.coverage_percentage)}`}
                        >
                          {run.coverage_percentage.toFixed(1)}%
                        </div>
                        <div className="text-xs text-gray-500">
                          {run.states_covered}/{run.total_states} states
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">
                          {run.total_transitions > 0
                            ? (
                                (run.successful_transitions /
                                  run.total_transitions) *
                                100
                              ).toFixed(1)
                            : 0}
                          %
                        </div>
                        <div className="text-xs text-gray-500">
                          {run.successful_transitions}/{run.total_transitions}{" "}
                          transitions
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            run.deficiencies_found > 0
                              ? "destructive"
                              : "secondary"
                          }
                          className={
                            run.deficiencies_found > 0
                              ? "bg-red-500/20 text-red-400 border-red-500/30"
                              : "bg-gray-500/20 text-gray-400 border-gray-500/30"
                          }
                        >
                          {run.deficiencies_found}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExport(run.id, "json");
                          }}
                          className="hover:text-[#00D9FF]"
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <div className="text-sm text-gray-400">
                  Page {currentPage} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="border-gray-700 hover:border-[#00D9FF] hover:text-[#00D9FF]"
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
  );
}
