// components/integration-testing/StateCoveragePanel.tsx

"use client";

import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Download,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { CoverageMatrix } from "./CoverageMatrix";
import { StateTransitionGraph } from "./StateTransitionGraph";
import type {
  CoverageReport,
  CoverageAnalysisRequest,
} from "@/types/integration-testing";

interface StateCoveragePanelProps {
  workflowId?: string;
  workflowName?: string;
  snapshotRunIds: string[];
  expectedStates?: string[];
  autoRefresh?: boolean;
}

export function StateCoveragePanel({
  workflowId,
  workflowName,
  snapshotRunIds,
  expectedStates,
  autoRefresh = false,
}: StateCoveragePanelProps) {
  const [coverage, setCoverage] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyzeCoverage = async () => {
    if (!workflowId || !workflowName || snapshotRunIds.length === 0) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const request: CoverageAnalysisRequest = {
        workflow_id: workflowId ?? "",
        workflow_name: workflowName ?? "",
        snapshot_run_ids: snapshotRunIds,
        expected_states: expectedStates,
      };

      const response = await fetch(
        "/api/integration-testing/coverage/analyze",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request),
        }
      );

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: "Unknown error" }));
        throw new Error(errorData.detail || "Failed to analyze coverage");
      }

      const data: CoverageReport = await response.json();
      setCoverage(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to analyze coverage"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoRefresh && workflowId && snapshotRunIds.length > 0) {
      analyzeCoverage();
    }
  }, [workflowId, snapshotRunIds, autoRefresh]);

  const exportReport = () => {
    if (!coverage) return;

    const dataStr = JSON.stringify(coverage, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `coverage-report-${coverage.workflow_id}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const getCoverageColor = (percentage: number): string => {
    if (percentage === 0) return "text-red-600";
    if (percentage < 50) return "text-yellow-600";
    if (percentage < 80) return "text-blue-600";
    return "text-green-600";
  };

  if (!workflowId || snapshotRunIds.length === 0) {
    return (
      <Card className="p-8">
        <div className="text-center text-text-muted">
          <AlertCircle className="w-12 h-12 mx-auto mb-4 text-text-muted" />
          <p className="text-lg font-medium">
            No process or snapshots selected
          </p>
          <p className="text-sm mt-1">
            Select a process and snapshots to view coverage analysis
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">State Coverage Analysis</h2>
          <p className="text-sm text-text-muted mt-1">
            Analyzing {snapshotRunIds.length} snapshot run(s) for {workflowName}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={analyzeCoverage}
            disabled={loading}
            variant="outline"
            size="sm"
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`}
            />
            {loading ? "Analyzing..." : "Analyze"}
          </Button>
          {coverage && (
            <Button onClick={exportReport} variant="outline" size="sm">
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
          )}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 text-red-800">
            <AlertCircle className="w-5 h-5" />
            <p className="font-medium">Error analyzing coverage</p>
          </div>
          <p className="text-red-700 text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && !coverage && (
        <Card className="p-12">
          <div className="text-center">
            <RefreshCw className="w-12 h-12 mx-auto mb-4 text-blue-600 animate-spin" />
            <p className="text-lg font-medium text-text-primary">
              Analyzing coverage...
            </p>
            <p className="text-sm text-text-muted mt-1">
              Processing {snapshotRunIds.length} snapshot run(s)
            </p>
          </div>
        </Card>
      )}

      {/* Coverage Report */}
      {coverage && (
        <>
          {/* Overall Coverage Circle */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-6 col-span-1">
              <div className="text-center">
                <div className="relative inline-flex items-center justify-center">
                  <svg className="w-32 h-32 transform -rotate-90">
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="#e5e7eb"
                      strokeWidth="12"
                      fill="none"
                    />
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke={
                        coverage.overall_coverage_percentage >= 80
                          ? "#10b981"
                          : coverage.overall_coverage_percentage >= 50
                            ? "#3b82f6"
                            : coverage.overall_coverage_percentage > 0
                              ? "#f59e0b"
                              : "#ef4444"
                      }
                      strokeWidth="12"
                      fill="none"
                      strokeDasharray={`${(coverage.overall_coverage_percentage / 100) * 351.86} 351.86`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div
                        className={`text-3xl font-bold ${getCoverageColor(coverage.overall_coverage_percentage)}`}
                      >
                        {coverage.overall_coverage_percentage.toFixed(0)}%
                      </div>
                      <div className="text-xs text-text-muted">Coverage</div>
                    </div>
                  </div>
                </div>
              </div>
            </Card>

            {/* Stats Cards */}
            <Card className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-2xl font-bold text-text-primary">
                    {coverage.covered_states}/{coverage.total_states}
                  </div>
                  <div className="text-sm text-text-muted">States Covered</div>
                </div>
                <CheckCircle2 className="w-8 h-8 text-green-500" />
              </div>
              {coverage.uncovered_states > 0 && (
                <div className="mt-2 text-xs text-red-600">
                  {coverage.uncovered_states} uncovered
                </div>
              )}
            </Card>

            <Card className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-2xl font-bold text-text-primary">
                    {coverage.covered_transitions}/{coverage.total_transitions}
                  </div>
                  <div className="text-sm text-text-muted">
                    Transitions Covered
                  </div>
                </div>
                <CheckCircle2 className="w-8 h-8 text-blue-500" />
              </div>
              {coverage.missing_transitions > 0 && (
                <div className="mt-2 text-xs text-yellow-600">
                  {coverage.missing_transitions} missing
                </div>
              )}
            </Card>

            <Card className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-2xl font-bold text-text-primary">
                    {coverage.coverage_gaps.length}
                  </div>
                  <div className="text-sm text-text-muted">Coverage Gaps</div>
                </div>
                <AlertTriangle className="w-8 h-8 text-yellow-500" />
              </div>
              {coverage.coverage_gaps.length > 0 && (
                <div className="mt-2 text-xs text-yellow-600">
                  {
                    coverage.coverage_gaps.filter((g) => g.severity === "high")
                      .length
                  }{" "}
                  high priority
                </div>
              )}
            </Card>
          </div>

          {/* Tabs for different views */}
          <Tabs defaultValue="matrix" className="space-y-4">
            <TabsList>
              <TabsTrigger value="matrix">Coverage Matrix</TabsTrigger>
              <TabsTrigger value="graph">State Transitions</TabsTrigger>
              <TabsTrigger value="gaps">Coverage Gaps</TabsTrigger>
            </TabsList>

            {/* Coverage Matrix Tab */}
            <TabsContent value="matrix">
              <Card className="p-6">
                <CoverageMatrix stateMetrics={coverage.state_metrics} />
              </Card>
            </TabsContent>

            {/* State Transition Graph Tab */}
            <TabsContent value="graph">
              <Card className="p-6">
                <StateTransitionGraph
                  stateMetrics={coverage.state_metrics}
                  transitions={coverage.transitions}
                />
              </Card>
            </TabsContent>

            {/* Coverage Gaps Tab */}
            <TabsContent value="gaps">
              <div className="space-y-4">
                {/* Recommendations */}
                {coverage.recommendations.length > 0 && (
                  <Card className="p-6">
                    <h3 className="text-lg font-semibold mb-4">
                      Recommendations
                    </h3>
                    <ul className="space-y-2">
                      {coverage.recommendations.map((rec, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <CheckCircle2 className="w-5 h-5 text-blue-500 mt-0.5 flex-shrink-0" />
                          <span className="text-sm text-text-secondary">
                            {rec}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                {/* Coverage Gaps */}
                {coverage.coverage_gaps.length > 0 ? (
                  <div className="space-y-3">
                    {coverage.coverage_gaps.map((gap, index) => (
                      <Card
                        key={index}
                        className={`p-4 border-l-4 ${
                          gap.severity === "high"
                            ? "border-l-red-500 bg-red-50"
                            : gap.severity === "medium"
                              ? "border-l-yellow-500 bg-yellow-50"
                              : "border-l-blue-500 bg-blue-50"
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className={`text-xs font-semibold px-2 py-0.5 rounded uppercase ${
                                  gap.severity === "high"
                                    ? "bg-red-200 text-red-800"
                                    : gap.severity === "medium"
                                      ? "bg-yellow-200 text-yellow-800"
                                      : "bg-blue-200 text-blue-800"
                                }`}
                              >
                                {gap.severity}
                              </span>
                              <span className="text-xs text-text-muted font-mono">
                                {gap.gap_type}
                              </span>
                            </div>
                            <p className="text-sm font-medium text-text-primary mb-1">
                              {gap.description}
                            </p>
                            <p className="text-sm text-text-secondary italic">
                              {gap.recommendation}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {gap.affected_states.map((state) => (
                                <span
                                  key={state}
                                  className="px-2 py-0.5 bg-white rounded text-xs font-mono border border-border-default"
                                >
                                  {state}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Card className="p-8">
                    <div className="text-center text-text-muted">
                      <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-green-500" />
                      <p className="text-lg font-medium">
                        No coverage gaps found
                      </p>
                      <p className="text-sm mt-1">
                        Your coverage looks great! Consider adding edge case
                        scenarios.
                      </p>
                    </div>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
