import * as React from "react";
import { CheckCircle2, XCircle, Minus } from "lucide-react";
import {
  getWorkflowTestingService,
  type TestCase,
  type TestSuite,
  type TestResult,
  type WorkflowCoverage,
} from "@/services/workflow-testing";
import type { Workflow } from "@/lib/action-schema/action-types";
import type {
  NavigatorTab,
  FilterStatus,
  SortBy,
  TestExecutionState,
} from "../_types";

export function useTestingState() {
  const testingService = React.useMemo(() => getWorkflowTestingService(), []);

  // ========================================================================
  // State - Data
  // ========================================================================

  const [testCases, setTestCases] = React.useState<TestCase[]>([]);
  const [testSuites, setTestSuites] = React.useState<TestSuite[]>([]);
  const [workflows, setWorkflows] = React.useState<Workflow[]>([]);
  const [testResults, setTestResults] = React.useState<
    Map<string, TestResult[]>
  >(new Map());
  const [coverage] = React.useState<Map<string, WorkflowCoverage>>(new Map());

  // ========================================================================
  // State - UI
  // ========================================================================

  const [navigatorTab, setNavigatorTab] =
    React.useState<NavigatorTab>("suites");
  const [selectedSuite, setSelectedSuite] = React.useState<TestSuite | null>(
    null
  );
  const [selectedTestCase, setSelectedTestCase] =
    React.useState<TestCase | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] =
    React.useState<Workflow | null>(null);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterStatus, setFilterStatus] = React.useState<FilterStatus>("all");
  const [sortBy] = React.useState<SortBy>("name");
  const [_showCoverage] = React.useState(false);

  // ========================================================================
  // State - Modals
  // ========================================================================

  const [showCreateTest, setShowCreateTest] = React.useState(false);
  const [showCreateSuite, setShowCreateSuite] = React.useState(false);
  const [showImportDialog, setShowImportDialog] = React.useState(false);
  const [editingTest, setEditingTest] = React.useState<TestCase | null>(null);
  const [editingSuite, setEditingSuite] = React.useState<TestSuite | null>(
    null
  );

  // ========================================================================
  // State - Test Execution
  // ========================================================================

  const [execution, setExecution] = React.useState<TestExecutionState>({
    isRunning: false,
    progress: 0,
    totalTests: 0,
    completedTests: 0,
    results: [],
  });

  // ========================================================================
  // State - Selection
  // ========================================================================

  const [selectedTests, setSelectedTests] = React.useState<Set<string>>(
    new Set()
  );

  // ========================================================================
  // Load Data
  // ========================================================================

  const loadData = React.useCallback(() => {
    setTestCases(testingService.getAllTestCases());
    setTestSuites(testingService.getAllTestSuites());
    setTestResults(testingService.getAllTestResults());

    // Load mock workflows (in real app, fetch from API)
    setWorkflows([]);
  }, [testingService]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // ========================================================================
  // Computed Values
  // ========================================================================

  const stats = React.useMemo(() => {
    const allResults = Array.from(testResults.values()).flat();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayResults = allResults.filter(
      (r) => new Date(r.startTime) >= today
    );

    const failedTests = new Set(
      allResults.filter((r) => !r.passed).map((r) => r.testCaseId)
    );

    const totalRuns = allResults.length;
    const passedRuns = allResults.filter((r) => r.passed).length;

    return {
      totalTestCases: testCases.length,
      totalTestSuites: testSuites.length,
      passRate: totalRuns > 0 ? (passedRuns / totalRuns) * 100 : 0,
      testsRunToday: todayResults.length,
      failedTestsCount: failedTests.size,
    };
  }, [testCases, testSuites, testResults]);

  const filteredTestCases = React.useMemo(() => {
    let filtered = [...testCases];

    // Search filter
    if (searchQuery) {
      filtered = filtered.filter(
        (tc) =>
          tc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          tc.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Status filter
    if (filterStatus !== "all") {
      filtered = filtered.filter((tc) => {
        const results = testResults.get(tc.id);
        const lastResult = results?.[0];

        if (filterStatus === "not-run") {
          return !lastResult;
        }
        if (filterStatus === "passed") {
          return lastResult?.passed;
        }
        if (filterStatus === "failed") {
          return lastResult && !lastResult.passed;
        }
        return true;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      if (sortBy === "name") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "status") {
        const aResult = testResults.get(a.id)?.[0];
        const bResult = testResults.get(b.id)?.[0];
        return (aResult?.passed ? 1 : 0) - (bResult?.passed ? 1 : 0);
      }
      if (sortBy === "last-run") {
        const aResult = testResults.get(a.id)?.[0];
        const bResult = testResults.get(b.id)?.[0];
        const aTime = aResult ? new Date(aResult.endTime).getTime() : 0;
        const bTime = bResult ? new Date(bResult.endTime).getTime() : 0;
        return bTime - aTime;
      }
      if (sortBy === "duration") {
        const aResult = testResults.get(a.id)?.[0];
        const bResult = testResults.get(b.id)?.[0];
        return (bResult?.duration || 0) - (aResult?.duration || 0);
      }
      return 0;
    });

    return filtered;
  }, [testCases, searchQuery, filterStatus, sortBy, testResults]);

  // ========================================================================
  // Render Helpers
  // ========================================================================

  const getTestStatus = (testId: string): "passed" | "failed" | "not-run" => {
    const results = testResults.get(testId);
    const lastResult = results?.[0];
    if (!lastResult) return "not-run";
    return lastResult.passed ? "passed" : "failed";
  };

  const getTestStatusIcon = (status: "passed" | "failed" | "not-run") => {
    if (status === "passed")
      return <CheckCircle2 className="size-4 text-green-500" />;
    if (status === "failed") return <XCircle className="size-4 text-red-500" />;
    return <Minus className="size-4 text-muted-foreground" />;
  };

  const getSuiteStatus = (
    suite: TestSuite
  ): "passed" | "failed" | "partial" | "not-run" => {
    const testCaseResults = suite.testCaseIds.map((id) => getTestStatus(id));

    if (testCaseResults.every((s) => s === "not-run")) return "not-run";
    if (testCaseResults.every((s) => s === "passed")) return "passed";
    if (testCaseResults.some((s) => s === "failed")) return "failed";
    return "partial";
  };

  // ========================================================================
  // Selection Helpers
  // ========================================================================

  const clearSelection = React.useCallback(() => {
    setSelectedTests(new Set());
  }, []);

  return {
    // Service
    testingService,
    // Data
    testCases,
    testSuites,
    workflows,
    testResults,
    coverage,
    // UI State
    navigatorTab,
    setNavigatorTab,
    selectedSuite,
    setSelectedSuite,
    selectedTestCase,
    setSelectedTestCase,
    selectedWorkflow,
    setSelectedWorkflow,
    searchQuery,
    setSearchQuery,
    filterStatus,
    setFilterStatus,
    // Modals
    showCreateTest,
    setShowCreateTest,
    showCreateSuite,
    setShowCreateSuite,
    showImportDialog,
    setShowImportDialog,
    editingTest,
    setEditingTest,
    editingSuite,
    setEditingSuite,
    // Execution
    execution,
    setExecution,
    // Selection
    selectedTests,
    setSelectedTests,
    clearSelection,
    // Computed
    stats,
    filteredTestCases,
    // Helpers
    getTestStatus,
    getTestStatusIcon,
    getSuiteStatus,
    // Data loading
    loadData,
  };
}
