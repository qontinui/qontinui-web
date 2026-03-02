import type { TestSuite, TestCase } from "@/services/workflow-testing-service";

export interface TestSuiteEditorProps {
  suite?: TestSuite;
  availableTestCases: TestCase[];
  onSave: (suite: TestSuite) => void;
  onCancel: () => void;
  className?: string;
}

export interface TestSuiteValidationErrors {
  name?: string;
  testCases?: string;
  [key: string]: string | undefined;
}
