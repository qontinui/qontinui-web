"use client";

import { useState } from "react";
import { useDeficiencies, useExportDeficiencies } from "@/hooks/useTesting";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
import { DeficiencyCard } from "./DeficiencyCard";
import type { DeficiencyFilters } from "@/services/testing-service";

interface DeficiencyListProps {
  projectId?: string;
  testRunId?: string;
}

export function DeficiencyList({ projectId, testRunId }: DeficiencyListProps) {
  const [filters, setFilters] = useState<DeficiencyFilters>({
    project_id: projectId,
    test_run_id: testRunId,
    page: 1,
    page_size: 20,
    sort_by: "created_at",
    sort_order: "desc",
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data, isLoading, error } = useDeficiencies(filters);
  const exportDeficiencies = useExportDeficiencies();

  const handleSearch = () => {
    setFilters((prev) => ({
      ...prev,
      search: searchQuery || undefined,
      page: 1,
    }));
  };

  const handleSeverityChange = (value: string) => {
    setSeverityFilter(value);
    setFilters((prev) => ({
      ...prev,
      severity:
        value === "all"
          ? undefined
          : (value as "low" | "medium" | "high" | "critical"),
      page: 1,
    }));
  };

  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setFilters((prev) => ({
      ...prev,
      status:
        value === "all"
          ? undefined
          : (value as "open" | "in_progress" | "resolved" | "wont_fix"),
      page: 1,
    }));
  };

  const handlePageChange = (newPage: number) => {
    setFilters((prev) => ({ ...prev, page: newPage }));
  };

  const handleExport = async (format: "json" | "csv") => {
    try {
      await exportDeficiencies.mutateAsync({ filters, format });
    } catch (error) {
      console.error("Export failed:", error);
    }
  };

  if (isLoading) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-12 text-center">
          <div className="text-text-muted">Loading deficiencies...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="p-12 text-center">
          <div className="text-red-400">
            Error loading deficiencies: {error.message}
          </div>
        </CardContent>
      </Card>
    );
  }

  const deficiencies = data?.items || [];
  const totalPages = data?.total_pages || 1;
  const currentPage = data?.page || 1;

  return (
    <Card
      className="bg-surface-raised/50 border-border-subtle/50"
      data-ui-id="testing-deficiency-list"
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-xl">Deficiencies</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleExport("csv")}
              className="border-border-default hover:border-brand-primary hover:text-brand-primary"
              data-ui-id="testing-deficiency-list-export-btn"
            >
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="md:col-span-2">
            <div className="flex gap-2">
              <Input
                placeholder="Search deficiencies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="bg-surface-canvas/50 border-border-default focus:border-brand-primary"
                data-ui-id="testing-deficiency-list-search-input"
              />
              <Button
                onClick={handleSearch}
                className="bg-brand-primary hover:bg-brand-primary/80 text-black"
                data-ui-id="testing-deficiency-list-search-btn"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <Select value={severityFilter} onValueChange={handleSeverityChange}>
            <SelectTrigger
              className="bg-surface-canvas/50 border-border-default"
              data-ui-id="testing-deficiency-list-severity-select"
            >
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={handleStatusChange}>
            <SelectTrigger
              className="bg-surface-canvas/50 border-border-default"
              data-ui-id="testing-deficiency-list-status-select"
            >
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
              <SelectItem value="wont_fix">Won&apos;t Fix</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Results */}
        {deficiencies.length === 0 ? (
          <div className="text-center py-12 text-text-muted">
            No deficiencies found. Adjust your filters or run more tests.
          </div>
        ) : (
          <>
            <div className="space-y-4">
              {deficiencies.map((deficiency) => (
                <DeficiencyCard key={deficiency.id} deficiency={deficiency} />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6">
                <div className="text-sm text-text-muted">
                  Page {currentPage} of {totalPages} • {data?.total || 0} total
                  deficiencies
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="border-border-default hover:border-brand-primary hover:text-brand-primary"
                    data-ui-id="testing-deficiency-list-prev-btn"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="border-border-default hover:border-brand-primary hover:text-brand-primary"
                    data-ui-id="testing-deficiency-list-next-btn"
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
