"use client";

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
  Minus,
  Zap,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NavigatorTab, FilterStatus } from "../_types";
import type { TestSuite, TestCase } from "@/services/workflow-testing";
import type { Workflow } from "@/lib/action-schema/action-types";
import { useTestingState } from "../_hooks/useTestingState";
import { useTestExecution } from "../_hooks/useTestExecution";
import { useTestCaseHandlers } from "../_hooks/useTestCaseHandlers";
import { useTestSuiteHandlers } from "../_hooks/useTestSuiteHandlers";
import { useImportExport } from "../_hooks/useImportExport";
import { GettingStarted } from "./GettingStarted";
import { TestCaseDetails } from "./TestCaseDetails";
import { TestSuiteDetails } from "./TestSuiteDetails";
import { WorkflowTestDetails } from "./WorkflowTestDetails";
import { TestExecutionPanel } from "./TestExecutionPanel";
import { TestResultsView } from "./TestResultsView";
import { TestCaseEditorDialog } from "./TestCaseEditorDialog";

/**
 * Main orchestrator for the Workflow Testing page.
 * Composes all hooks and sub-components into a three-column layout:
 * - Left: Test Navigator (suites, cases, workflows tabs)
 * - Center: Detail view for selected item
 * - Right: Test results sidebar
 */
