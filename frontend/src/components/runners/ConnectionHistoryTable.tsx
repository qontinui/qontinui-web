"use client"

import { useState } from "react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card } from "@/components/ui/card"
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Download,
  Loader2,
  Calendar,
  Filter
} from "lucide-react"
import { useConnectionHistory } from "@/hooks/useRunners"
import { formatDuration, formatRelativeTime } from "@/utils/formatDuration"
import { exportConnectionHistoryCSV } from "@/utils/exportCSV"
import type { ConnectionHistoryParams } from "@/types/runner"

export function ConnectionHistoryTable() {
  const [params, setParams] = useState<ConnectionHistoryParams>({
    limit: 25,
    offset: 0,
    search: "",
  });

  const [searchInput, setSearchInput] = useState("");
  const [pageSize, setPageSize] = useState(25);

  const { data, isLoading, error } = useConnectionHistory(params);

  const handleSearch = () => {
    setParams({ ...params, search: searchInput, offset: 0 });
  };

  const handleSearchKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setParams({ ...params, limit: newSize, offset: 0 });
  };

  const handleNextPage = () => {
    if (data && params.offset + params.limit! < data.total) {
      setParams({ ...params, offset: params.offset + params.limit! });
    }
  };

  const handlePrevPage = () => {
    if (params.offset > 0) {
      setParams({ ...params, offset: Math.max(0, params.offset - params.limit!) });
    }
  };

  const handleExport = () => {
    if (data && data.connections) {
      exportConnectionHistoryCSV(data.connections, 'connection-history.csv');
    }
  };

  const currentPage = Math.floor(params.offset / params.limit!) + 1;
  const totalPages = data ? Math.ceil(data.total / params.limit!) : 0;

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500">Failed to load connection history</p>
        <p className="text-sm text-gray-400 mt-2">{error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters and Actions */}
      <Card className="bg-[#1A1A1B] border-gray-800 p-4">
        <div className="flex flex-col md:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search by runner name or IP address..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyPress={handleSearchKeyPress}
                className="pl-10 bg-[#0A0A0B] border-gray-700"
              />
            </div>
            <Button
              onClick={handleSearch}
              className="bg-[#00D9FF] hover:bg-[#00B8DB] text-black"
            >
              Search
            </Button>
          </div>

          {/* Export */}
          <Button
            onClick={handleExport}
            variant="outline"
            className="border-gray-700"
            disabled={!data || data.connections.length === 0}
          >
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </Card>

      {/* Table */}
      <Card className="bg-[#1A1A1B] border-gray-800">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-gray-800 hover:bg-transparent">
                <TableHead className="text-gray-400">Runner</TableHead>
                <TableHead className="text-gray-400">Connected</TableHead>
                <TableHead className="text-gray-400">Disconnected</TableHead>
                <TableHead className="text-gray-400">Duration</TableHead>
                <TableHead className="text-gray-400">IP Address</TableHead>
                <TableHead className="text-gray-400">Project</TableHead>
                <TableHead className="text-gray-400">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-[#00D9FF]" />
                    <p className="text-gray-400 mt-2">Loading connection history...</p>
                  </TableCell>
                </TableRow>
              ) : !data || data.connections.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12">
                    <Calendar className="w-12 h-12 mx-auto text-gray-600 mb-3" />
                    <p className="text-gray-400">No connection history found</p>
                    {params.search && (
                      <p className="text-sm text-gray-500 mt-1">
                        Try adjusting your search criteria
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                data.connections.map((connection) => {
                  const isActive = !connection.disconnected_at;
                  const duration = connection.duration_seconds
                    ? formatDuration(connection.duration_seconds)
                    : isActive
                    ? 'Active'
                    : 'Unknown';

                  return (
                    <TableRow
                      key={connection.id}
                      className="border-gray-800 hover:bg-[#0A0A0B]"
                    >
                      <TableCell className="font-medium text-white">
                        {connection.runner_name || 'Unknown'}
                      </TableCell>
                      <TableCell className="text-gray-300">
                        {formatRelativeTime(connection.connected_at)}
                      </TableCell>
                      <TableCell className="text-gray-300">
                        {connection.disconnected_at
                          ? formatRelativeTime(connection.disconnected_at)
                          : '-'}
                      </TableCell>
                      <TableCell className="text-gray-300">{duration}</TableCell>
                      <TableCell className="text-gray-300 font-mono text-xs">
                        {connection.ip_address || 'Unknown'}
                      </TableCell>
                      <TableCell className="text-gray-300">
                        {connection.project_name || '-'}
                      </TableCell>
                      <TableCell>
                        {isActive ? (
                          <Badge
                            variant="outline"
                            className="border-green-500/50 text-green-500"
                          >
                            Active
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="border-gray-500/50 text-gray-400"
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
        {data && data.connections.length > 0 && (
          <div className="border-t border-gray-800 p-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-400">
                Showing {params.offset + 1} to{' '}
                {Math.min(params.offset + params.limit!, data.total)} of {data.total} results
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">Rows per page:</span>
                <select
                  value={pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  className="px-2 py-1 bg-[#0A0A0B] border border-gray-700 rounded text-white text-sm"
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrevPage}
                disabled={params.offset === 0}
                className="border-gray-700"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNextPage}
                disabled={params.offset + params.limit! >= data.total}
                className="border-gray-700"
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
