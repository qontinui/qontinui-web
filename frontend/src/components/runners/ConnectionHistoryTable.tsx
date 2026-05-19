"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Download,
  Loader2,
  Calendar,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { useRunnerSessions } from "@/hooks/useRunners";
import { formatDuration, formatRelativeTime } from "@/utils/formatDuration";
import { exportRunnerSessionsCSV } from "@/utils/exportCSV";
import type { RunnerSessionFilters } from "@/types/runner";

/**
 * Session History table — replaces the legacy "Connection History" view.
 * Reads from `GET /api/v1/devices/sessions` (Phase 2 unified endpoint).
 */
export function ConnectionHistoryTable() {
  const [filters, setFilters] = useState<RunnerSessionFilters>({
    limit: 25,
    offset: 0,
    search: "",
  });

  const [searchInput, setSearchInput] = useState("");
  const [pageSize, setPageSize] = useState(25);

  const { data, isLoading, error, refetch, isRefetching } =
    useRunnerSessions(filters);

  const handleSearch = () => {
    setFilters({ ...filters, search: searchInput, offset: 0 });
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setFilters({ ...filters, limit: newSize, offset: 0 });
  };

  const handleNextPage = () => {
    const limit = filters.limit ?? 25;
    const offset = filters.offset ?? 0;
    if (data && offset + limit < data.total) {
      setFilters({ ...filters, offset: offset + limit });
    }
  };

  const handlePrevPage = () => {
    const limit = filters.limit ?? 25;
    const offset = filters.offset ?? 0;
    if (offset > 0) {
      setFilters({
        ...filters,
        offset: Math.max(0, offset - limit),
      });
    }
  };

  const handleExport = () => {
    if (data && data.sessions) {
      exportRunnerSessionsCSV(data.sessions, "runner-sessions.csv");
    }
  };

  const limit = filters.limit ?? 25;
  const offset = filters.offset ?? 0;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  if (error) {
    const isConnectionError =
      error.message?.includes("fetch failed") ||
      error.message?.includes("proxy") ||
      error.message?.includes("network");
    return (
      <Card className="bg-surface-raised border-border-subtle p-12">
        <div className="text-center">
          <WifiOff className="w-16 h-16 mx-auto text-text-muted mb-4" />
          <h3 className="text-xl font-semibold text-text-muted mb-2">
            {isConnectionError
              ? "Unable to Connect to Server"
              : "Failed to Load History"}
          </h3>
          <p className="text-text-muted mb-6 max-w-md mx-auto">
            {isConnectionError
              ? "The backend server appears to be offline or unreachable. Please ensure the server is running and try again."
              : error.message ||
                "An unexpected error occurred while loading session history."}
          </p>
          <Button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="bg-brand-primary hover:bg-brand-primary/80 text-black"
          >
            {isRefetching ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Retrying...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </>
            )}
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters and Actions */}
      <Card className="bg-surface-raised border-border-subtle p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-text-muted" />
              <Input
                placeholder="Search by runner name or IP address..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyPress={handleSearchKeyPress}
                className="pl-10 bg-surface-canvas border-border-default"
              />
            </div>
            <Button
              onClick={handleSearch}
              className="bg-brand-primary hover:bg-brand-primary/80 text-black"
            >
              Search
            </Button>
          </div>

          {/* Export */}
          <Button
            onClick={handleExport}
            variant="outline"
            className="border-border-default"
            disabled={!data || data.sessions.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </Card>

      {/* Table */}
      <Card className="bg-surface-raised border-border-subtle">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border-subtle hover:bg-transparent">
                <TableHead className="text-text-muted">Runner</TableHead>
                <TableHead className="text-text-muted">Connected</TableHead>
                <TableHead className="text-text-muted">Disconnected</TableHead>
                <TableHead className="text-text-muted">Duration</TableHead>
                <TableHead className="text-text-muted">IP Address</TableHead>
                <TableHead className="text-text-muted">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-brand-primary" />
                    <p className="text-text-muted mt-2">
                      Loading session history...
                    </p>
                  </TableCell>
                </TableRow>
              ) : !data || data.sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-12">
                    <Calendar className="w-12 h-12 mx-auto text-text-muted mb-3" />
                    <p className="text-text-muted">No session history found</p>
                    {filters.search && (
                      <p className="text-sm text-text-muted mt-1">
                        Try adjusting your search criteria
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                data.sessions.map((session) => {
                  const isActive = !session.disconnected_at;
                  const duration = session.duration_seconds
                    ? formatDuration(session.duration_seconds)
                    : isActive
                      ? "Active"
                      : "Unknown";

                  return (
                    <TableRow
                      key={session.id}
                      className="border-border-subtle hover:bg-surface-canvas"
                    >
                      <TableCell className="font-medium text-white">
                        {session.runner_name || "Unknown"}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {formatRelativeTime(session.connected_at)}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {session.disconnected_at
                          ? formatRelativeTime(session.disconnected_at)
                          : "—"}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {duration}
                      </TableCell>
                      <TableCell className="text-text-muted font-mono text-xs">
                        {session.ip_address || "Unknown"}
                      </TableCell>
                      <TableCell>
                        {isActive ? (
                          <Badge
                            variant="outline"
                            className="border-brand-success/50 text-brand-success"
                          >
                            Active
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-border-default text-text-muted"
                          >
                            Disconnected
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {data && data.sessions.length > 0 && (
          <div className="border-t border-border-subtle p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm text-text-muted">
                Showing {offset + 1} to {Math.min(offset + limit, data.total)}{" "}
                of {data.total} results
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-muted">Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="px-2 py-1 bg-surface-canvas border border-border-default rounded text-white text-sm"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-text-muted">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={offset === 0}
                className="border-border-default"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={offset + limit >= data.total}
                className="border-border-default"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
