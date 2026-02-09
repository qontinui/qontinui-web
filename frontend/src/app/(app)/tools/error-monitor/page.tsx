"use client";

import { useState, useMemo, useEffect } from "react";
import {
  useRunnerHealth,
  useErrorMonitorEntries,
  runnerApi,
  type ErrorMonitorEntry,
} from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
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
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Search,
  Loader2,
  AlertCircle,
  Info,
  Filter,
  RefreshCw,
  ShieldAlert,
  Clock,
  ChevronDown,
  ChevronUp,
  Eye,
  CheckCircle2,
  Wrench,
  Bug,
  FileText,
  X,
} from "lucide-react";

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
// Helpers
// ============================================================================

function getSeverityIcon(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return <AlertCircle className="w-4 h-4 text-red-500" />;
    case "error":
      return <Bug className="w-4 h-4 text-red-400" />;
    case "warning":
      return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    case "info":
      return <Info className="w-4 h-4 text-blue-400" />;
    default:
      return <Info className="w-4 h-4 text-text-muted" />;
  }
}

function getSeverityBadgeVariant(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
    case "error":
      return "destructive" as const;
    case "warning":
      return "warning" as const;
    case "info":
      return "info" as const;
    default:
      return "secondary" as const;
  }
}

function getStatusColor(status: string) {
  switch (status.toLowerCase()) {
    case "new":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "acknowledged":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    case "in_progress":
      return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    case "resolved":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "ignored":
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    case "recurring":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    default:
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
  }
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) return "Just now";
    if (diffMinutes < 60) return `${diffMinutes}m ago`;

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

