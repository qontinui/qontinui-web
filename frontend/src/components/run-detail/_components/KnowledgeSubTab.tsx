"use client";

import { useState } from "react";
import { useExpandableSet } from "@/hooks/useExpandableSet";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Brain,
  Filter,
} from "lucide-react";
import { useTaskRunKnowledge, type Finding } from "@/lib/runner-api";
import {
  SEVERITY_ORDER,
  SEVERITY_COLORS,
  CATEGORY_ICONS,
  type FindingSeverity,
} from "../_utils/summary-tab-utils";

// =============================================================================
// KnowledgeSubTab
// =============================================================================

export function KnowledgeSubTab({ runId }: { runId: string }) {
  const { data, isLoading, error } = useTaskRunKnowledge(runId);
  const { expanded: expandedFindings, toggle: toggleFinding } =
    useExpandableSet<number>();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  if (isLoading) {
    return (
      <div className="text-center py-12 text-text-muted">
        <RefreshCw className="size-5 animate-spin mx-auto mb-2" />
        Loading knowledge...
      </div>
    );
  }

  if (error) {
    return <div className="text-center py-12 text-red-400">Error: {error}</div>;
  }

  if (
    !data ||
    (data.findings.length === 0 &&
      data.observations.length === 0 &&
      data.hypotheses.length === 0)
  ) {
    return (
      <div className="text-center py-12 text-text-muted">
        <Brain className="size-12 mx-auto mb-4" />
        <p>No knowledge captured for this run.</p>
      </div>
    );
  }

  // Group findings by severity
  const findingsBySeverity = data.findings.reduce(
    (acc, finding) => {
      const severity = (
        finding.severity || "info"
      ).toLowerCase() as FindingSeverity;
      if (!acc[severity]) acc[severity] = [];
      acc[severity]!.push(finding);
      return acc;
    },
    {} as Partial<Record<FindingSeverity, Finding[]>>
  );

  // Get unique categories for filter
  const categories = ["all", ...new Set(data.findings.map((f) => f.category))];

  // Filter findings by category if set
  const getFilteredFindings = (findings: Finding[]) => {
    if (categoryFilter === "all") return findings;
    return findings.filter((f) => f.category === categoryFilter);
  };

  return (
    <div className="space-y-4">
      {/* Findings Panel (grouped by severity like runner) */}
      {data.findings.length > 0 && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="size-5 text-amber-500" />
                Findings ({data.findings.length})
              </CardTitle>
              {/* Category filter */}
              {categories.length > 2 && (
                <div className="flex items-center gap-1">
                  <Filter className="size-4 text-text-muted" />
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="text-xs bg-surface-canvas/50 border border-border-subtle/50 rounded px-2 py-1 text-text-secondary"
                  >
                    {categories.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat === "all" ? "All Categories" : cat}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {SEVERITY_ORDER.map((severity) => {
              const severityFindings = getFilteredFindings(
                findingsBySeverity[severity] || []
              );
              if (severityFindings.length === 0) return null;

              const colors = SEVERITY_COLORS[severity];

              return (
                <div
                  key={severity}
                  className={`rounded-lg border ${colors.border} ${colors.bg}`}
                >
                  {/* Severity header */}
                  <div
                    className={`px-3 py-2 font-medium ${colors.text} capitalize`}
                  >
                    {severity} ({severityFindings.length})
                  </div>
                  {/* Finding items */}
                  <div className="divide-y divide-border-subtle/30">
                    {severityFindings.map((finding: Finding) => {
                      const globalIndex = data.findings.indexOf(finding);
                      const Icon =
                        CATEGORY_ICONS[finding.category] || AlertTriangle;
                      const isExpanded = expandedFindings.has(globalIndex);

                      return (
                        <div
                          key={finding.id ?? globalIndex}
                          className="px-3 py-2"
                        >
                          <button
                            onClick={() => toggleFinding(globalIndex)}
                            className="w-full flex items-center gap-2 text-left"
                          >
                            <Icon
                              className={`size-4 ${colors.text} flex-shrink-0`}
                            />
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${colors.bg} ${colors.text} flex-shrink-0`}
                            >
                              {finding.category}
                            </span>
                            <span className="flex-1 text-sm font-medium text-text-primary truncate">
                              {finding.title}
                            </span>
                            <Badge
                              variant="outline"
                              className="text-xs shrink-0"
                            >
                              {finding.status}
                            </Badge>
                            {isExpanded ? (
                              <ChevronDown className="size-4 text-text-muted flex-shrink-0" />
                            ) : (
                              <ChevronRight className="size-4 text-text-muted flex-shrink-0" />
                            )}
                          </button>
                          {isExpanded && (
                            <div className="mt-2 ml-6 text-sm text-text-secondary space-y-1">
                              <p>{finding.description}</p>
                              {finding.file_path && (
                                <p className="text-xs text-text-muted font-mono">
                                  File: {finding.file_path}
                                  {finding.line_number != null &&
                                    `:${finding.line_number}`}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Observations */}
      {data.observations.length > 0 && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-base">
              Observations ({data.observations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.observations.map((obs: string, i: number) => (
                <li
                  key={i}
                  className="text-sm text-text-secondary pl-4 border-l-2 border-border-subtle"
                >
                  {obs}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Hypotheses */}
      {data.hypotheses.length > 0 && (
        <Card className="bg-surface-raised/30 border-border-subtle/50">
          <CardHeader>
            <CardTitle className="text-base">
              Hypotheses ({data.hypotheses.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.hypotheses.map((hyp: string, i: number) => (
                <li
                  key={i}
                  className="text-sm text-text-secondary pl-4 border-l-2 border-brand-primary/30"
                >
                  {hyp}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
