"use client";

import { useState, useMemo } from "react";
import { useFindingsSummary, runnerApi } from "@/lib/runner-api";
import type { Finding } from "@/lib/runner-api";
import { RunnerOfflineState } from "@/components/runner/RunnerOfflineState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  RefreshCw,
  ShieldAlert,
  ArrowUpCircle,
  ArrowDownCircle,
  AlertCircle,
  Info,
  FileCode,
  Tag,
  Inbox,
  Wrench,
  Trash2,
  Loader2,
  ChevronDown,
  ChevronRight,
  Code,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

function getSeverityIcon(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return <ShieldAlert className="size-4 text-red-500" />;
    case "high":
      return <ArrowUpCircle className="size-4 text-orange-500" />;
    case "medium":
      return <AlertCircle className="size-4 text-yellow-500" />;
    case "low":
      return <ArrowDownCircle className="size-4 text-blue-400" />;
    default:
      return <Info className="size-4 text-text-muted" />;
  }
}

function getSeverityBadge(severity: string) {
  switch (severity.toLowerCase()) {
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "high":
      return (
        <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30">
          High
        </Badge>
      );
    case "medium":
      return <Badge variant="warning">Medium</Badge>;
    case "low":
      return <Badge variant="info">Low</Badge>;
    default:
      return <Badge variant="outline">{severity}</Badge>;
  }
}