function formatStatusLabel(status: string): string {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ============================================================================
// Error Entry Card
// ============================================================================

interface ErrorEntryCardProps {
  entry: ErrorMonitorEntry;
  onAcknowledge: (id: number) => void;
  onResolve: (id: number, notes?: string) => void;
  acknowledging?: boolean;
  resolving?: boolean;
}

function ErrorEntryCard({
  entry,
  onAcknowledge,
  onResolve,
  acknowledging,
  resolving,
}: ErrorEntryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [resolveNotes, setResolveNotes] = useState("");
  const [showResolveForm, setShowResolveForm] = useState(false);

  const isActionable =
    entry.status !== "resolved" && entry.status !== "ignored";
  const isNew = entry.status === "new";

  return (
    <div
      className={`rounded-lg border transition-colors ${
        entry.severity.toLowerCase() === "critical"
          ? "border-red-500/40 bg-red-950/15"
          : entry.severity.toLowerCase() === "error"
            ? "border-red-500/30 bg-red-950/10"
            : entry.severity.toLowerCase() === "warning"
              ? "border-amber-500/20 bg-amber-950/5"
              : "border-border-subtle/50 bg-surface-canvas/50"
      }`}
    >
      {/* Main row */}
      <div
        className="p-4 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {getSeverityIcon(entry.severity)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Badge
                  variant={getSeverityBadgeVariant(entry.severity)}
                  className="text-[10px] px-1.5 py-0"
                >
                  {entry.severity.toUpperCase()}
                </Badge>
                {entry.error_type && (
                  <span className="text-xs text-text-muted font-mono">
                    {entry.error_type}
                  </span>
                )}
                <Badge
                  className={`text-[10px] px-1.5 py-0 border ${getStatusColor(entry.status)}`}
                >
                  {formatStatusLabel(entry.status)}
                </Badge>
                {entry.occurrence_count > 1 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    x{entry.occurrence_count}
                  </Badge>
                )}
              </div>
              <p className="text-sm text-text-primary break-words line-clamp-2">
                {entry.message}
              </p>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-xs text-text-muted font-mono">
                  {entry.log_source_name}
                </span>
                {entry.location && entry.location.file && (
                  <span className="text-xs text-text-muted font-mono">
                    {entry.location.file}
                    {entry.location.line ? `:${entry.location.line}` : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimestamp(entry.captured_at)}
            </div>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-text-muted" />
            ) : (
              <ChevronDown className="w-4 h-4 text-text-muted" />
            )}
          </div>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border-subtle/30 px-4 py-3 space-y-3 bg-surface-canvas/10">
          {/* Full message */}
          <div>
            <p className="text-xs font-medium text-text-muted mb-1">Message</p>
            <pre className="text-sm text-text-primary whitespace-pre-wrap font-mono bg-surface-canvas/30 rounded p-2">
              {entry.message}
            </pre>
          </div>

          {/* Stack trace */}
          {entry.stack_trace && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">
                Stack Trace
              </p>
              <pre className="text-xs text-text-muted font-mono bg-surface-canvas/30 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
                {entry.stack_trace}
              </pre>
            </div>
          )}

          {/* Context lines */}
          {entry.context_lines && (
            <div>
              <p className="text-xs font-medium text-text-muted mb-1">
                Context
              </p>
              <pre className="text-xs text-text-muted font-mono bg-surface-canvas/30 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
                {entry.context_lines}
              </pre>
            </div>
          )}

          {/* Resolution notes */}
          {entry.resolution_notes && (
            <div className="bg-green-950/20 border border-green-500/30 rounded-lg p-3">
              <p className="text-xs font-medium text-green-400 mb-1">
                Resolution Notes
              </p>
              <p className="text-sm text-green-300">{entry.resolution_notes}</p>
            </div>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-4 text-xs text-text-muted">
            <span>First seen: {formatTimestamp(entry.first_seen_at)}</span>
            <span>Last seen: {formatTimestamp(entry.last_seen_at)}</span>
            <span>Occurrences: {entry.occurrence_count}</span>
            {entry.error_code && <span>Code: {entry.error_code}</span>}
            {entry.signature_hash && (
              <span className="font-mono">
                Hash: {entry.signature_hash.slice(0, 12)}...
              </span>
            )}
          </div>

          {/* Action buttons */}
          {isActionable && (
            <div className="flex items-center gap-2 pt-1">
              {isNew && (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAcknowledge(entry.id);
                  }}
                  disabled={acknowledging}
                >
                  {acknowledging ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                  ) : (
                    <Eye className="w-3.5 h-3.5 mr-1" />
                  )}
                  Acknowledge
                </Button>
              )}
              {!showResolveForm ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowResolveForm(true);
                  }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  Mark Resolved
                </Button>
              ) : (
                <div
                  className="flex-1 flex items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Textarea
                    placeholder="Resolution notes (optional)..."
                    value={resolveNotes}
                    onChange={(e) => setResolveNotes(e.target.value)}
                    rows={1}
                    className="bg-surface-raised/50 border-border-subtle/50 text-white text-sm flex-1 resize-none"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                    disabled={resolving}
                    onClick={() => {
                      onResolve(entry.id, resolveNotes || undefined);
                      setShowResolveForm(false);
                      setResolveNotes("");
                    }}
                  >
                    {resolving ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-text-muted"
                    onClick={() => setShowResolveForm(false)}
                  >
                    <X className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function ErrorMonitorPage() {
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
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-text-muted" />
      </div>
    );
  }

  if (isOffline) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
        <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center px-6 py-4">
            <ShieldAlert className="w-6 h-6 text-red-400 mr-3" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
              Error Monitor
            </h1>
          </div>
        </header>
        <main className="p-6 max-w-5xl mx-auto">
          <RunnerOfflineState message="Start the Qontinui Runner desktop app to view error monitoring." />
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      {/* Header */}
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <ShieldAlert className="w-6 h-6 text-red-400" />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-red-400 to-orange-400 bg-clip-text text-transparent">
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
                      : "bg-surface-raised/50 text-text-muted"
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
              className="text-text-muted hover:text-white"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-6 max-w-5xl mx-auto space-y-6">
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
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-4">
              <p className="text-xs text-text-muted uppercase tracking-wider">
                Total
              </p>
              <p className="text-2xl font-bold text-text-primary mt-1">
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
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center gap-4">
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
                className={
                  showFilters ? "" : "text-text-muted hover:text-white"
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
              <div className="flex flex-wrap gap-4 pt-2 border-t border-border-subtle/30">
                <div>
                  <p className="text-xs text-text-muted mb-1.5">Severity</p>
                  <div className="flex items-center gap-1">
                    {SEVERITY_FILTERS.map((f) => (
                      <Button
                        key={f.value}
                        variant={
                          severityFilter === f.value ? "default" : "ghost"
                        }
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

        {/* Error Entries */}
        <Card className="bg-surface-raised/50 border-border-subtle/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg text-white flex items-center gap-2">
                  <FileText className="w-5 h-5" />
                  Log Entries
                </CardTitle>
                <CardDescription className="text-text-muted">
                  {filteredEntries.length} entr
                  {filteredEntries.length === 1 ? "y" : "ies"}
                  {activeFilterCount > 0 && " (filtered)"}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 text-xs text-text-muted">
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
                    className="h-16 bg-surface-raised/30 rounded-lg animate-pulse"
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
                <ShieldAlert className="w-12 h-12 mx-auto mb-3 text-text-muted" />
                <p className="text-sm text-text-muted">
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
