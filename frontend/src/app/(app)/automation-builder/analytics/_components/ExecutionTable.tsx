"use client";

import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Eye, ArrowUpDown } from "lucide-react";
import { formatDuration, formatRelativeTime } from "../analytics-utils";
import type { ExecutionRecord } from "../analytics-types";

interface ExecutionTableProps {
  executions: ExecutionRecord[];
  onRowClick?: (execution: ExecutionRecord) => void;
}

export function ExecutionTable({
  executions,
  onRowClick,
}: ExecutionTableProps) {
  const [sortBy, setSortBy] = useState<
    "startTime" | "duration" | "workflowName"
  >("startTime");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const sortedExecutions = useMemo(() => {
    return [...executions].sort((a, b) => {
      let aVal: unknown = a[sortBy];
      let bVal: unknown = b[sortBy];

      if (sortBy === "startTime") {
        aVal = new Date(aVal as string | number | Date).getTime();
        bVal = new Date(bVal as string | number | Date).getTime();
      }

      if (sortOrder === "asc") {
        return (aVal as number) > (bVal as number) ? 1 : -1;
      } else {
        return (aVal as number) < (bVal as number) ? 1 : -1;
      }
    });
  }, [executions, sortBy, sortOrder]);

  const paginatedExecutions = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return sortedExecutions.slice(start, start + itemsPerPage);
  }, [sortedExecutions, currentPage]);

  const totalPages = Math.ceil(executions.length / itemsPerPage);

  const toggleSort = (column: typeof sortBy) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortOrder("desc");
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSort("workflowName")}
                    className="hover:bg-transparent"
                  >
                    Workflow
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSort("startTime")}
                    className="hover:bg-transparent"
                  >
                    Timestamp
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleSort("duration")}
                    className="hover:bg-transparent"
                  >
                    Duration
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  Status
                </th>
                <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {paginatedExecutions.map((execution) => (
                <tr
                  key={execution.id}
                  className="border-b transition-colors hover:bg-muted/50 cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() => onRowClick?.(execution)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onRowClick?.(execution);
                    }
                  }}
                >
                  <td className="p-4 align-middle">
                    <div className="font-medium">{execution.workflowName}</div>
                    <div className="text-xs text-muted-foreground">
                      {execution.workflowId.substring(0, 8)}...
                    </div>
                  </td>
                  <td className="p-4 align-middle">
                    <div className="text-sm">
                      {new Date(execution.startTime).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatRelativeTime(execution.startTime)}
                    </div>
                  </td>
                  <td className="p-4 align-middle">
                    <Badge variant="outline">
                      {formatDuration(execution.duration)}
                    </Badge>
                  </td>
                  <td className="p-4 align-middle">
                    {execution.success ? (
                      <Badge
                        variant="default"
                        className="bg-green-500/20 text-green-400 border-green-500/30"
                      >
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Success
                      </Badge>
                    ) : (
                      <Badge variant="destructive">
                        <XCircle className="h-3 w-3 mr-1" />
                        Failed
                      </Badge>
                    )}
                  </td>
                  <td className="p-4 align-middle">
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4 mr-2" />
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(currentPage - 1) * itemsPerPage + 1} to{" "}
            {Math.min(currentPage * itemsPerPage, executions.length)} of{" "}
            {executions.length} executions
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }

                return (
                  <Button
                    key={pageNum}
                    variant={currentPage === pageNum ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(pageNum)}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
