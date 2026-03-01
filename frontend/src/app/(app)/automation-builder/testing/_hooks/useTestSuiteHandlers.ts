import * as React from "react";
import type {
  TestSuite,
  getWorkflowTestingService,
} from "@/services/workflow-testing";

interface UseTestSuiteHandlersParams {
  testingService: ReturnType<typeof getWorkflowTestingService>;
  loadData: () => void;
  setShowCreateSuite: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingSuite: React.Dispatch<React.SetStateAction<TestSuite | null>>;
}

export function useTestSuiteHandlers({
  testingService,
  loadData,
  setShowCreateSuite,
  setEditingSuite,
}: UseTestSuiteHandlersParams) {
  const handleCreateSuite = React.useCallback(
    (suite: TestSuite) => {
      testingService.createTestSuite(
        suite.name,
        suite.description,
        suite.testCaseIds
      );
      // Update the suite with additional properties
      testingService.updateTestSuite(suite.id, {
        executionOrder: suite.executionOrder,
        stopOnFailure: suite.stopOnFailure,
        tags: suite.tags,
      });
      loadData();
      setShowCreateSuite(false);
    },
    [testingService, loadData, setShowCreateSuite]
  );

  const handleUpdateSuite = React.useCallback(
    (suite: TestSuite) => {
      testingService.updateTestSuite(suite.id, {
        name: suite.name,
        description: suite.description,
        testCaseIds: suite.testCaseIds,
        executionOrder: suite.executionOrder,
        stopOnFailure: suite.stopOnFailure,
        tags: suite.tags,
      });
      loadData();
      setEditingSuite(null);
    },
    [testingService, loadData, setEditingSuite]
  );

  return {
    handleCreateSuite,
    handleUpdateSuite,
  };
}
