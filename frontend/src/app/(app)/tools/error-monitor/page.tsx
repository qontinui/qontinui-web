"use client";

import { useState, useMemo, useEffect } from "react";
import { usePageSpecs } from "@/hooks/usePageSpecs";
import type { SpecConfig } from "@qontinui/ui-bridge/specs";
import pageSpecJson from "./error-monitor.spec.uibridge.json";
import {
  useRunnerHealth,
  useErrorMonitorEntries,
  runnerApi,
} from "@/lib/runner-api";
import { RunnerPartialState } from "@/components/runner/RunnerPartialState";
import { ErrorEntryCard } from "@/components/error-monitor/ErrorEntryCard";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
  Wrench,
  FileText,
  X,
} from "lucide-react";

const pageSpec = pageSpecJson as unknown as SpecConfig;

// ============================================================================
// Types & Constants
// ============================================================================

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

// ============================================================================
// Main Page
// ============================================================================

export default function ErrorMonitorPage() {
  usePageSpecs({ "error-monitor": pageSpec });
  const { isOffline, isLoading: healthLoading } = useRunnerHealth();
  const {
    data: entries,
    isLoading: entriesLoading,
    error: entriesError,
    refetch,
  } = useErrorMonitorEntries();

  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showFilters, setShowFilters] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<number | null>(null);
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const [_lastRefresh, setLastRefresh] = useState(new Date());

  // Auto-refresh timer
  useEffect(() => {
    const interval = setInterval(() => {
      refetch();
      setLastRefresh(new Date());
    }, 30000);
    return () => clearInterval(interval);
  }, [refetch]);

  const handleAcknowledge = async (id: number) => {
    setAcknowledgingId(id);
    try {
      await runnerApi.acknowledgeError(id);
      refetch();
    } catch {
      // silent
    } finally {
      setAcknowledgingId(null);
    }
  };

  const handleResolve = async (id: number, notes?: string) => {
    setResolvingId(id);
    try {
      await runnerApi.resolveError(id, notes);
      refetch();
    } catch {
      // silent
    } finally {
      setResolvingId(null);
    }
  };

  const handleFixErrors = async () => {
    setFixLoading(true);
    setFixError(null);
    try {
      await runnerApi.generateFixWorkflow();
      refetch();
    } catch (err) {
      setFixError(
        err instanceof Error ? err.message : "Failed to generate fix workflow"
      );
    } finally {
      setFixLoading(false);
    }
  };

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

  if (healthLoading) {
    return (
      <div className="h-[calc(100vh-44px)] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-44px)] flex flex-col bg-background overflow-hidden text-white">
      <header className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-red-400" />
          <h1 className="text-lg font-semibold text-foreground">
            Error Monitor
          </h1>
          {counts.unresolved > 0 && (
            <Badge variant="destructive" className="gap-1">
              {counts.unresolved} unresolved
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Fix Errors Button */}
          {counts.unresolved > 0 && (
            <Button
              onClick={handleFixErrors}
              disabled={fixLoading}
              className={`font-semibold ${
                counts.critical > 0
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : counts.error > 0
                    ? "bg-amber-600 hover:bg-amber-700 text-white"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {fixLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Generating Fix...
                </>
              ) : (
                <>
                  <Wrench className="w-4 h-4 mr-2" />
                  Fix Errors ({counts.unresolved})
                </>
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              refetch();
              setLastRefresh(new Date());
            }}
            className="text-muted-foreground hover:text-white"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto space-y-6 w-full">
        {isOffline && (
          <RunnerPartialState message="Runner offline — this tool requires the runner for execution" />
        )}

        {/* Fix error */}
        {fixError && (
          <div className="flex items-center justify-between text-red-400 bg-red-950/20 border border-red-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4" />
              <p className="text-sm">{fixError}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-red-400"
              onClick={() => setFixError(null)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-5 gap-4">
          <Card className="bg-muted border-border">
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider">
                Total
              </p>
              <p className="text-2xl font-bold text-foreground mt-1">
                {counts.total}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-red-950/30 border-red-500/40">
            <CardContent className="py-4">
              <p className="text-xs text-red-500 uppercase tracking-wider">
                Critical
              </p>
              <p className="text-2xl font-bold text-red-400 mt-1">
                {counts.critical}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-red-950/20 border-red-500/30">
            <CardContent className="py-4">
              <p className="text-xs text-red-400 uppercase tracking-wider">
                Errors
              </p>
              <p className="text-2xl font-bold text-red-400 mt-1">
                {counts.error}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-amber-950/20 border-amber-500/30">
            <CardContent className="py-4">
              <p className="text-xs text-amber-400 uppercase tracking-wider">
                Warnings
              </p>
              <p className="text-2xl font-bold text-amber-400 mt-1">
                {counts.warning}
              </p>
            </CardContent>
          </Card>
          <Card className="bg-blue-950/20 border-blue-500/30">
            <CardContent className="py-4">
              <p className="text-xs text-blue-400 uppercase tracking-wider">
                Info
              </p>
              <p className="text-2xl font-bold text-blue-400 mt-1">
                {counts.info}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Search & Filters */}
        <Card className="bg-muted border-border">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search messages, sources, error types..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 bg-muted border-border text-white placeholder:text-muted-foreground"
                />
              </div>
              <Button
                variant={showFilters ? "default" : "ghost"}
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={
                  showFilters ? "" : "text-muted-foreground hover:text-white"
                }
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
              <div className="flex flex-wrap gap-4 pt-2 border-t border-border">
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">
                    Severity
                  </p>
                  <div className="flex items-center gap-1">
                    {SEVERITY_FILTERS.map((f) => (
                      <Button
                        key={f.value}
                        variant={
                          severityFilter === f.value ? "default" : "ghost"
                        }
                        size="sm"
                        onClick={() => setSeverityFilter(f.value)}
                        className={`text-xs ${severityFilter === f.value ? "" : "text-muted-foreground hover:text-white"}`}
                      >
                        {f.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1.5">Status</p>
                  <div className="flex items-center gap-1">
                    {STATUS_FILTERS.map((f) => (
                      <Button
                        key={f.value}
                        variant={statusFilter === f.value ? "default" : "ghost"}
                        size="sm"
                        onClick={() => setStatusFilter(f.value)}
                        className={`text-xs ${statusFilter === f.value ? "" : "text-muted-foreground hover:text-white"}`}
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
                      className="text-xs text-muted-foreground hover:text-white"
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

        {/* Error Entries */}
        <Card className="bg-muted border-border">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg text-white flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Log Entries
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {filteredEntries.length} entr
                  {filteredEntries.length === 1 ? "y" : "ies"}
                  {activeFilterCount > 0 && " (filtered)"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Auto-refresh 30s
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {entriesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="h-16 bg-muted/50 rounded-lg animate-pulse"
                  />
                ))}
              </div>
            ) : entriesError ? (
              <div className="flex items-center gap-2 text-red-400 py-8 justify-center">
                <AlertCircle className="w-5 h-5" />
                <p className="text-sm">Failed to load error entries</p>
              </div>
            ) : filteredEntries.length === 0 ? (
              <div className="text-center py-12">
                <ShieldAlert className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {entries && entries.length > 0
                    ? "No entries match your filters"
                    : "No log entries detected. Monitoring is active."}
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[700px] overflow-y-auto">
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
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
