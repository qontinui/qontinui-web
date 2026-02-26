"use client";

import { useState, useMemo, useCallback } from "react";
import {
  useRunnerQuery,
  runnerApi,
  type ErrorMonitorEntry,
} from "@/lib/runner-api";
import { ErrorEntryCard } from "@/components/error-monitor/ErrorEntryCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Search,
  Loader2,
  AlertCircle,
  Filter,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

// =============================================================================
// Types & Constants
// =============================================================================

type SeverityFilter = "all" | "critical" | "error" | "warning" | "info";
type StatusFilter = "all" | "new" | "acknowledged" | "resolved" | "ignored";

const SEVERITY_FILTERS: { value: SeverityFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "critical", label: "Critical" },
  { value: "error", label: "Error" },
  { value: "warning", label: "Warning" },
  { value: "info", label: "Info" },
];

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
];

// =============================================================================
// Component
// =============================================================================

interface ErrorMonitorTabProps {
  taskRunId: string;
}

export function ErrorMonitorTab({ taskRunId }: ErrorMonitorTabProps) {
  const {
    data: entries,
    isLoading,
    error: fetchError,
    refetch,
  } = useRunnerQuery<ErrorMonitorEntry[]>(
    `/error-monitor/errors?task_run_id=${taskRunId}`,
    { pollInterval: 30000 }
  );

  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<number | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);

  const handleAcknowledge = useCallback(
    async (id: number) => {
      setAcknowledgingId(id);
      try {
        await runnerApi.acknowledgeError(id);
        refetch();
      } catch {
        // silent
      } finally {
        setAcknowledgingId(null);
      }
    },
    [refetch]
  );

  const handleResolve = useCallback(
    async (id: number, notes?: string) => {
      setResolvingId(id);
      try {
        await runnerApi.resolveError(id, notes);
        refetch();
      } catch {
        // silent
      } finally {
        setResolvingId(null);
      }
    },
    [refetch]
  );

  const filteredEntries = useMemo(() => {
    if (!entries) return [];
    let filtered = [...entries];

    if (severityFilter !== "all") {
      filtered = filtered.filter(
        (e) => e.severity.toLowerCase() === severityFilter
      );
    }

    if (statusFilter !== "all") {
      filtered = filtered.filter(
        (e) => e.status.toLowerCase() === statusFilter
      );
    }

    if (searchQuery.trim()) {
      const lower = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (e) =>
          e.message.toLowerCase().includes(lower) ||
          e.log_source_name.toLowerCase().includes(lower) ||
          (e.error_type ?? "").toLowerCase().includes(lower)
      );
    }

    filtered.sort(
      (a, b) =>
        new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
    );

    return filtered;
  }, [entries, severityFilter, statusFilter, searchQuery]);

  const counts = useMemo(() => {
    if (!entries)
      return {
        critical: 0,
        error: 0,
        warning: 0,
        info: 0,
        total: 0,
        unresolved: 0,
      };
    return {
      critical: entries.filter((e) => e.severity.toLowerCase() === "critical")
        .length,
      error: entries.filter((e) => e.severity.toLowerCase() === "error").length,
      warning: entries.filter((e) => e.severity.toLowerCase() === "warning")
        .length,
      info: entries.filter((e) => e.severity.toLowerCase() === "info").length,
      total: entries.length,
      unresolved: entries.filter(
        (e) => e.status !== "resolved" && e.status !== "ignored"
      ).length,
    };
  }, [entries]);

  const activeFilterCount =
    (severityFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0);

  // Loading state
  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Loader2 className="size-5 animate-spin mx-auto mb-2" />
        Loading error entries...
      </div>
    );
  }

  // Error state
  if (fetchError) {
    return (
      <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
        <AlertCircle className="w-5 h-5" />
        <p className="text-sm">Failed to load error entries</p>
      </div>
    );
  }

  // Empty state
  if (!entries || entries.length === 0) {
    return (
      <div className="text-center py-12">
        <ShieldAlert className="w-12 h-12 mx-auto mb-3 text-text-muted" />
        <p className="text-sm text-text-muted">
          No errors detected for this run
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary row */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant="outline" className="gap-1">
          {counts.total} total
        </Badge>
        {counts.critical > 0 && (
          <Badge variant="destructive" className="gap-1">
            {counts.critical} critical
          </Badge>
        )}
        {counts.error > 0 && (
          <Badge variant="destructive" className="gap-1 bg-red-600/80">
            {counts.error} error{counts.error !== 1 ? "s" : ""}
          </Badge>
        )}
        {counts.warning > 0 && (
          <Badge variant="warning" className="gap-1">
            {counts.warning} warning{counts.warning !== 1 ? "s" : ""}
          </Badge>
        )}
        {counts.info > 0 && (
          <Badge variant="info" className="gap-1">
            {counts.info} info
          </Badge>
        )}
        {counts.unresolved > 0 && (
          <Badge
            variant="outline"
            className="gap-1 border-red-500/30 text-red-400"
          >
            {counts.unresolved} unresolved
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            Auto-refresh 30s
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            className="text-text-muted hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Search & Filters */}
      <Card className="bg-surface-raised/50 border-border-subtle/50">
        <CardContent className="py-3 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <Input
                placeholder="Search messages, sources, error types..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 bg-surface-raised/50 border-border-subtle/50 text-white placeholder:text-text-muted"
              />
            </div>
            <Button
              variant={showFilters ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className={showFilters ? "" : "text-text-muted hover:text-white"}
            >
              <Filter className="w-4 h-4 mr-1" />
              Filters
              {activeFilterCount > 0 && (
                <Badge
                  variant="secondary"
                  className="ml-1 text-[10px] px-1 py-0"
                >
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          </div>
          {showFilters && (
            <div className="flex flex-wrap gap-4 pt-2 border-t border-border-subtle/30">
              <div>
                <p className="text-xs text-text-muted mb-1.5">Severity</p>
                <div className="flex items-center gap-1">
                  {SEVERITY_FILTERS.map((f) => (
                    <Button
                      key={f.value}
                      variant={severityFilter === f.value ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setSeverityFilter(f.value)}
                      className={`text-xs ${severityFilter === f.value ? "" : "text-text-muted hover:text-white"}`}
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-text-muted mb-1.5">Status</p>
                <div className="flex items-center gap-1">
                  {STATUS_FILTERS.map((f) => (
                    <Button
                      key={f.value}
                      variant={statusFilter === f.value ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setStatusFilter(f.value)}
                      className={`text-xs ${statusFilter === f.value ? "" : "text-text-muted hover:text-white"}`}
                    >
                      {f.label}
                    </Button>
                  ))}
                </div>
              </div>
              {activeFilterCount > 0 && (
                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-text-muted hover:text-white"
                    onClick={() => {
                      setSeverityFilter("all");
                      setStatusFilter("all");
                    }}
                  >
                    Clear all
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filtered count */}
      {activeFilterCount > 0 && (
        <p className="text-xs text-text-muted">
          {filteredEntries.length} entr
          {filteredEntries.length === 1 ? "y" : "ies"} (filtered)
        </p>
      )}

      {/* Error entries */}
      {filteredEntries.length === 0 ? (
        <div className="text-center py-8">
          <ShieldAlert className="w-10 h-10 mx-auto mb-2 text-text-muted" />
          <p className="text-sm text-text-muted">
            No entries match your filters
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {filteredEntries.map((entry) => (
            <ErrorEntryCard
              key={entry.id}
              entry={entry}
              onAcknowledge={handleAcknowledge}
              onResolve={handleResolve}
              acknowledging={acknowledgingId === entry.id}
              resolving={resolvingId === entry.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
