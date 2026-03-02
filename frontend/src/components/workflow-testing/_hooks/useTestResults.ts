import * as React from "react";
import type {
  TestCase,
  TestResult,
  TestStatistics,
} from "@/services/workflow-testing-service";
import type {
  SortField,
  SortOrder,
  FilterStatus,
  Trend,
  UseTestResultsReturn,
} from "../test-results-types";

export function useTestResults(
  testCase: TestCase,
  results: TestResult[],
  onRunTest: () => void,
  onClearResults: () => void
): UseTestResultsReturn {
  const [sortField, setSortField] = React.useState<SortField>("timestamp");
  const [sortOrder, setSortOrder] = React.useState<SortOrder>("desc");
  const [filterStatus, setFilterStatus] = React.useState<FilterStatus>("all");
  const [selectedResult, setSelectedResult] = React.useState<TestResult | null>(
    null
  );
  const [isRunning, setIsRunning] = React.useState(false);

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

  const trend = React.useMemo((): Trend => {
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

    if (filterStatus === "passed") {
      filtered = filtered.filter((r) => r.passed);
    } else if (filterStatus === "failed") {
      filtered = filtered.filter((r) => !r.passed);
    }

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

    return groups.reverse();
  }, [results]);

  const handleRunTest = React.useCallback(() => {
    setIsRunning(true);
    onRunTest();
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

  return {
    sortField,
    sortOrder,
    filterStatus,
    setFilterStatus,
    selectedResult,
    setSelectedResult,
    isRunning,
    statistics,
    trend,
    filteredAndSortedResults,
    passRateHistory,
    handleRunTest,
    handleClearResults,
    handleExportResults,
    toggleSort,
  };
}
