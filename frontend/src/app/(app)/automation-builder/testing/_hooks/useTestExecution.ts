import * as React from "react";
import type {
  TestCase,
  TestResult,
  TestSuite,
  getWorkflowTestingService,
} from "@/services/workflow-testing";
import type { Workflow } from "@/lib/action-schema/action-types";
import type { TestExecutionState } from "../_types";
import { createLogger } from "@/lib/logger";
const logger = createLogger("UseTestExecution");

interface UseTestExecutionParams {
  testCases: TestCase[];
  testSuites: TestSuite[];
  workflows: Workflow[];
  testingService: ReturnType<typeof getWorkflowTestingService>;
  loadData: () => void;
  selectedTests: Set<string>;
  setExecution: React.Dispatch<React.SetStateAction<TestExecutionState>>;
}

export function useTestExecution({
  testCases,
  testSuites,
  workflows,
  testingService,
  loadData,
  selectedTests,
  setExecution,
}: UseTestExecutionParams) {
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
        logger.error("Test execution failed:", error);
        setExecution({
          isRunning: false,
          progress: 0,
          totalTests: 1,
          completedTests: 0,
          results: [],
        });
      }
    },
    [testCases, workflows, testingService, loadData, setExecution]
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
        logger.error("Suite execution failed:", error);
        setExecution({
          isRunning: false,
          progress: 0,
          totalTests: suite.testCaseIds.length,
          completedTests: 0,
          results: [],
        });
      }
    },
    [testSuites, workflows, testingService, loadData, setExecution]
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
      logger.error("Test execution failed:", error);
      setExecution({
        isRunning: false,
        progress: 0,
        totalTests: enabledTests.length,
        completedTests: 0,
        results: [],
      });
    }
  }, [testCases, workflows, testingService, loadData, setExecution]);

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
        logger.error("Test failed:", error);
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
  }, [
    selectedTests,
    testCases,
    workflows,
    testingService,
    loadData,
    setExecution,
  ]);

  return {
    handleRunTest,
    handleRunSuite,
    handleRunAllTests,
    handleRunSelected,
  };
}
