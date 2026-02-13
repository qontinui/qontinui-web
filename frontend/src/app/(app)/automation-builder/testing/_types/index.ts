import type { TestResult } from "@/services/workflow-testing";

export type NavigatorTab = "suites" | "cases" | "workflows";
export type FilterStatus = "all" | "passed" | "failed" | "not-run";
export type SortBy = "name" | "status" | "last-run" | "duration";

export interface TestExecutionState {
  isRunning: boolean;
  currentTest?: string;
  progress: number;
  totalTests: number;
  completedTests: number;
  results: TestResult[];
}
