import * as React from "react";
import type {
  TestCase,
  getWorkflowTestingService,
} from "@/services/workflow-testing";

interface UseTestCaseHandlersParams {
  testingService: ReturnType<typeof getWorkflowTestingService>;
  loadData: () => void;
  selectedTestCase: TestCase | null;
  setSelectedTestCase: React.Dispatch<React.SetStateAction<TestCase | null>>;
  setShowCreateTest: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingTest: React.Dispatch<React.SetStateAction<TestCase | null>>;
}

export function useTestCaseHandlers({
  testingService,
  loadData,
  selectedTestCase,
  setSelectedTestCase,
  setShowCreateTest,
  setEditingTest,
}: UseTestCaseHandlersParams) {
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
    [testingService, loadData, setShowCreateTest, setEditingTest]
  );

  const handleUpdateTest = React.useCallback(
    (testCase: TestCase) => {
      testingService.updateTestCase(testCase.id, testCase);
      loadData();
      setEditingTest(null);
    },
    [testingService, loadData, setEditingTest]
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
    [testingService, loadData, selectedTestCase, setSelectedTestCase]
  );

  const handleDuplicateTest = React.useCallback(
    (testId: string) => {
      testingService.duplicateTestCase(testId);
      loadData();
    },
    [testingService, loadData]
  );

  return {
    handleCreateTest,
    handleUpdateTest,
    handleDeleteTest,
    handleDuplicateTest,
  };
}
