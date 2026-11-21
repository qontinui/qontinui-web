import * as React from "react";
import {
  getWorkflowTestingService,
  type TestCase,
  type TestSuite,
} from "@/services/workflow-testing";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { NavigatorTab } from "../_types";

/**
 * State for the Workflow Testing page: test-case and suite authoring.
 *
 * The page authors test cases and suites; it does not run them. The former
 * in-browser runner was a simulator (random delay, mock variables, an
 * always-met expected behavior), so no pass/fail verdict, pass rate or
 * coverage is rendered here — nothing observed one.
 */
export function useTestingState() {
  const testingService = React.useMemo(() => getWorkflowTestingService(), []);

  // ========================================================================
  // State - Data
  // ========================================================================

  const [testCases, setTestCases] = React.useState<TestCase[]>([]);
  const [testSuites, setTestSuites] = React.useState<TestSuite[]>([]);
  const [workflows, setWorkflows] = React.useState<Workflow[]>([]);

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
  // Load Data
  // ========================================================================

  const loadData = React.useCallback(() => {
    setTestCases(testingService.getAllTestCases());
    setTestSuites(testingService.getAllTestSuites());

    // Load mock workflows (in real app, fetch from API)
    setWorkflows([]);
  }, [testingService]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  // ========================================================================
  // Computed Values
  // ========================================================================

  const stats = React.useMemo(
    () => ({
      totalTestCases: testCases.length,
      totalTestSuites: testSuites.length,
    }),
    [testCases, testSuites]
  );

  const filteredTestCases = React.useMemo(() => {
    const query = searchQuery.toLowerCase();
    const filtered = query
      ? testCases.filter(
          (tc) =>
            tc.name.toLowerCase().includes(query) ||
            tc.description?.toLowerCase().includes(query)
        )
      : [...testCases];

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [testCases, searchQuery]);

  return {
    // Service
    testingService,
    // Data
    testCases,
    testSuites,
    workflows,
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
    // Computed
    stats,
    filteredTestCases,
    // Data loading
    loadData,
  };
}
