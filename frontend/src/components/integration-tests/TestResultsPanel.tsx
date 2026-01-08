"use client";

import React from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  Shuffle,
  ExternalLink,
  Loader2,
  Play,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TestResultsPanelProps } from "@/types/integration-tests";

export const TestResultsPanel: React.FC<TestResultsPanelProps> = ({
  results,
  loading = false,
  onViewDetails,
  onPlayback,
}) => {
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  };

  const getTotalStats = () => {
    if (results.length === 0) {
      return { passed: 0, failed: 0, totalSteps: 0, successfulSteps: 0 };
    }

    return results.reduce(
      (acc, result) => ({
        passed: acc.passed + (result.passed ? 1 : 0),
        failed: acc.failed + (result.passed ? 0 : 1),
        totalSteps: acc.totalSteps + result.totalSteps,
        successfulSteps: acc.successfulSteps + result.successfulSteps,
      }),
      { passed: 0, failed: 0, totalSteps: 0, successfulSteps: 0 }
    );
  };

  const stats = getTotalStats();
  const successRate =
    stats.totalSteps > 0
      ? Math.floor((stats.successfulSteps / stats.totalSteps) * 100)
      : 0;

  return (
    <Card className="bg-white border border-border-subtle">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Results
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          </div>
        ) : results.length === 0 ? (
          <div className="text-center py-8 text-text-muted">
            <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No results yet</p>
            <p className="text-xs mt-1">Run tests to see results</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <div>
                    <p className="text-xs text-green-700 font-medium">Passed</p>
                    <p className="text-lg font-bold text-green-900">
                      {stats.passed}
                    </p>
                  </div>
                </div>
              </div>
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-600" />
                  <div>
                    <p className="text-xs text-red-700 font-medium">Failed</p>
                    <p className="text-lg font-bold text-red-900">
                      {stats.failed}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Overall Success Rate */}
            <div className="p-3 bg-surface-canvas rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-text-secondary font-medium">
                  Overall Success Rate
                </span>
                <span className="text-sm font-bold text-text-primary">
                  {successRate}%
                </span>
              </div>
              <div className="w-full bg-border-subtle rounded-full h-2 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    successRate >= 80
                      ? "bg-green-500"
                      : successRate >= 50
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  }`}
                  style={{ width: `${successRate}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-text-muted">
                  {stats.successfulSteps}/{stats.totalSteps} steps
                </span>
              </div>
            </div>

            {/* Individual Workflow Results */}
            <div className="space-y-2">
              <p className="text-xs text-text-muted font-medium">
                Workflow Results
              </p>
              <div className="max-h-96 overflow-y-auto space-y-2">
                {results.map((result) => (
                  <div
                    key={result.workflowId}
                    className={`p-3 rounded-lg border ${
                      result.passed
                        ? "bg-green-50 border-green-200"
                        : "bg-red-50 border-red-200"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {result.passed ? (
                        <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-sm font-semibold truncate ${
                              result.passed ? "text-green-900" : "text-red-900"
                            }`}
                          >
                            {result.workflowName}
                          </p>
                          <span
                            className={`text-xs font-bold ${
                              result.passed ? "text-green-700" : "text-red-700"
                            }`}
                          >
                            {result.passed ? "PASSED" : "FAILED"}
                          </span>
                        </div>

                        <div className="mt-2 space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span
                              className={
                                result.passed
                                  ? "text-green-700"
                                  : "text-red-700"
                              }
                            >
                              {result.successfulSteps}/{result.totalSteps} steps
                              successful
                            </span>
                            <span
                              className={
                                result.passed
                                  ? "text-green-600"
                                  : "text-red-600"
                              }
                            >
                              {formatDuration(result.duration)}
                            </span>
                          </div>

                          {result.randomMatchesUsed &&
                            result.randomMatchesUsed.length > 0 && (
                              <div className="flex items-center gap-1 text-xs text-purple-700 bg-purple-50 px-2 py-1 rounded">
                                <Shuffle className="w-3 h-3" />
                                <span>
                                  {result.randomMatchesUsed.length} random
                                  matches used
                                </span>
                              </div>
                            )}

                          {!result.passed && (result.failedSteps ?? 0) > 0 && (
                            <p
                              className={`text-xs ${result.passed ? "text-green-700" : "text-red-700"}`}
                            >
                              {result.failedSteps ?? 0} step
                              {(result.failedSteps ?? 0) > 1 ? "s" : ""} failed
                            </p>
                          )}
                        </div>

                        <div className="flex items-center gap-2 mt-2">
                          {onPlayback &&
                            result.historicalResultIds &&
                            result.historicalResultIds.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  onPlayback(
                                    result.workflowId,
                                    result.historicalResultIds!
                                  )
                                }
                                className={`h-7 text-xs ${
                                  result.passed
                                    ? "text-green-700 hover:bg-green-100"
                                    : "text-red-700 hover:bg-red-100"
                                }`}
                              >
                                <Play className="w-3 h-3 mr-1" />
                                Playback
                              </Button>
                            )}
                          {onViewDetails && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => onViewDetails(result.workflowId)}
                              className={`h-7 text-xs ${
                                result.passed
                                  ? "text-green-700 hover:bg-green-100"
                                  : "text-red-700 hover:bg-red-100"
                              }`}
                            >
                              <ExternalLink className="w-3 h-3 mr-1" />
                              View Details
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Note about random matches */}
            <div className="pt-3 border-t">
              <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <Shuffle className="w-4 h-4 text-purple-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-purple-900 leading-relaxed">
                    <span className="font-semibold">Note:</span> Each run uses
                    random historical matches, making tests vary like live
                    automation. This simulates real-world conditions where
                    pattern matching may find different results.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TestResultsPanel;
