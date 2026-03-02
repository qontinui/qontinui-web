import * as React from "react";
import type { TestSuite, TestCase } from "@/services/workflow-testing-service";
import type { SuiteStatistics } from "../test-suite-manager-types";

export function useTestSuiteManager(
  testSuites: TestSuite[],
  testCases: TestCase[],
  onDeleteSuite: (id: string) => void,
  onRunSuite: (id: string) => void
) {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [filterTags, setFilterTags] = React.useState<string[]>([]);
  const [selectedSuite, setSelectedSuite] = React.useState<TestSuite | null>(
    null
  );
  const [isCreating, setIsCreating] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [runningSuites, setRunningSuites] = React.useState<Set<string>>(
    new Set()
  );

  const allTags = React.useMemo(() => {
    const tags = new Set<string>();
    testSuites.forEach((suite) => {
      suite.tags?.forEach((tag) => tags.add(tag));
    });
    return Array.from(tags);
  }, [testSuites]);

  const filteredSuites = React.useMemo(() => {
    return testSuites.filter((suite) => {
      // Search filter
      const matchesSearch =
        !searchQuery ||
        suite.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        suite.description?.toLowerCase().includes(searchQuery.toLowerCase());

      // Tag filter
      const matchesTags =
        filterTags.length === 0 ||
        filterTags.some((tag) => suite.tags?.includes(tag));

      return matchesSearch && matchesTags;
    });
  }, [testSuites, searchQuery, filterTags]);

  const getSuiteStatistics = React.useCallback(
    (suite: TestSuite): SuiteStatistics => {
      const suiteTestCases = testCases.filter((tc) =>
        suite.testCaseIds.includes(tc.id)
      );

      // Calculate actual pass rate from test results
      let passedCount = 0;
      let totalWithResults = 0;

      suiteTestCases.forEach((testCase) => {
        // Get the most recent test result for each test case
        const testResults = testCase.metadata?.testResults as
          | unknown[]
          | undefined;
        if (testResults && testResults.length > 0) {
          const latestResult = testResults[0] as { passed?: boolean }; // Results are stored most recent first
          totalWithResults++;
          if (latestResult.passed) {
            passedCount++;
          }
        }
      });

      // Calculate pass rate (0 if no test results exist)
      const passRate =
        totalWithResults > 0 ? (passedCount / totalWithResults) * 100 : 0;

      return {
        totalTests: suiteTestCases.length,
        passRate,
        lastRun: suite.metadata?.lastRun
          ? String(suite.metadata.lastRun)
          : undefined,
      };
    },
    [testCases]
  );

  const handleCreateSuite = React.useCallback(() => {
    setIsCreating(true);
  }, []);

  const handleEditSuite = React.useCallback((suite: TestSuite) => {
    setSelectedSuite(suite);
    setIsEditing(true);
  }, []);

  const handleDeleteSuite = React.useCallback(
    (suiteId: string) => {
      if (confirm("Are you sure you want to delete this test suite?")) {
        onDeleteSuite(suiteId);
      }
    },
    [onDeleteSuite]
  );

  const handleRunSuite = React.useCallback(
    (suiteId: string) => {
      setRunningSuites((prev) => new Set(prev).add(suiteId));
      onRunSuite(suiteId);
      // Simulate completion after 2 seconds
      setTimeout(() => {
        setRunningSuites((prev) => {
          const next = new Set(prev);
          next.delete(suiteId);
          return next;
        });
      }, 2000);
    },
    [onRunSuite]
  );

  const toggleFilterTag = React.useCallback((tag: string) => {
    setFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }, []);

  const closeDialog = React.useCallback(() => {
    setIsCreating(false);
    setIsEditing(false);
    setSelectedSuite(null);
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    filterTags,
    selectedSuite,
    isCreating,
    isEditing,
    runningSuites,
    allTags,
    filteredSuites,
    getSuiteStatistics,
    handleCreateSuite,
    handleEditSuite,
    handleDeleteSuite,
    handleRunSuite,
    toggleFilterTag,
    closeDialog,
  };
}