export function TestingContent() {
  const state = useTestingState();

  const {
    handleRunTest,
    handleRunSuite,
    handleRunAllTests,
    handleRunSelected,
  } = useTestExecution({
    testCases: state.testCases,
    testSuites: state.testSuites,
    workflows: state.workflows,
    testingService: state.testingService,
    loadData: state.loadData,
    selectedTests: state.selectedTests,
    setExecution: state.setExecution,
  });

  const {
    handleCreateTest,
    handleUpdateTest,
    handleDeleteTest,
    handleDuplicateTest,
  } = useTestCaseHandlers({
    testingService: state.testingService,
    loadData: state.loadData,
    selectedTestCase: state.selectedTestCase,
    setSelectedTestCase: state.setSelectedTestCase,
    setShowCreateTest: state.setShowCreateTest,
    setEditingTest: state.setEditingTest,
  });

  const { handleCreateSuite, handleUpdateSuite } = useTestSuiteHandlers({
    testingService: state.testingService,
    loadData: state.loadData,
    setShowCreateSuite: state.setShowCreateSuite,
    setEditingSuite: state.setEditingSuite,
  });

  const { handleExportTests, handleImportTests } = useImportExport({
    testingService: state.testingService,
    loadData: state.loadData,
    setShowImportDialog: state.setShowImportDialog,
  });

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <TestingHeader
        stats={state.stats}
        execution={state.execution}
        testCasesCount={state.testCases.length}
        onCreateTest={() => state.setShowCreateTest(true)}
        onCreateSuite={() => state.setShowCreateSuite(true)}
        onRunAllTests={handleRunAllTests}
        onExport={handleExportTests}
        onImport={() => state.setShowImportDialog(true)}
      />

      {/* Execution Progress + Batch Toolbar */}
      <TestExecutionPanel
        execution={state.execution}
        selectedTests={state.selectedTests}
        onRunSelected={handleRunSelected}
        onDeleteSelected={() => {
          state.selectedTests.forEach((id) => handleDeleteTest(id));
          state.clearSelection();
        }}
        onClearSelection={state.clearSelection}
      />

      {/* Main Content - Three Column Layout */}
      <div className="flex-1 overflow-hidden">
        <div className="container mx-auto h-full">
          <div className="flex h-full gap-4 py-4">
            {/* Left Sidebar - Test Navigator (20%) */}
            <div className="w-1/5 flex flex-col">
              <TestNavigator
                navigatorTab={state.navigatorTab}
                setNavigatorTab={state.setNavigatorTab}
                testSuites={state.testSuites}
                filteredTestCases={state.filteredTestCases}
                workflows={state.workflows}
                testCases={state.testCases}
                selectedSuite={state.selectedSuite}
                selectedTestCase={state.selectedTestCase}
                selectedWorkflow={state.selectedWorkflow}
                searchQuery={state.searchQuery}
                filterStatus={state.filterStatus}
                setSearchQuery={state.setSearchQuery}
                setFilterStatus={state.setFilterStatus}
                setSelectedSuite={state.setSelectedSuite}
                setSelectedTestCase={state.setSelectedTestCase}
                setSelectedWorkflow={state.setSelectedWorkflow}
                getTestStatus={state.getTestStatus}
                getTestStatusIcon={state.getTestStatusIcon}
                getSuiteStatus={state.getSuiteStatus}
              />
            </div>

            {/* Center Column - Test Details (50%) */}
            <div className="w-1/2 flex flex-col">
              <ScrollArea className="h-full">
                {state.selectedTestCase ? (
                  <TestCaseDetails
                    testCase={state.selectedTestCase}
                    results={
                      state.testResults.get(state.selectedTestCase.id) || []
                    }
                    onRun={handleRunTest}
                    onEdit={state.setEditingTest}
                    onDuplicate={handleDuplicateTest}
                    onDelete={handleDeleteTest}
                    isRunning={
                      state.execution.isRunning &&
                      state.execution.currentTest ===
                        state.selectedTestCase.name
                    }
                  />
                ) : state.selectedSuite ? (
                  <TestSuiteDetails
                    suite={state.selectedSuite}
                    testCases={state.testCases.filter((tc) =>
                      state.selectedSuite!.testCaseIds.includes(tc.id)
                    )}
                    onRun={handleRunSuite}
                    onEdit={() => state.setEditingSuite(state.selectedSuite)}
                    isRunning={
                      state.execution.isRunning &&
                      state.execution.currentTest === state.selectedSuite.name
                    }
                  />
                ) : state.selectedWorkflow ? (
                  <WorkflowTestDetails
                    workflow={state.selectedWorkflow}
                    testCases={state.testCases.filter(
                      (tc) => tc.workflowId === state.selectedWorkflow!.id
                    )}
                    coverage={state.coverage.get(state.selectedWorkflow.id)}
                  />
                ) : (
                  <GettingStarted
                    onCreateTest={() => state.setShowCreateTest(true)}
                  />
                )}
              </ScrollArea>
            </div>

            {/* Right Sidebar - Test Results (30%) */}
            <div className="w-[30%] flex flex-col">
              <TestResultsView
                selectedTestCase={state.selectedTestCase}
                selectedSuite={state.selectedSuite}
                testCases={state.testCases}
                testResults={state.testResults}
                executionResults={state.execution.results}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      <TestCaseEditorDialog
        showCreateTest={state.showCreateTest}
        editingTest={state.editingTest}
        showCreateSuite={state.showCreateSuite}
        editingSuite={state.editingSuite}
        showImportDialog={state.showImportDialog}
        workflows={state.workflows}
        testCases={state.testCases}
        onCreateTest={handleCreateTest}
        onUpdateTest={handleUpdateTest}
        onCreateSuite={handleCreateSuite}
        onUpdateSuite={handleUpdateSuite}
        onImportTests={handleImportTests}
        onCloseCreateTest={() => state.setShowCreateTest(false)}
        onCloseEditTest={() => state.setEditingTest(null)}
        onCloseCreateSuite={() => state.setShowCreateSuite(false)}
        onCloseEditSuite={() => state.setEditingSuite(null)}
        onCloseImport={() => state.setShowImportDialog(false)}
      />
    </div>
  );
}

// ============================================================================
// Header Sub-component
// ============================================================================

interface TestingHeaderProps {
  stats: {
    totalTestCases: number;
    totalTestSuites: number;
    passRate: number;
    testsRunToday: number;
    failedTestsCount: number;
  };
  execution: { isRunning: boolean };
  testCasesCount: number;
  onCreateTest: () => void;
  onCreateSuite: () => void;
  onRunAllTests: () => void;
  onExport: () => void;
  onImport: () => void;
}

