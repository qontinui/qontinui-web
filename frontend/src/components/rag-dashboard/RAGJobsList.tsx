"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { JobStatusBadge } from "./JobStatusBadge";
import { ChevronLeft, ChevronRight, History } from "lucide-react";
import { useRAGJobs } from "@/hooks/useRAGDashboard";
import type { JobItem, JobStatus } from "@/types/rag-dashboard";

interface RAGJobsListProps {
  projectId: string;
}

export function RAGJobsList({ projectId }: RAGJobsListProps) {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<JobStatus | undefined>(
    undefined
  );
  const limit = 20;

  const { data, isLoading, error } = useRAGJobs(projectId, {
    page,
    limit,
    status_filter: statusFilter,
  });

  const handleStatusChange = (value: string) => {
    setStatusFilter(value === "all" ? undefined : (value as JobStatus));
    setPage(1);
  };

  const formatDuration = (job: JobItem): string => {
    if (!job.started_at) return "-";
    const start = new Date(job.started_at);
    const end = job.completed_at ? new Date(job.completed_at) : new Date();
    const seconds = Math.floor((end.getTime() - start.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  if (error) {
    return (
      <Card className="bg-red-900/20 border-red-800">
        <CardContent className="p-6">
          <p className="text-red-400">Failed to load jobs: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-surface-canvas/50 border-border-subtle">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-white">Processing History</CardTitle>
          <Select
            value={statusFilter ?? "all"}
            onValueChange={handleStatusChange}
          >
            <SelectTrigger className="w-48 bg-surface-raised border-border-default">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent className="bg-surface-raised border-border-default">
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full bg-surface-raised" />
            ))}
          </div>
        ) : !data?.items.length ? (
          <div className="text-center py-12">
            <History className="w-12 h-12 text-text-muted mx-auto mb-4" />
            <p className="text-text-muted text-lg">No processing history</p>
            <p className="text-text-muted text-sm mt-1">
              Run RAG pre-processing from the runner to see history here
            </p>
          </div>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="border-border-subtle">
                  <TableHead className="text-text-muted">Status</TableHead>
                  <TableHead className="text-text-muted">Progress</TableHead>
                  <TableHead className="text-text-muted">Duration</TableHead>
                  <TableHead className="text-text-muted">Started</TableHead>
                  <TableHead className="text-text-muted">Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((job: JobItem) => (
                  <TableRow key={job.id} className="border-border-subtle">
                    <TableCell>
                      <JobStatusBadge status={job.status} />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-2 bg-surface-raised rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              job.status === "completed"
                                ? "bg-brand-success"
                                : job.status === "failed"
                                  ? "bg-red-500"
                                  : "bg-brand-primary"
                            }`}
                            style={{ width: `${job.progress_percent}%` }}
                          />
                        </div>
                        <span className="text-xs text-text-muted">
                          {job.processed_patterns}/{job.total_patterns}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-text-default">
                        {formatDuration(job)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-text-muted text-sm">
                        {job.started_at
                          ? new Date(job.started_at).toLocaleString()
                          : "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {job.error_message ? (
                        <span className="text-red-400 text-sm truncate max-w-[200px] block">
                          {job.error_message}
                        </span>
                      ) : (
                        <span className="text-text-muted">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-border-subtle">
              <p className="text-sm text-text-muted">
                Showing {(page - 1) * limit + 1} -{" "}
                {Math.min(page * limit, data.total)} of {data.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="border-border-default"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-text-muted">
                  Page {page} of {Math.ceil(data.total / limit)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={!data.has_more}
                  className="border-border-default"
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
