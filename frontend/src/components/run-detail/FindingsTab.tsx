"use client";

import { useState, useMemo } from "react";
import { useTaskRunKnowledge } from "@/lib/runner-api";
import type { Finding } from "@/lib/runner-api";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RefreshCw, ShieldCheck, FileCode2, Tag } from "lucide-react";

interface FindingsTabProps {
  runId: string;
}

function formatDateTime(dateString: string): string {
  try {
    return new Date(dateString).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return dateString;
  }
}

const SEVERITY_CONFIG: Record<
  string,
  { color: string; dotColor: string; badgeClass: string }
> = {
  critical: {
    color: "text-red-400",
    dotColor: "bg-red-500",
    badgeClass: "bg-red-500/10 text-red-400 border-red-500/30",
  },
  high: {
    color: "text-orange-400",
    dotColor: "bg-orange-500",
    badgeClass: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  },
  medium: {
    color: "text-yellow-400",
    dotColor: "bg-yellow-500",
    badgeClass: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  },
  low: {
    color: "text-gray-400",
    dotColor: "bg-gray-500",
    badgeClass: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  },
};

const STATUS_CONFIG: Record<string, { badgeClass: string }> = {
  actionable: {
    badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  },
  "needs-input": {
    badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/30",
  },
  resolved: {
    badgeClass: "bg-green-500/10 text-green-400 border-green-500/30",
  },
};

function getSeverityConfig(severity: string) {
  return (
    SEVERITY_CONFIG[severity.toLowerCase()] ?? {
      color: "text-text-muted",
      dotColor: "bg-gray-500",
      badgeClass:
        "bg-surface-raised/30 text-text-muted border-border-subtle/50",
    }
  );
}

function getStatusConfig(status: string) {
  return (
    STATUS_CONFIG[status.toLowerCase()] ?? {
      badgeClass:
        "bg-surface-raised/30 text-text-muted border-border-subtle/50",
    }
  );
}

export function FindingsTab({ runId }: FindingsTabProps) {
  const { data, isLoading, error } = useTaskRunKnowledge(runId);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const findings = useMemo(() => {
    if (!data) return [];
    return data.findings ?? [];
  }, [data]);

  const categories = useMemo(() => {
    const cats = new Set<string>();
    for (const f of findings) {
      if (f.category) cats.add(f.category);
    }
    return Array.from(cats).sort();
  }, [findings]);

  const filteredFindings = useMemo(() => {
    let result = findings;
    if (severityFilter !== "all") {
      result = result.filter(
        (f) => f.severity.toLowerCase() === severityFilter
      );
    }
    if (categoryFilter !== "all") {
      result = result.filter((f) => f.category === categoryFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter((f) => f.status.toLowerCase() === statusFilter);
    }
    return result;
  }, [findings, severityFilter, categoryFilter, statusFilter]);

  const groupedFindings = useMemo(() => {
    const groups: Record<string, Finding[]> = {};
    for (const f of filteredFindings) {
      const cat = f.category || "Uncategorized";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(f);
    }
    return groups;
  }, [filteredFindings]);

  const severityCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of findings) {
      const sev = f.severity.toLowerCase() as keyof typeof counts;
      if (sev in counts) counts[sev]++;
    }
    return counts;
  }, [findings]);

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading findings...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (findings.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted">
        <ShieldCheck className="size-12 mx-auto mb-4" />
        <p>No findings for this run.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="flex items-center gap-4 p-3 rounded-lg bg-surface-raised/30 border border-border-subtle/50">
        <span className="text-sm text-text-muted font-medium">
          {findings.length} finding{findings.length !== 1 ? "s" : ""}
        </span>
        <div className="flex items-center gap-3">
          {severityCounts.critical > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-red-500" />
              <span className="text-xs text-red-400">
                {severityCounts.critical} critical
              </span>
            </div>
          )}
          {severityCounts.high > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-orange-500" />
              <span className="text-xs text-orange-400">
                {severityCounts.high} high
              </span>
            </div>
          )}
          {severityCounts.medium > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-yellow-500" />
              <span className="text-xs text-yellow-400">
                {severityCounts.medium} medium
              </span>
            </div>
          )}
          {severityCounts.low > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-full bg-gray-500" />
              <span className="text-xs text-gray-400">
                {severityCounts.low} low
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={severityFilter} onValueChange={setSeverityFilter}>
          <SelectTrigger className="w-[150px] bg-surface-raised/50 border-border-default">
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
          <SelectTrigger className="w-[180px] bg-surface-raised/50 border-border-default">
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

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] bg-surface-raised/50 border-border-default">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="actionable">Actionable</SelectItem>
            <SelectItem value="needs-input">Needs Input</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>

        <Badge variant="secondary">
          {filteredFindings.length} result
          {filteredFindings.length !== 1 ? "s" : ""}
        </Badge>
      </div>

      {/* Findings Grouped by Category */}
      {filteredFindings.length === 0 ? (
        <div className="text-center py-8 text-text-muted">
          <p className="text-sm">No findings match the current filters.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedFindings).map(([category, catFindings]) => (
            <div key={category} className="space-y-2">
              <div className="flex items-center gap-2">
                <Tag className="size-3.5 text-text-muted" />
                <h3 className="text-sm font-semibold text-text-primary">
                  {category}
                </h3>
                <Badge variant="secondary" className="text-xs">
                  {catFindings.length}
                </Badge>
              </div>

              <div className="space-y-2 ml-5">
                {catFindings.map((finding) => {
                  const sevConfig = getSeverityConfig(finding.severity);
                  const statusConfig = getStatusConfig(finding.status);

                  return (
                    <div
                      key={finding.id}
                      className="p-4 rounded-lg bg-surface-raised/30 border border-border-subtle/50 space-y-2"
                    >
                      {/* Header: severity badge + title + status badge + category badge */}
                      <div className="flex items-start gap-2 flex-wrap">
                        <Badge
                          variant="outline"
                          className={`text-xs ${sevConfig.badgeClass}`}
                        >
                          {finding.severity}
                        </Badge>
                        <span className="text-sm font-medium text-text-primary flex-1">
                          {finding.title}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-xs ${statusConfig.badgeClass}`}
                        >
                          {finding.status}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-xs bg-surface-raised/30 text-text-muted border-border-subtle/50"
                        >
                          {finding.category}
                        </Badge>
                      </div>

                      {/* Description */}
                      {finding.description && (
                        <p className="text-sm text-text-secondary leading-relaxed">
                          {finding.description}
                        </p>
                      )}

                      {/* File path and line number */}
                      {finding.file_path && (
                        <div className="flex items-center gap-2">
                          <FileCode2 className="size-3.5 text-text-muted shrink-0" />
                          <code className="text-xs font-mono text-text-muted bg-surface-canvas/50 px-2 py-0.5 rounded">
                            {finding.file_path}
                            {finding.line_number != null
                              ? `:${finding.line_number}`
                              : ""}
                          </code>
                        </div>
                      )}

                      {/* Timestamp */}
                      <div className="text-xs text-text-muted">
                        {formatDateTime(finding.created_at)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