function TestingHeader({
  stats,
  execution,
  testCasesCount,
  onCreateTest,
  onCreateSuite,
  onRunAllTests,
  onExport,
  onImport,
}: TestingHeaderProps) {
  return (
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
            <Button onClick={onCreateTest} variant="outline" size="sm">
              <Plus className="size-4" />
              New Test Case
            </Button>
            <Button onClick={onCreateSuite} variant="outline" size="sm">
              <Plus className="size-4" />
              New Suite
            </Button>
            <Button
              onClick={onRunAllTests}
              variant="default"
              size="sm"
              disabled={execution.isRunning || testCasesCount === 0}
            >
              {execution.isRunning ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              Run All Tests
            </Button>
            <Button onClick={onExport} variant="outline" size="sm">
              <Download className="size-4" />
              Export
            </Button>
            <Button onClick={onImport} variant="outline" size="sm">
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
                  <p className="text-2xl font-bold">{stats.totalTestCases}</p>
                  <p className="text-xs text-muted-foreground">Test Cases</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <FolderOpen className="size-8 text-purple-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.totalTestSuites}</p>
                  <p className="text-xs text-muted-foreground">Test Suites</p>
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
                  <p className="text-xs text-muted-foreground">Pass Rate</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Clock className="size-8 text-orange-500" />
                <div>
                  <p className="text-2xl font-bold">{stats.testsRunToday}</p>
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
                  <p className="text-2xl font-bold">{stats.failedTestsCount}</p>
                  <p className="text-xs text-muted-foreground">Failed Tests</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Navigator Sub-component
// ============================================================================

interface TestNavigatorProps {
  navigatorTab: string;
  setNavigatorTab: (tab: NavigatorTab) => void;
  testSuites: TestSuite[];
  filteredTestCases: TestCase[];
  workflows: Workflow[];
  testCases: TestCase[];
  selectedSuite: TestSuite | null;
  selectedTestCase: TestCase | null;
  selectedWorkflow: Workflow | null;
  searchQuery: string;
  filterStatus: FilterStatus;
  setSearchQuery: (q: string) => void;
  setFilterStatus: (f: FilterStatus) => void;
  setSelectedSuite: (s: TestSuite | null) => void;
  setSelectedTestCase: (t: TestCase | null) => void;
  setSelectedWorkflow: (w: Workflow | null) => void;
  getTestStatus: (testId: string) => "passed" | "failed" | "not-run";
  getTestStatusIcon: (
    status: "passed" | "failed" | "not-run"
  ) => React.ReactNode;
  getSuiteStatus: (
    suite: TestSuite
  ) => "passed" | "failed" | "partial" | "not-run";
}

function TestNavigator({
  navigatorTab,
  setNavigatorTab,
  testSuites,
  filteredTestCases,
  workflows,
  testCases,
  selectedSuite,
  selectedTestCase,
  selectedWorkflow,
  searchQuery,
  filterStatus,
  setSearchQuery,
  setFilterStatus,
  setSelectedSuite,
  setSelectedTestCase,
  setSelectedWorkflow,
  getTestStatus,
  getTestStatusIcon,
  getSuiteStatus,
}: TestNavigatorProps) {
  return (
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

        <TabsContent value="suites" className="flex-1 mt-0 px-6 pb-6">
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
                      <span className="truncate flex-1">{suite.name}</span>
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

        <TabsContent value="cases" className="flex-1 mt-0 px-6 pb-6">
          <div className="space-y-3 mb-3">
            <Input
              placeholder="Search tests..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8"
            />
            <Select
              value={filterStatus}
              onValueChange={(v) => setFilterStatus(v as FilterStatus)}
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
                      <span className="truncate flex-1">{testCase.name}</span>
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

        <TabsContent value="workflows" className="flex-1 mt-0 px-6 pb-6">
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
                      <span className="truncate flex-1">{workflow.name}</span>
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
  );
}
