/**
 * Workflow Testing Page
 *
 * Comprehensive testing interface for workflows with:
 * - Test case and suite management
 * - Test execution and monitoring
 * - Results visualization
 * - Coverage analysis
 * - Import/Export functionality
 */

"use client";

import * as React from "react";
import { Suspense } from "react";
import { RequireProject } from "@/components/require-project";
import { Loader2 } from "lucide-react";
import {
  Play,
  Plus,
  Download,
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  AlertCircle,
  FileText,
  FolderOpen,
  TestTube2,
  BarChart3,
  Settings,
  Minus,
  Zap,
  Copy,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { TestCaseEditor } from "@/components/workflow-testing/TestCaseEditor";
import {
  getWorkflowTestingService,
  type TestCase,
  type TestSuite,
  type TestResult,
  type WorkflowCoverage,
} from "@/services/workflow-testing-service";
import type { Workflow } from "@/lib/action-schema/action-types";

// ============================================================================
// Types
// ============================================================================

type NavigatorTab = "suites" | "cases" | "workflows";
type FilterStatus = "all" | "passed" | "failed" | "not-run";
type SortBy = "name" | "status" | "last-run" | "duration";

interface TestExecutionState {
  isRunning: boolean;
  currentTest?: string;
  progress: number;
  totalTests: number;
  completedTests: number;
  results: TestResult[];
}

// ============================================================================
// Main Component
// ============================================================================

export default function WorkflowTestingPage() {
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
  const [_showCreateSuite, setShowCreateSuite] = React.useState(false);
  const [showImportDialog, setShowImportDialog] = React.useState(false);
  const [editingTest, setEditingTest] = React.useState<TestCase | null>(null);

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

  React.useEffect(() => {
    loadData();
  }, []);

  const loadData = React.useCallback(() => {
    setTestCases(testingService.getAllTestCases());
    setTestSuites(testingService.getAllTestSuites());
    setTestResults(testingService.getAllTestResults());

    // Load mock workflows (in real app, fetch from API)
    setWorkflows([]);
  }, [testingService]);

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
  // Handlers - Test Cases
  // ========================================================================

  const handleCreateTest = React.useCallback(
    (testCase: TestCase) => {
      testingService.createTestCase(testCase.workflowId, testCase.config, {
        name: testCase.name,
        description: testCase.description,
        enabled: testCase.enabled,
      });
      loadData();
      setShowCreateTest(false);
      setEditingTest(null);
    },
    [testingService, loadData]
  );

  const handleUpdateTest = React.useCallback(
    (testCase: TestCase) => {
      testingService.updateTestCase(testCase.id, testCase);
      loadData();
      setEditingTest(null);
    },
    [testingService, loadData]
  );

  const handleDeleteTest = React.useCallback(
    (testId: string) => {
      if (confirm("Are you sure you want to delete this test case?")) {
        testingService.deleteTestCase(testId);
        loadData();
        if (selectedTestCase?.id === testId) {
          setSelectedTestCase(null);
        }
      }
    },
    [testingService, loadData, selectedTestCase]
  );

  const handleDuplicateTest = React.useCallback(
    (testId: string) => {
      testingService.duplicateTestCase(testId);
      loadData();
    },
    [testingService, loadData]
  );

  // ========================================================================
  // Handlers - Test Suites
  // ========================================================================

  // ========================================================================
  // Handlers - Test Execution
  // ========================================================================

  const handleRunTest = React.useCallback(
    async (testId: string) => {
      const testCase = testCases.find((tc) => tc.id === testId);
      if (!testCase) return;

      const workflow = workflows.find((w) => w.id === testCase.workflowId);

      setExecution({
        isRunning: true,
        currentTest: testCase.name,
        progress: 0,
        totalTests: 1,
        completedTests: 0,
        results: [],
      });

      try {
        const result = await testingService.runTestCase(testId, workflow);
        setExecution({
          isRunning: false,
          progress: 100,
          totalTests: 1,
          completedTests: 1,
          results: [result],
        });
        loadData();
      } catch (error) {
        console.error("Test execution failed:", error);
        setExecution({
          isRunning: false,
          progress: 0,
          totalTests: 1,
          completedTests: 0,
          results: [],
        });
      }
    },
    [testCases, workflows, testingService, loadData]
  );

  const handleRunSuite = React.useCallback(
    async (suiteId: string) => {
      const suite = testSuites.find((s) => s.id === suiteId);
      if (!suite) return;

      const workflowMap = new Map(workflows.map((w) => [w.id, w]));

      setExecution({
        isRunning: true,
        currentTest: suite.name,
        progress: 0,
        totalTests: suite.testCaseIds.length,
        completedTests: 0,
        results: [],
      });

      try {
        const results = await testingService.runTestSuite(suiteId, workflowMap);
        setExecution({
          isRunning: false,
          progress: 100,
          totalTests: suite.testCaseIds.length,
          completedTests: suite.testCaseIds.length,
          results,
        });
        loadData();
      } catch (error) {
        console.error("Suite execution failed:", error);
        setExecution({
          isRunning: false,
          progress: 0,
          totalTests: suite.testCaseIds.length,
          completedTests: 0,
          results: [],
        });
      }
    },
    [testSuites, workflows, testingService, loadData]
  );

  const handleRunAllTests = React.useCallback(async () => {
    const workflowMap = new Map(workflows.map((w) => [w.id, w]));
    const enabledTests = testCases.filter((tc) => tc.enabled !== false);

    setExecution({
      isRunning: true,
      currentTest: "All Tests",
      progress: 0,
      totalTests: enabledTests.length,
      completedTests: 0,
      results: [],
    });

    try {
      const results = await testingService.runAllTests(workflowMap);
      setExecution({
        isRunning: false,
        progress: 100,
        totalTests: enabledTests.length,
        completedTests: enabledTests.length,
        results,
      });
      loadData();
    } catch (error) {
      console.error("Test execution failed:", error);
      setExecution({
        isRunning: false,
        progress: 0,
        totalTests: enabledTests.length,
        completedTests: 0,
        results: [],
      });
    }
  }, [testCases, workflows, testingService, loadData]);

  const handleRunSelected = React.useCallback(async () => {
    const selectedTestCases = testCases.filter((tc) =>
      selectedTests.has(tc.id)
    );
    if (selectedTestCases.length === 0) return;

    setExecution({
      isRunning: true,
      currentTest: `${selectedTestCases.length} tests`,
      progress: 0,
      totalTests: selectedTestCases.length,
      completedTests: 0,
      results: [],
    });

    const results: TestResult[] = [];
    for (const tc of selectedTestCases) {
      const workflow = workflows.find((w) => w.id === tc.workflowId);
      try {
        const result = await testingService.runTestCase(tc.id, workflow);
        results.push(result);
        setExecution((prev) => ({
          ...prev,
          completedTests: results.length,
          progress: (results.length / selectedTestCases.length) * 100,
          currentTest: tc.name,
        }));
      } catch (error) {
        console.error("Test failed:", error);
      }
    }

    setExecution({
      isRunning: false,
      progress: 100,
      totalTests: selectedTestCases.length,
      completedTests: results.length,
      results,
    });
    loadData();
  }, [selectedTests, testCases, workflows, testingService, loadData]);

  // ========================================================================
  // Handlers - Import/Export
  // ========================================================================

  const handleExportTests = React.useCallback(() => {
    const data = testingService.exportAll();
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `workflow-tests-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [testingService]);

  const handleImportTests = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result as string;
          testingService.importAll(data);
          loadData();
          setShowImportDialog(false);
        } catch (error) {
          alert(
            "Failed to import tests: " +
              (error instanceof Error ? error.message : "Unknown error")
          );
        }
      };
      reader.readAsText(file);
    },
    [testingService, loadData]
  );

  // ========================================================================
  // Handlers - Selection
  // ========================================================================

  const clearSelection = React.useCallback(() => {
    setSelectedTests(new Set());
  }, []);

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
  // Render
  // ========================================================================

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-[#00D9FF]" />
        </div>
      }
    >
      <RequireProject pageName="Workflow Testing">
        <div className="flex flex-col h-screen bg-background">
          {/* Header */}
          <div className="border-b bg-card">
            <div className="container mx-auto px-6 py-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h1 className="text-3xl font-bold flex items-center gap-2">
                    <TestTube2 className="size-8" />
                    Workflow Testing
                  </h1>
                  <p className="text-muted-foreground mt-1">
                    Create, manage, and run tests for your workflows
                  </p>
                </div>

                {/* Quick Actions */}
                <div className="flex gap-2">
                  <Button
                    onClick={() => setShowCreateTest(true)}
                    variant="outline"
                    size="sm"
                  >
                    <Plus className="size-4" />
                    New Test Case
                  </Button>
                  <Button
                    onClick={() => setShowCreateSuite(true)}
                    variant="outline"
                    size="sm"
                  >
                    <Plus className="size-4" />
                    New Suite
                  </Button>
                  <Button
                    onClick={handleRunAllTests}
                    variant="default"
                    size="sm"
                    disabled={execution.isRunning || testCases.length === 0}
                  >
                    {execution.isRunning ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Play className="size-4" />
                    )}
                    Run All Tests
                  </Button>
                  <Button
                    onClick={handleExportTests}
                    variant="outline"
                    size="sm"
                  >
                    <Download className="size-4" />
                    Export
                  </Button>
                  <Button
                    onClick={() => setShowImportDialog(true)}
                    variant="outline"
                    size="sm"
                  >
                    <Upload className="size-4" />
                    Import
                  </Button>
                </div>
              </div>

              {/* Summary Metrics */}
              <div className="grid grid-cols-5 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <FileText className="size-8 text-blue-500" />
                      <div>
                        <p className="text-2xl font-bold">
                          {stats.totalTestCases}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Test Cases
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <FolderOpen className="size-8 text-purple-500" />
                      <div>
                        <p className="text-2xl font-bold">
                          {stats.totalTestSuites}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Test Suites
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      {stats.passRate >= 80 ? (
                        <CheckCircle2 className="size-8 text-green-500" />
                      ) : stats.passRate >= 50 ? (
                        <AlertCircle className="size-8 text-yellow-500" />
                      ) : (
                        <XCircle className="size-8 text-red-500" />
                      )}
                      <div>
                        <p className="text-2xl font-bold">
                          {stats.passRate > 0
                            ? `${stats.passRate.toFixed(0)}%`
                            : "N/A"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Pass Rate
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <Clock className="size-8 text-orange-500" />
                      <div>
                        <p className="text-2xl font-bold">
                          {stats.testsRunToday}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Tests Run Today
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <div className="flex items-center gap-3">
                      <AlertCircle className="size-8 text-red-500" />
                      <div>
                        <p className="text-2xl font-bold">
                          {stats.failedTestsCount}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Failed Tests
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>

          {/* Test Execution Progress */}
          {execution.isRunning && (
            <div className="border-b bg-blue-50 dark:bg-blue-950/20">
              <div className="container mx-auto px-6 py-3">
                <div className="flex items-center gap-4">
                  <Loader2 className="size-5 animate-spin text-blue-500" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium">
                        Running: {execution.currentTest}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {execution.completedTests} / {execution.totalTests}
                      </p>
                    </div>
                    <Progress value={execution.progress} className="h-2" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Batch Operations Toolbar */}
          {selectedTests.size > 0 && (
            <div className="border-b bg-accent/50">
              <div className="container mx-auto px-6 py-2">
                <div className="flex items-center gap-4">
                  <p className="text-sm font-medium">
                    {selectedTests.size} test
                    {selectedTests.size !== 1 ? "s" : ""} selected
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={handleRunSelected}
                      variant="outline"
                      size="sm"
                      disabled={execution.isRunning}
                    >
                      <Play className="size-4" />
                      Run Selected
                    </Button>
                    <Button
                      onClick={() => {
                        selectedTests.forEach((id) => handleDeleteTest(id));
                        clearSelection();
                      }}
                      variant="outline"
                      size="sm"
                    >
                      <Trash2 className="size-4" />
                      Delete Selected
                    </Button>
                    <Button onClick={clearSelection} variant="ghost" size="sm">
                      Clear Selection
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Main Content - Three Column Layout */}
          <div className="flex-1 overflow-hidden">
            <div className="container mx-auto h-full">
              <div className="flex h-full gap-4 py-4">
                {/* Left Sidebar - Test Navigator (20%) */}
                <div className="w-1/5 flex flex-col">
                  <Card className="flex-1 flex flex-col">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg">Test Navigator</CardTitle>
                    </CardHeader>
                    <Tabs
                      value={navigatorTab}
                      onValueChange={(v) => setNavigatorTab(v as NavigatorTab)}
                      className="flex-1 flex flex-col"
                    >
                      <div className="px-6">
                        <TabsList className="grid w-full grid-cols-3">
                          <TabsTrigger value="suites">Suites</TabsTrigger>
                          <TabsTrigger value="cases">Cases</TabsTrigger>
                          <TabsTrigger value="workflows">Workflows</TabsTrigger>
                        </TabsList>
                      </div>

                      <TabsContent
                        value="suites"
                        className="flex-1 mt-0 px-6 pb-6"
                      >
                        <ScrollArea className="h-full">
                          <div className="space-y-2">
                            {testSuites.map((suite) => {
                              const status = getSuiteStatus(suite);
                              return (
                                <button
                                  key={suite.id}
                                  onClick={() => {
                                    setSelectedSuite(suite);
                                    setSelectedTestCase(null);
                                    setSelectedWorkflow(null);
                                  }}
                                  className={cn(
                                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                                    selectedSuite?.id === suite.id
                                      ? "bg-accent"
                                      : "hover:bg-accent/50"
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    {status === "passed" && (
                                      <CheckCircle2 className="size-4 text-green-500 flex-shrink-0" />
                                    )}
                                    {status === "failed" && (
                                      <XCircle className="size-4 text-red-500 flex-shrink-0" />
                                    )}
                                    {status === "not-run" && (
                                      <Minus className="size-4 text-muted-foreground flex-shrink-0" />
                                    )}
                                    {status === "partial" && (
                                      <AlertCircle className="size-4 text-yellow-500 flex-shrink-0" />
                                    )}
                                    <span className="truncate flex-1">
                                      {suite.name}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {suite.testCaseIds.length} tests
                                  </p>
                                </button>
                              );
                            })}
                            {testSuites.length === 0 && (
                              <p className="text-sm text-muted-foreground text-center py-8">
                                No test suites yet
                              </p>
                            )}
                          </div>
                        </ScrollArea>
                      </TabsContent>

                      <TabsContent
                        value="cases"
                        className="flex-1 mt-0 px-6 pb-6"
                      >
                        <div className="space-y-3 mb-3">
                          <Input
                            placeholder="Search tests..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-8"
                          />
                          <Select
                            value={filterStatus}
                            onValueChange={(v) =>
                              setFilterStatus(v as FilterStatus)
                            }
                          >
                            <SelectTrigger className="h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Tests</SelectItem>
                              <SelectItem value="passed">Passed</SelectItem>
                              <SelectItem value="failed">Failed</SelectItem>
                              <SelectItem value="not-run">Not Run</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <ScrollArea className="h-[calc(100%-80px)]">
                          <div className="space-y-2">
                            {filteredTestCases.map((testCase) => {
                              const status = getTestStatus(testCase.id);
                              return (
                                <button
                                  key={testCase.id}
                                  onClick={() => {
                                    setSelectedTestCase(testCase);
                                    setSelectedSuite(null);
                                    setSelectedWorkflow(null);
                                  }}
                                  className={cn(
                                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                                    selectedTestCase?.id === testCase.id
                                      ? "bg-accent"
                                      : "hover:bg-accent/50"
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    {getTestStatusIcon(status)}
                                    <span className="truncate flex-1">
                                      {testCase.name}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                            {filteredTestCases.length === 0 && (
                              <p className="text-sm text-muted-foreground text-center py-8">
                                No test cases found
                              </p>
                            )}
                          </div>
                        </ScrollArea>
                      </TabsContent>

                      <TabsContent
                        value="workflows"
                        className="flex-1 mt-0 px-6 pb-6"
                      >
                        <ScrollArea className="h-full">
                          <div className="space-y-2">
                            {workflows.map((workflow) => {
                              const workflowTests = testCases.filter(
                                (tc) => tc.workflowId === workflow.id
                              );
                              return (
                                <button
                                  key={workflow.id}
                                  onClick={() => {
                                    setSelectedWorkflow(workflow);
                                    setSelectedTestCase(null);
                                    setSelectedSuite(null);
                                  }}
                                  className={cn(
                                    "w-full text-left px-3 py-2 rounded-md text-sm transition-colors",
                                    selectedWorkflow?.id === workflow.id
                                      ? "bg-accent"
                                      : "hover:bg-accent/50"
                                  )}
                                >
                                  <div className="flex items-center gap-2">
                                    <Zap className="size-4 text-blue-500 flex-shrink-0" />
                                    <span className="truncate flex-1">
                                      {workflow.name}
                                    </span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {workflowTests.length} tests
                                  </p>
                                </button>
                              );
                            })}
                            {workflows.length === 0 && (
                              <p className="text-sm text-muted-foreground text-center py-8">
                                No workflows available
                              </p>
                            )}
                          </div>
                        </ScrollArea>
                      </TabsContent>
                    </Tabs>
                  </Card>
                </div>

                {/* Center Column - Test Details (50%) */}
                <div className="w-1/2 flex flex-col">
                  <ScrollArea className="h-full">
                    {selectedTestCase ? (
                      <TestCaseDetails
                        testCase={selectedTestCase}
                        results={testResults.get(selectedTestCase.id) || []}
                        onRun={handleRunTest}
                        onEdit={setEditingTest}
                        onDuplicate={handleDuplicateTest}
                        onDelete={handleDeleteTest}
                        isRunning={
                          execution.isRunning &&
                          execution.currentTest === selectedTestCase.name
                        }
                      />
                    ) : selectedSuite ? (
                      <TestSuiteDetails
                        suite={selectedSuite}
                        testCases={testCases.filter((tc) =>
                          selectedSuite.testCaseIds.includes(tc.id)
                        )}
                        onRun={handleRunSuite}
                        onEdit={() => {
                          /* TODO: Implement edit suite */
                        }}
                        isRunning={
                          execution.isRunning &&
                          execution.currentTest === selectedSuite.name
                        }
                      />
                    ) : selectedWorkflow ? (
                      <WorkflowTestDetails
                        workflow={selectedWorkflow}
                        testCases={testCases.filter(
                          (tc) => tc.workflowId === selectedWorkflow.id
                        )}
                        coverage={coverage.get(selectedWorkflow.id)}
                      />
                    ) : (
                      <GettingStarted
                        onCreateTest={() => setShowCreateTest(true)}
                      />
                    )}
                  </ScrollArea>
                </div>

                {/* Right Sidebar - Test Results (30%) */}
                <div className="w-[30%] flex flex-col">
                  <Card className="flex-1 flex flex-col">
                    <CardHeader>
                      <CardTitle className="text-lg">Test Results</CardTitle>
                      <CardDescription>
                        Latest results and statistics
                      </CardDescription>
                    </CardHeader>
                    <ScrollArea className="flex-1">
                      <CardContent>
                        {selectedTestCase ? (
                          <TestResults
                            testCase={selectedTestCase}
                            results={testResults.get(selectedTestCase.id) || []}
                          />
                        ) : selectedSuite ? (
                          <SuiteResults
                            suite={selectedSuite}
                            testCases={testCases.filter((tc) =>
                              selectedSuite.testCaseIds.includes(tc.id)
                            )}
                            testResults={testResults}
                          />
                        ) : execution.results.length > 0 ? (
                          <ExecutionResults results={execution.results} />
                        ) : (
                          <div className="text-center text-muted-foreground py-12">
                            <BarChart3 className="size-12 mx-auto mb-4 opacity-50" />
                            <p className="text-sm">
                              Select a test or suite to view results
                            </p>
                          </div>
                        )}
                      </CardContent>
                    </ScrollArea>
                  </Card>
                </div>
              </div>
            </div>
          </div>

          {/* Modals */}
          {showCreateTest && workflows.length > 0 && (
            <Dialog open onOpenChange={() => setShowCreateTest(false)}>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <TestCaseEditor
                  workflow={workflows[0]!}
                  onSave={handleCreateTest}
                  onCancel={() => setShowCreateTest(false)}
                />
              </DialogContent>
            </Dialog>
          )}

          {editingTest && (
            <Dialog open onOpenChange={() => setEditingTest(null)}>
              <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <TestCaseEditor
                  testCase={editingTest}
                  workflow={
                    (workflows.find((w) => w.id === editingTest.workflowId) ||
                      workflows[0])!
                  }
                  onSave={handleUpdateTest}
                  onCancel={() => setEditingTest(null)}
                />
              </DialogContent>
            </Dialog>
          )}

          {showImportDialog && (
            <Dialog open onOpenChange={() => setShowImportDialog(false)}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Import Tests</DialogTitle>
                  <DialogDescription>
                    Select a JSON file containing test cases and suites
                  </DialogDescription>
                </DialogHeader>
                <div className="py-4">
                  <Input
                    type="file"
                    accept=".json"
                    onChange={handleImportTests}
                  />
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => setShowImportDialog(false)}
                    variant="outline"
                  >
                    Cancel
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </RequireProject>
    </Suspense>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function GettingStarted({ onCreateTest }: { onCreateTest: () => void }) {
  return (
    <Card>
      <CardContent className="py-12">
        <div className="text-center max-w-md mx-auto">
          <TestTube2 className="size-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold mb-2">Get Started with Testing</h2>
          <p className="text-muted-foreground mb-6">
            Create your first test case to validate workflow behavior and ensure
            quality
          </p>
          <Button onClick={onCreateTest} size="lg">
            <Plus className="size-5" />
            Create Your First Test
          </Button>

          <div className="mt-8 space-y-4 text-left">
            <h3 className="font-semibold">Quick Tips:</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex gap-2">
                <CheckCircle2 className="size-5 text-green-500 flex-shrink-0" />
                <span>Create test cases to validate specific scenarios</span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="size-5 text-green-500 flex-shrink-0" />
                <span>
                  Group related tests into suites for organized execution
                </span>
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="size-5 text-green-500 flex-shrink-0" />
                <span>Monitor coverage to identify untested workflows</span>
              </li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TestCaseDetails({
  testCase,
  results,
  onRun,
  onEdit,
  onDuplicate,
  onDelete,
  isRunning,
}: {
  testCase: TestCase;
  results: TestResult[];
  onRun: (id: string) => void;
  onEdit: (testCase: TestCase) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  isRunning: boolean;
}) {
  const lastResult = results[0];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <CardTitle>{testCase.name}</CardTitle>
              {testCase.description && (
                <CardDescription>{testCase.description}</CardDescription>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => onRun(testCase.id)}
                variant="default"
                size="sm"
                disabled={isRunning}
              >
                {isRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                Run
              </Button>
              <Button
                onClick={() => onEdit(testCase)}
                variant="outline"
                size="sm"
              >
                <Settings className="size-4" />
                Edit
              </Button>
              <Button
                onClick={() => onDuplicate(testCase.id)}
                variant="outline"
                size="sm"
              >
                <Copy className="size-4" />
                Clone
              </Button>
              <Button
                onClick={() => onDelete(testCase.id)}
                variant="ghost"
                size="sm"
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Status */}
            {lastResult && (
              <div className="flex items-center gap-2">
                {lastResult.passed ? (
                  <CheckCircle2 className="size-5 text-green-500" />
                ) : (
                  <XCircle className="size-5 text-red-500" />
                )}
                <span className="font-medium">
                  Last Run: {lastResult.passed ? "Passed" : "Failed"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {new Date(lastResult.endTime).toLocaleString()}
                </span>
              </div>
            )}

            {/* Configuration */}
            <div>
              <h3 className="font-semibold mb-2">Configuration</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Assertions:</span>
                  <span>{testCase.config.assertions.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Timeout:</span>
                  <span>{testCase.config.timeout || 60000}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Enabled:</span>
                  <span>{testCase.enabled !== false ? "Yes" : "No"}</span>
                </div>
              </div>
            </div>

            {/* Tags */}
            {testCase.config.tags && testCase.config.tags.length > 0 && (
              <div>
                <h3 className="font-semibold mb-2">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {testCase.config.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Assertions */}
            <div>
              <h3 className="font-semibold mb-2">Assertions</h3>
              <div className="space-y-2">
                {testCase.config.assertions.map((assertion) => (
                  <div
                    key={assertion.id}
                    className="text-sm p-2 border rounded-md bg-accent/50"
                  >
                    <div className="font-medium">{assertion.type}</div>
                    {assertion.description && (
                      <div className="text-muted-foreground">
                        {assertion.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TestSuiteDetails({
  suite,
  testCases,
  onRun,
  onEdit,
  isRunning,
}: {
  suite: TestSuite;
  testCases: TestCase[];
  onRun: (id: string) => void;
  onEdit: () => void;
  isRunning: boolean;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle>{suite.name}</CardTitle>
              {suite.description && (
                <CardDescription>{suite.description}</CardDescription>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => onRun(suite.id)}
                variant="default"
                size="sm"
                disabled={isRunning}
              >
                {isRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Play className="size-4" />
                )}
                Run Suite
              </Button>
              <Button onClick={onEdit} variant="outline" size="sm">
                <Settings className="size-4" />
                Edit
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Settings */}
            <div className="flex gap-2">
              <Badge variant="outline">
                {suite.executionOrder === "parallel"
                  ? "Parallel"
                  : "Sequential"}
              </Badge>
              {suite.stopOnFailure && (
                <Badge variant="outline">Stop on Failure</Badge>
              )}
            </div>

            {/* Test Cases */}
            <div>
              <h3 className="font-semibold mb-2">
                Test Cases ({testCases.length})
              </h3>
              <div className="space-y-2">
                {testCases.map((testCase) => (
                  <div
                    key={testCase.id}
                    className="text-sm p-3 border rounded-md flex items-center justify-between"
                  >
                    <span>{testCase.name}</span>
                    {!testCase.enabled && (
                      <Badge variant="outline">Disabled</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function WorkflowTestDetails({
  workflow,
  testCases,
  coverage,
}: {
  workflow: Workflow;
  testCases: TestCase[];
  coverage?: WorkflowCoverage;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{workflow.name}</CardTitle>
          <CardDescription>Workflow test coverage and details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Coverage */}
            {coverage && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">Coverage</span>
                  <span className="text-sm">
                    {coverage.coveragePercentage.toFixed(1)}%
                  </span>
                </div>
                <Progress value={coverage.coveragePercentage} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>
                    {coverage.coveredActions} / {coverage.totalActions} actions
                    covered
                  </span>
                </div>
              </div>
            )}

            {/* Test Cases */}
            <div>
              <h3 className="font-semibold mb-2">
                Test Cases ({testCases.length})
              </h3>
              {testCases.length > 0 ? (
                <div className="space-y-2">
                  {testCases.map((testCase) => (
                    <div
                      key={testCase.id}
                      className="text-sm p-2 border rounded-md"
                    >
                      {testCase.name}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No test cases for this workflow yet
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TestResults({
  testCase: _testCase,
  results,
}: {
  testCase?: TestCase;
  results: TestResult[];
}) {
  const lastResult = results[0];
  const stats = React.useMemo(() => {
    if (results.length === 0) return null;

    const passed = results.filter((r) => r.passed).length;
    const durations = results.map((r) => r.duration);

    return {
      totalRuns: results.length,
      passRate: (passed / results.length) * 100,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
    };
  }, [results]);

  if (!lastResult) {
    return (
      <div className="text-center text-muted-foreground py-8">
        <Clock className="size-12 mx-auto mb-4 opacity-50" />
        <p className="text-sm">No test results yet</p>
        <p className="text-xs mt-2">Run this test to see results</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Latest Result */}
      <div>
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          Latest Result
          {lastResult.passed ? (
            <CheckCircle2 className="size-4 text-green-500" />
          ) : (
            <XCircle className="size-4 text-red-500" />
          )}
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Status:</span>
            <span
              className={lastResult.passed ? "text-green-500" : "text-red-500"}
            >
              {lastResult.passed ? "Passed" : "Failed"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Duration:</span>
            <span>{lastResult.duration}ms</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Executed:</span>
            <span>{new Date(lastResult.endTime).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Assertions */}
      <div>
        <h3 className="font-semibold mb-2">Assertions</h3>
        <div className="space-y-2">
          {lastResult.assertions.map((assertion, i) => (
            <div
              key={i}
              className={cn(
                "text-sm p-2 border rounded-md flex items-start gap-2",
                assertion.passed
                  ? "bg-green-50 dark:bg-green-950/20"
                  : "bg-red-50 dark:bg-red-950/20"
              )}
            >
              {assertion.passed ? (
                <CheckCircle2 className="size-4 text-green-500 flex-shrink-0 mt-0.5" />
              ) : (
                <XCircle className="size-4 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <div className="font-medium">{assertion.assertion.type}</div>
                {assertion.error && (
                  <div className="text-xs text-red-600 dark:text-red-400 mt-1">
                    {assertion.error}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Statistics */}
      {stats && (
        <div>
          <h3 className="font-semibold mb-2">Statistics</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total Runs:</span>
              <span>{stats.totalRuns}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Pass Rate:</span>
              <span>{stats.passRate.toFixed(1)}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg Duration:</span>
              <span>{stats.avgDuration.toFixed(0)}ms</span>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="font-semibold mb-2">History</h3>
        <div className="space-y-1">
          {results.slice(0, 10).map((result) => (
            <div
              key={result.id}
              className="text-xs flex items-center justify-between p-1.5 rounded hover:bg-accent"
            >
              <div className="flex items-center gap-2">
                {result.passed ? (
                  <CheckCircle2 className="size-3 text-green-500" />
                ) : (
                  <XCircle className="size-3 text-red-500" />
                )}
                <span>{new Date(result.endTime).toLocaleString()}</span>
              </div>
              <span className="text-muted-foreground">{result.duration}ms</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SuiteResults({
  suite: _suite,
  testCases,
  testResults,
}: {
  suite?: TestSuite;
  testCases: TestCase[];
  testResults: Map<string, TestResult[]>;
}) {
  const results = React.useMemo(() => {
    return testCases.map((tc) => ({
      testCase: tc,
      result: testResults.get(tc.id)?.[0],
    }));
  }, [testCases, testResults]);

  const summary = React.useMemo(() => {
    const total = results.length;
    const run = results.filter((r) => r.result).length;
    const passed = results.filter((r) => r.result?.passed).length;
    const failed = results.filter((r) => r.result && !r.result.passed).length;

    return { total, run, passed, failed, notRun: total - run };
  }, [results]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Tests:</span>
            <span>{summary.total}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-600 dark:text-green-400">Passed:</span>
            <span>{summary.passed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-red-600 dark:text-red-400">Failed:</span>
            <span>{summary.failed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Not Run:</span>
            <span>{summary.notRun}</span>
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="font-semibold mb-2">Test Results</h3>
        <div className="space-y-2">
          {results.map(({ testCase, result }) => (
            <div key={testCase.id} className="text-sm p-2 border rounded-md">
              <div className="flex items-center gap-2">
                {result ? (
                  result.passed ? (
                    <CheckCircle2 className="size-4 text-green-500" />
                  ) : (
                    <XCircle className="size-4 text-red-500" />
                  )
                ) : (
                  <Minus className="size-4 text-muted-foreground" />
                )}
                <span className="flex-1">{testCase.name}</span>
              </div>
              {result && (
                <div className="text-xs text-muted-foreground mt-1">
                  {result.duration}ms
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExecutionResults({ results }: { results: TestResult[] }) {
  const summary = React.useMemo(() => {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    return { passed, failed, totalDuration };
  }, [results]);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-semibold mb-2">Execution Summary</h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Tests:</span>
            <span>{results.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-600 dark:text-green-400">Passed:</span>
            <span>{summary.passed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-red-600 dark:text-red-400">Failed:</span>
            <span>{summary.failed}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total Duration:</span>
            <span>{summary.totalDuration}ms</span>
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <h3 className="font-semibold mb-2">Results</h3>
        <div className="space-y-2">
          {results.map((result) => (
            <div key={result.id} className="text-sm p-2 border rounded-md">
              <div className="flex items-center gap-2">
                {result.passed ? (
                  <CheckCircle2 className="size-4 text-green-500" />
                ) : (
                  <XCircle className="size-4 text-red-500" />
                )}
                <span className="flex-1">{result.testCaseName}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {result.duration}ms
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
