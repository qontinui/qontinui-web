/**
 * TestResults - Component for viewing and analyzing test results
 *
 * Features:
 * - Test results list (sortable, filterable)
 * - Pass/fail status with icons
 * - Execution duration
 * - Error messages
 * - Timestamp
 * - View details dialog
 * - Results graph (pass rate over time)
 * - Export results
 * - Statistics dashboard
 * - Trend analysis
 */

"use client";

import * as React from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Download,
  Trash2,
  Play,
  ChevronDown,
  ChevronUp,
  Info,
  AlertCircle,
  Loader2,
  Calendar,
  BarChart3,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  TestCase,
  TestResult,
  TestStatistics,
  AssertionResult,
} from "@/services/workflow-testing-service";

// ============================================================================
// Types
// ============================================================================

export interface TestResultsProps {
  testCase: TestCase;
  results: TestResult[];
  onRunTest: () => void;
  onClearResults: () => void;
  className?: string;
}

type SortField = "timestamp" | "duration" | "status";
type SortOrder = "asc" | "desc";
type FilterStatus = "all" | "passed" | "failed";

// ============================================================================
// Component
// ============================================================================

export function TestResults({
  testCase,
  results,
  onRunTest,
  onClearResults,
  className,
}: TestResultsProps) {
  // ========================================================================
  // State
  // ========================================================================

  const [sortField, setSortField] = React.useState<SortField>("timestamp");
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("desc");
  const [filterStatus, setFilterStatus] = React.useState<FilterStatus>("all");
  const [selectedResult, setSelectedResult] = React.useState<TestResult | null>(
    null
  );
  const [isRunning, setIsRunning] = React.useState(false);

  // ========================================================================
  // Computed values
  // ========================================================================

  const statistics = React.useMemo((): TestStatistics | null => {
    if (results.length === 0) return null;

    const successfulRuns = results.filter((r) => r.passed).length;
    const failedRuns = results.length - successfulRuns;
    const durations = results.map((r) => r.duration);

    return {
      testCaseId: testCase.id,
      totalRuns: results.length,
      successfulRuns,
      failedRuns,
      passRate: (successfulRuns / results.length) * 100,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      lastRun: results[0]?.endTime,
      lastPassed: results[0]?.passed,
    };
  }, [results, testCase.id]);

  const trend = React.useMemo(() => {
    if (results.length < 2) return "stable";

    const recent = results.slice(0, 5);
    const older = results.slice(5, 10);

    if (recent.length === 0 || older.length === 0) return "stable";

    const recentPassRate =
      recent.filter((r) => r.passed).length / recent.length;
    const olderPassRate = older.filter((r) => r.passed).length / older.length;

    if (recentPassRate > olderPassRate + 0.2) return "improving";
    if (recentPassRate < olderPassRate - 0.2) return "declining";
    return "stable";
  }, [results]);

  const filteredAndSortedResults = React.useMemo(() => {
    let filtered = results;

    // Apply status filter
    if (filterStatus === "passed") {
      filtered = filtered.filter((r) => r.passed);
    } else if (filterStatus === "failed") {
      filtered = filtered.filter((r) => !r.passed);
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "timestamp":
          comparison =
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
          break;
        case "duration":
          comparison = a.duration - b.duration;
          break;
        case "status":
          comparison = (a.passed ? 1 : 0) - (b.passed ? 1 : 0);
          break;
      }

      return sortOrder === "asc" ? comparison : -comparison;
    });

    return sorted;
  }, [results, filterStatus, sortField, sortOrder]);

  const passRateHistory = React.useMemo(() => {
    // Calculate pass rate for last 10 runs in groups of 5
    const groups: { label: string; passRate: number }[] = [];
    const groupSize = 5;

    for (let i = 0; i < Math.min(results.length, 50); i += groupSize) {
      const group = results.slice(i, i + groupSize);
      if (group.length === 0) break;

      const passRate =
        (group.filter((r) => r.passed).length / group.length) * 100;
      groups.push({
        label: `${i + 1}-${i + group.length}`,
        passRate,
      });
    }

    return groups.reverse(); // Show oldest to newest
  }, [results]);

  // ========================================================================
  // Handlers
  // ========================================================================

  const handleRunTest = React.useCallback(() => {
    setIsRunning(true);
    onRunTest();
    // Simulate completion
    setTimeout(() => {
      setIsRunning(false);
    }, 2000);
  }, [onRunTest]);

  const handleClearResults = React.useCallback(() => {
    if (
      confirm(
        "Are you sure you want to clear all test results? This action cannot be undone."
      )
    ) {
      onClearResults();
    }
  }, [onClearResults]);

  const handleExportResults = React.useCallback(() => {
    const data = JSON.stringify(
      {
        testCase,
        results,
        statistics,
        exportedAt: new Date().toISOString(),
      },
      null,
      2
    );

    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `test-results-${testCase.name}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [testCase, results, statistics]);

  const toggleSort = React.useCallback((field: SortField) => {
    setSortField((current) => {
      if (current === field) {
        setSortOrder((order) => (order === "asc" ? "desc" : "asc"));
        return field;
      } else {
        setSortOrder("desc");
        return field;
      }
    });
  }, []);

  // ========================================================================
  // Render
  // ========================================================================

  return (
    <div className={cn("space-y-6", className)}>
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Test Results</CardTitle>
              <CardDescription>{testCase.name}</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleRunTest} disabled={isRunning}>
                {isRunning ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Running
                  </>
                ) : (
                  <>
                    <Play />
                    Run Test
                  </>
                )}
              </Button>
              {results.length > 0 && (
                <>
                  <Button onClick={handleExportResults} variant="outline">
                    <Download />
                    Export
                  </Button>
                  <Button onClick={handleClearResults} variant="ghost">
                    <Trash2 />
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Statistics */}
      {statistics && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Total Runs */}
          <Card>
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2">
                <FileText className="size-4" />
                Total Runs
              </CardDescription>
              <CardTitle className="text-3xl">{statistics.totalRuns}</CardTitle>
            </CardHeader>
          </Card>

          {/* Pass Rate */}
          <Card>
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2">
                <BarChart3 className="size-4" />
                Pass Rate
              </CardDescription>
              <CardTitle className="text-3xl flex items-center gap-2">
                {statistics.passRate.toFixed(0)}%
                {trend === "improving" && (
                  <TrendingUp className="size-5 text-green-500" />
                )}
                {trend === "declining" && (
                  <TrendingDown className="size-5 text-red-500" />
                )}
                {trend === "stable" && (
                  <Minus className="size-5 text-muted-foreground" />
                )}
              </CardTitle>
            </CardHeader>
            <CardFooter>
              <div className="text-xs text-muted-foreground">
                {statistics.successfulRuns} passed, {statistics.failedRuns}{" "}
                failed
              </div>
            </CardFooter>
          </Card>

          {/* Average Duration */}
          <Card>
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2">
                <Clock className="size-4" />
                Avg Duration
              </CardDescription>
              <CardTitle className="text-3xl">
                {(statistics.avgDuration / 1000).toFixed(2)}s
              </CardTitle>
            </CardHeader>
            <CardFooter>
              <div className="text-xs text-muted-foreground">
                Min: {(statistics.minDuration / 1000).toFixed(2)}s, Max:{" "}
                {(statistics.maxDuration / 1000).toFixed(2)}s
              </div>
            </CardFooter>
          </Card>

          {/* Last Run */}
          <Card>
            <CardHeader className="pb-3">
              <CardDescription className="flex items-center gap-2">
                <Calendar className="size-4" />
                Last Run
              </CardDescription>
              <CardTitle className="text-lg">
                {statistics.lastRun
                  ? new Date(statistics.lastRun).toLocaleString()
                  : "Never"}
              </CardTitle>
            </CardHeader>
            <CardFooter>
              {statistics.lastPassed !== undefined && (
                <Badge
                  variant={statistics.lastPassed ? "default" : "destructive"}
                  className="w-fit"
                >
                  {statistics.lastPassed ? "Passed" : "Failed"}
                </Badge>
              )}
            </CardFooter>
          </Card>
        </div>
      )}

      {/* Pass Rate Chart */}
      {passRateHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="size-5" />
              Pass Rate History
            </CardTitle>
            <CardDescription>Pass rate over recent test runs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-48 flex items-end gap-2">
              {passRateHistory.map((group, index) => (
                <div
                  key={index}
                  className="flex-1 flex flex-col items-center gap-2"
                >
                  <div className="w-full flex items-end justify-center h-full">
                    <div
                      className={cn(
                        "w-full rounded-t",
                        group.passRate >= 80
                          ? "bg-green-500"
                          : group.passRate >= 50
                            ? "bg-yellow-500"
                            : "bg-red-500"
                      )}
                      style={{ height: `${group.passRate}%` }}
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {group.label}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Controls */}
      {results.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4">
            {/* Filter */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Filter:</span>
              <Select
                value={filterStatus}
                onValueChange={(v) => setFilterStatus(v as FilterStatus)}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="passed">Passed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator orientation="vertical" className="h-6" />

            {/* Sort */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">Sort by:</span>
              <Button
                variant={sortField === "timestamp" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => toggleSort("timestamp")}
              >
                Time
                {sortField === "timestamp" &&
                  (sortOrder === "asc" ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  ))}
              </Button>
              <Button
                variant={sortField === "duration" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => toggleSort("duration")}
              >
                Duration
                {sortField === "duration" &&
                  (sortOrder === "asc" ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  ))}
              </Button>
              <Button
                variant={sortField === "status" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => toggleSort("status")}
              >
                Status
                {sortField === "status" &&
                  (sortOrder === "asc" ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  ))}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results list */}
      {filteredAndSortedResults.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="size-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No test results</h3>
            <p className="text-muted-foreground mb-4">
              {results.length === 0
                ? "Run this test to see results"
                : "No results match your filters"}
            </p>
            {results.length === 0 && (
              <Button onClick={handleRunTest} disabled={isRunning}>
                {isRunning ? (
                  <>
                    <Loader2 className="animate-spin" />
                    Running
                  </>
                ) : (
                  <>
                    <Play />
                    Run Test
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredAndSortedResults.map((result) => (
            <Card
              key={result.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => setSelectedResult(result)}
            >
              <CardContent className="py-4">
                <div className="flex items-center gap-4">
                  {/* Status icon */}
                  <div className="flex-shrink-0">
                    {result.passed ? (
                      <CheckCircle2 className="size-8 text-green-500" />
                    ) : (
                      <XCircle className="size-8 text-red-500" />
                    )}
                  </div>

                  {/* Result info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={result.passed ? "default" : "destructive"}
                      >
                        {result.passed ? "Passed" : "Failed"}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {new Date(result.startTime).toLocaleString()}
                      </span>
                    </div>

                    {result.error && (
                      <p className="text-sm text-destructive flex items-start gap-1 mb-2">
                        <AlertCircle className="size-4 mt-0.5 flex-shrink-0" />
                        <span className="truncate">{result.error}</span>
                      </p>
                    )}

                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Clock className="size-4" />
                        {(result.duration / 1000).toFixed(2)}s
                      </span>
                      <span>
                        {result.assertions.filter((a) => a.passed).length}/
                        {result.assertions.length} assertions passed
                      </span>
                      {result.actionsExecuted !== undefined && (
                        <span>{result.actionsExecuted} actions</span>
                      )}
                    </div>
                  </div>

                  {/* View details */}
                  <Button variant="ghost" size="sm">
                    <Info />
                    Details
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Result details dialog */}
      {selectedResult && (
        <ResultDetailsDialog
          result={selectedResult}
          onClose={() => setSelectedResult(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// Result Details Dialog
// ============================================================================

interface ResultDetailsDialogProps {
  result: TestResult;
  onClose: () => void;
}

function ResultDetailsDialog({ result, onClose }: ResultDetailsDialogProps) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {result.passed ? (
              <CheckCircle2 className="size-6 text-green-500" />
            ) : (
              <XCircle className="size-6 text-red-500" />
            )}
            <DialogTitle>Test Result Details</DialogTitle>
          </div>
          <DialogDescription>
            {result.testCaseName} -{" "}
            {new Date(result.startTime).toLocaleString()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge
                    variant={result.passed ? "default" : "destructive"}
                    className="ml-2"
                  >
                    {result.passed ? "Passed" : "Failed"}
                  </Badge>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">
                    Duration
                  </span>
                  <p className="font-medium">
                    {(result.duration / 1000).toFixed(2)}s
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">
                    Start Time
                  </span>
                  <p className="font-medium">
                    {new Date(result.startTime).toLocaleString()}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">
                    End Time
                  </span>
                  <p className="font-medium">
                    {new Date(result.endTime).toLocaleString()}
                  </p>
                </div>
              </div>

              {result.error && (
                <div className="mt-4 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                  <p className="text-sm font-medium text-destructive mb-1">
                    Error
                  </p>
                  <p className="text-sm">{result.error}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Assertions */}
          <Card>
            <CardHeader>
              <CardTitle>
                Assertions ({result.assertions.filter((a) => a.passed).length}/
                {result.assertions.length} passed)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {result.assertions.map((assertion, index) => (
                  <AssertionResultCard key={index} assertion={assertion} />
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Execution Path */}
          {result.executionPath && result.executionPath.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Execution Path</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {result.executionPath.map((actionId, index) => (
                    <React.Fragment key={index}>
                      <Badge variant="outline">{actionId}</Badge>
                      {index < result.executionPath!.length - 1 && (
                        <span className="text-muted-foreground">→</span>
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Final State */}
          {result.finalState && (
            <Card>
              <CardHeader>
                <CardTitle>Final State</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {result.finalState.variables &&
                    Object.keys(result.finalState.variables).length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Variables</h4>
                        <pre className="text-sm bg-muted p-3 rounded-md overflow-x-auto">
                          {JSON.stringify(result.finalState.variables, null, 2)}
                        </pre>
                      </div>
                    )}

                  {result.finalState.activeStates &&
                    result.finalState.activeStates.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Active States</h4>
                        <div className="flex flex-wrap gap-2">
                          {result.finalState.activeStates.map((state) => (
                            <Badge key={state} variant="secondary">
                              {state}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Assertion Result Card
// ============================================================================

interface AssertionResultCardProps {
  assertion: AssertionResult;
}

function AssertionResultCard({ assertion }: AssertionResultCardProps) {
  return (
    <div
      className={cn(
        "p-3 rounded-md border",
        assertion.passed
          ? "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800"
          : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
      )}
    >
      <div className="flex items-start gap-2">
        {assertion.passed ? (
          <CheckCircle2 className="size-5 text-green-500 flex-shrink-0 mt-0.5" />
        ) : (
          <XCircle className="size-5 text-red-500 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Badge variant="outline" className="text-xs">
              {assertion.assertion.type}
            </Badge>
            {assertion.assertion.path && (
              <span className="text-xs text-muted-foreground font-mono">
                {assertion.assertion.path}
              </span>
            )}
          </div>

          {assertion.assertion.description && (
            <p className="text-sm mb-2">{assertion.assertion.description}</p>
          )}

          {!assertion.passed && assertion.error && (
            <p className="text-sm text-destructive">{assertion.error}</p>
          )}

          {assertion.actualValue !== undefined && (
            <div className="text-xs font-mono mt-2">
              <span className="text-muted-foreground">Actual: </span>
              <span>{JSON.stringify(assertion.actualValue)}</span>
            </div>
          )}

          {assertion.assertion.expected !== undefined && (
            <div className="text-xs font-mono">
              <span className="text-muted-foreground">Expected: </span>
              <span>{JSON.stringify(assertion.assertion.expected)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
