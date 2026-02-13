/**
 * Workflow Testing Module
 *
 * Testing framework for workflows including test cases, suites,
 * execution, assertions, coverage analysis, and persistence.
 */

// Types
export type {
  AssertionType,
  Assertion,
  TestCaseConfig,
  TestCase,
  TestSuite,
  AssertionResult,
  TestResult,
  TestStatistics,
  ActionCoverage,
  PathCoverage,
  WorkflowCoverage,
  CoverageReport,
} from "./types";

// Service
export {
  WorkflowTestingService,
  getWorkflowTestingService,
  resetWorkflowTestingService,
} from "./service";
