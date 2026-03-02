import type { TestSuite, TestCase } from "@/services/workflow-testing-service";
import type { Workflow } from "@/lib/action-schema/action-types";

export interface TestSuiteManagerProps {
  workflows: Workflow[];
  testSuites: TestSuite[];
  testCases: TestCase[];
  onCreateSuite: (suite: TestSuite) => void;
  onUpdateSuite: (id: string, updates: Partial<TestSuite>) => void;
  onDeleteSuite: (id: string) => void;
  onRunSuite: (id: string) => void;
  className?: string;
}

export interface SuiteStatistics {
  totalTests: number;
  passRate: number;
  lastRun?: string;
}

export interface SuiteEditorDialogProps {
  suite?: TestSuite | null;
  testCases: TestCase[];
  workflows: Workflow[];
  onSave: (suite: Partial<TestSuite>) => void;
  onCancel: () => void;
}