export default function FindingsPage() {
  const { data, isLoading, error, isOffline, refetch } = useFindingsSummary();
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [autoFixEnabled, setAutoFixEnabled] = useState(false);
  const [isFixing, setIsFixing] = useState(false);
  const [expandedFinding, setExpandedFinding] = useState<number | null>(null);

  const categories = useMemo(() => {
    if (!data?.by_category) return [];
    return Object.keys(data.by_category).sort();
  }, [data]);

  const filteredFindings = useMemo(() => {
    if (!data?.recent) return [];
    return data.recent.filter((finding: Finding) => {
      const matchesSeverity =
        severityFilter === "all" ||
        finding.severity.toLowerCase() === severityFilter;
      const matchesCategory =
        categoryFilter === "all" || finding.category === categoryFilter;
      const matchesStatus =
        statusFilter === "all" || finding.status.toLowerCase() === statusFilter;
      return matchesSeverity && matchesCategory && matchesStatus;
    });
  }, [data, severityFilter, categoryFilter, statusFilter]);

  const handleFixAll = async () => {
    if (!data?.recent || data.recent.length === 0) return;
    setIsFixing(true);
    try {
      const autoFixFindings = data.recent.filter(
        (f) => f.status !== "resolved"
      );
      if (autoFixFindings.length === 0) {
        toast.info("No unresolved findings to fix");
        return;
      }
      let successCount = 0;
      for (const finding of autoFixFindings) {
        try {
          await runnerApi.updateFindingStatus(
            String(finding.id),
            "in_progress"
          );
          successCount++;
        } catch {
          // Continue with remaining findings
        }
      }
      toast.success(
        `Started fixing ${successCount} of ${autoFixFindings.length} findings`
      );
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to fix findings"
      );
    } finally {
      setIsFixing(false);
    }
  };

  const handleClearAll = async () => {
    if (!data?.recent || data.recent.length === 0) return;
    try {
      const taskRunId = data.recent[0]?.task_run_id;
      if (!taskRunId) {
        toast.error("No task run ID found in findings");
        return;
      }
      await runnerApi.clearAllFindings(taskRunId);
      toast.success("All findings cleared");
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to clear findings"
      );
    }
  };

  const handleResolveFinding = async (
    findingId: number,
    e: React.MouseEvent
  ) => {
    e.stopPropagation();
    try {
      await runnerApi.resolveFinding(String(findingId), "Resolved by user");
      toast.success("Finding resolved");
      await refetch();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to resolve finding"
      );
    }
  };

  if (isOffline) {
    return <RunnerOfflineState />;
  }

  return (
    <div className="h-full overflow-y-auto bg-gradient-to-br from-surface-canvas via-[#0F0F10] to-surface-canvas text-white">
      <header className="border-b border-border-subtle/50 bg-surface-canvas/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="size-6 text-yellow-500" />
            <h1 className="text-2xl font-bold text-text-primary">Findings</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant={autoFixEnabled ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setAutoFixEnabled(!autoFixEnabled);
                toast.info(
                  autoFixEnabled ? "Auto-fix disabled" : "Auto-fix enabled"
                );
              }}
              className={
                autoFixEnabled
                  ? "bg-green-600 hover:bg-green-700"
                  : "border-border-default"
              }
            >
              <Wrench className="size-4 mr-1" />
              Auto-Fix {autoFixEnabled ? "On" : "Off"}
            </Button>
            {data && data.total > 0 && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFixAll}
                  disabled={isFixing}
                >
                  {isFixing ? (
                    <Loader2 className="size-4 animate-spin mr-1" />
                  ) : (
                    <Wrench className="size-4 mr-1" />
                  )}
                  Fix All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearAll}
                  className="text-red-400 border-red-500/30"
                >
                  <Trash2 className="size-4 mr-1" />
                  Clear All
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-border-default"
            >
              <RefreshCw className="size-4 mr-2" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="p-6 max-w-7xl mx-auto space-y-6">
        <p className="text-text-muted">
          Aggregated findings across all task runs, organized by severity and
          category.
        </p>

        {isLoading ? (
          <div className="text-center py-16 text-text-muted">
            <RefreshCw className="size-6 animate-spin mx-auto mb-3" />
            Loading findings...
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-400">
            Error loading findings: {error}
          </div>
        ) : !data || data.total === 0 ? (
          <Card className="bg-surface-raised/50 border-border-subtle/50">
            <CardContent className="py-16">
              <div className="text-center text-text-muted">
                <Inbox className="size-16 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-text-secondary mb-2">
                  No Findings Yet
                </h3>
                <p className="text-sm">
                  Findings are generated when the AI analyzes issues during task
                  runs.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Card className="bg-surface-raised/50 border-border-subtle/50">
                <CardContent className="pt-6 text-center">
                  <div
                    className="text-3xl font-bold text-text-primary"
                    data-content-role="metric"
                    data-content-label="total-findings"
                  >
                    {data.total}
                  </div>
                  <div
                    className="text-xs text-text-muted mt-1"
                    data-content-role="label"
                  >
                    Total
                  </div>
                </CardContent>
              </Card>
              {["critical", "high", "medium", "low"].map((severity) => {
                const count = data.by_severity[severity] || 0;
                const colorMap: Record<string, string> = {
                  critical: "text-red-500",
                  high: "text-orange-500",
                  medium: "text-yellow-500",
                  low: "text-blue-400",
                };
                return (
                  <Card
                    key={severity}
                    className="bg-surface-raised/50 border-border-subtle/50"
                  >
                    <CardContent className="pt-6 text-center">
                      <div
                        className={`text-3xl font-bold ${colorMap[severity]}`}
                        data-content-role="metric"
                        data-content-label={`${severity}-findings-count`}
                      >
                        {count}
                      </div>
                      <div
                        className="text-xs text-text-muted mt-1 capitalize"
                        data-content-role="label"
                      >
                        {severity}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Category Breakdown */}
            {Object.keys(data.by_category).length > 0 && (
              <Card className="bg-surface-raised/50 border-border-subtle/50">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Tag className="size-4" />
                    Categories
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(data.by_category).map(
                      ([category, count]) => (
                        <Badge
                          key={category}
                          variant="outline"
                          className="cursor-pointer hover:bg-surface-raised/80"
                          onClick={() =>
                            setCategoryFilter(
                              categoryFilter === category ? "all" : category
                            )
                          }
                        >
                          {category}: {count as number}
                        </Badge>
                      )
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Filters */}
            <div className="flex gap-4 flex-wrap">
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="w-[160px] bg-surface-raised/50 border-border-default">
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
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[200px] bg-surface-raised/50 border-border-default">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-1">
                {[
                  "all",
                  "identified",
                  "actionable",
                  "needs_input",
                  "resolved",
                ].map((status) => (
                  <Button
                    key={status}
                    variant={statusFilter === status ? "default" : "outline"}
                    size="sm"
                    onClick={() => setStatusFilter(status)}
                    className={`text-xs ${statusFilter === status ? "bg-brand-primary text-black" : "border-border-default text-text-muted"}`}
                  >
                    {status === "all"
                      ? "All"
                      : status
                          .replace("_", " ")
                          .replace(/\b\w/g, (l) => l.toUpperCase())}
                  </Button>
                ))}
              </div>
            </div>

            {/* Findings List */}
            <div className="space-y-3">
              {filteredFindings.length === 0 ? (
                <div className="text-center py-8 text-text-muted">
                  No findings match the current filters.
                </div>
              ) : (
                filteredFindings.map((finding: Finding) => {
                  const isExpanded = expandedFinding === finding.id;
                  return (
                    <Card
                      key={finding.id}
                      className="bg-surface-raised/30 border-border-subtle/50 cursor-pointer transition-all hover:border-border-default"
                      onClick={() =>
                        setExpandedFinding(isExpanded ? null : finding.id)
                      }
                    >
                      <CardContent className="py-4 px-5">
                        <div className="flex items-start gap-3">
                          <div className="pt-0.5">
                            {getSeverityIcon(finding.severity)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              {isExpanded ? (
                                <ChevronDown className="size-3.5 text-text-muted" />
                              ) : (
                                <ChevronRight className="size-3.5 text-text-muted" />
                              )}
                              <span
                                className="font-medium text-text-primary text-sm"
                                data-content-role="label"
                                data-content-label="finding-title"
                              >
                                {finding.title}
                              </span>
                              {getSeverityBadge(finding.severity)}
                              <Badge variant="outline" className="text-xs">
                                {finding.category}
                              </Badge>
                              <Badge variant="secondary" className="text-xs">
                                {finding.status}
                              </Badge>
                            </div>
                            <p className="text-sm text-text-muted mt-1.5">
                              {finding.description}
                            </p>

                            {isExpanded && (
                              <div className="mt-3 space-y-3 border-t border-border-subtle/30 pt-3">
                                {finding.file_path && (
                                  <div className="bg-surface-canvas/50 rounded-lg p-3">
                                    <div className="flex items-center gap-1.5 text-xs text-text-muted font-mono mb-1">
                                      <Code className="size-3" />
                                      {finding.file_path}
                                      {finding.line_number
                                        ? `:${finding.line_number}`
                                        : ""}
                                    </div>
                                  </div>
                                )}
                                <div className="flex items-center justify-between">
                                  <div className="text-xs text-text-muted">
                                    Run #{finding.task_run_id} &middot;{" "}
                                    {new Date(
                                      finding.created_at
                                    ).toLocaleString()}
                                  </div>
                                  {finding.status !== "resolved" && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) =>
                                        handleResolveFinding(finding.id, e)
                                      }
                                      className="text-xs text-green-400 border-green-500/30 hover:bg-green-950/50"
                                    >
                                      <CheckCircle2 className="size-3 mr-1" />
                                      Resolve
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}

                            {!isExpanded && finding.file_path && (
                              <div className="flex items-center gap-1.5 mt-2 text-xs text-text-muted font-mono">
                                <FileCode className="size-3" />
                                {finding.file_path}
                                {finding.line_number
                                  ? `:${finding.line_number}`
                                  : ""}
                              </div>
                            )}
                            {!isExpanded && (
                              <div className="text-xs text-text-muted mt-1.5">
                                Run #{finding.task_run_id} &middot;{" "}
                                {new Date(finding.created_at).toLocaleString()}
                              </div>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
