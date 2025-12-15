/**
 * Workflow Testing Framework Service
 *
 * Provides comprehensive testing capabilities for workflows including:
 * - Test case and suite management
 * - Test execution (mock for now, designed for real execution later)
 * - Assertion evaluation
 * - Test result tracking and history
 * - Coverage analysis
 * - Persistence via localStorage
 * - Import/Export functionality
 */

import type {
  Workflow,
  Action,
  ActionType,
} from "@/lib/action-schema/action-types";

// ============================================================================
// Test Case Types
// ============================================================================

export type AssertionType =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "exists"
  | "notExists"
  | "greaterThan"
  | "lessThan"
  | "regex"
  | "custom";

export interface Assertion {
  /** Unique assertion ID */
  id: string;

  /** Type of assertion */
  type: AssertionType;

  /** Description of what is being asserted */
  description?: string;

  /** Path to the value being tested (e.g., 'variables.username') */
  path?: string;

  /** Expected value for comparison assertions */
  expected?: unknown;

  /** Regex pattern for regex assertions */
  pattern?: string;

  /** Custom function as string for custom assertions */
  customFunction?: string;
}

export interface TestCaseConfig {
  /** Input variables for the workflow */
  inputs?: Record<string, unknown>;

  /** Initial state setup */
  initialState?: {
    variables?: Record<string, unknown>;
    screenshots?: string[];
    activeStates?: string[];
  };

  /** Assertions to evaluate after execution */
  assertions: Assertion[];

  /** Expected execution behavior */
  expected?: {
    /** Should the workflow succeed? */
    shouldSucceed?: boolean;

    /** Expected final action reached */
    finalActionId?: string;

    /** Expected path of action IDs */
    actionPath?: string[];

    /** Maximum execution time in milliseconds */
    maxDuration?: number;
  };

  /** Timeout for test execution in milliseconds */
  timeout?: number;

  /** Tags for categorization */
  tags?: string[];
}

export interface TestCase {
  /** Unique test case ID */
  id: string;

  /** Human-readable test name */
  name: string;

  /** Description of what this test validates */
  description?: string;

  /** Workflow ID being tested */
  workflowId: string;

  /** Test configuration */
  config: TestCaseConfig;

  /** Metadata */
  metadata?: {
    created?: string;
    updated?: string;
    author?: string;
    lastRun?: string;
    [key: string]: unknown;
  };

  /** Enabled/disabled status */
  enabled?: boolean;
}

// ============================================================================
// Test Suite Types
// ============================================================================

export interface TestSuite {
  /** Unique suite ID */
  id: string;

  /** Suite name */
  name: string;

  /** Suite description */
  description?: string;

  /** Test case IDs in this suite */
  testCaseIds: string[];

  /** Execution order preference */
  executionOrder?: "parallel" | "sequential";

  /** Stop on first failure */
  stopOnFailure?: boolean;

  /** Metadata */
  metadata?: {
    created?: string;
    updated?: string;
    author?: string;
    [key: string]: unknown;
  };

  /** Tags for categorization */
  tags?: string[];
}

// ============================================================================
// Test Result Types
// ============================================================================

export interface AssertionResult {
  /** Assertion that was evaluated */
  assertion: Assertion;

  /** Did the assertion pass? */
  passed: boolean;

  /** Actual value found */
  actualValue?: unknown;

  /** Error message if failed */
  error?: string;
}

export interface TestResult {
  /** Unique result ID */
  id: string;

  /** Test case that was executed */
  testCaseId: string;

  /** Test case name (cached for convenience) */
  testCaseName: string;

  /** Workflow ID */
  workflowId: string;

  /** Workflow name (cached for convenience) */
  workflowName?: string;

  /** Did the test pass? */
  passed: boolean;

  /** Execution start time */
  startTime: string;

  /** Execution end time */
  endTime: string;

  /** Duration in milliseconds */
  duration: number;

  /** Assertion results */
  assertions: AssertionResult[];

  /** Execution path taken (action IDs) */
  executionPath?: string[];

  /** Final workflow state */
  finalState?: {
    variables?: Record<string, unknown>;
    activeStates?: string[];
  };

  /** Actions that were executed */
  actionsExecuted?: number;

  /** Actions that succeeded */
  actionsSucceeded?: number;

  /** Error message if test failed */
  error?: string;

  /** Additional execution details */
  details?: unknown;
}

export interface TestStatistics {
  /** Test case ID */
  testCaseId: string;

  /** Total runs */
  totalRuns: number;

  /** Successful runs */
  successfulRuns: number;

  /** Failed runs */
  failedRuns: number;

  /** Pass rate percentage */
  passRate: number;

  /** Average duration in milliseconds */
  avgDuration: number;

  /** Minimum duration */
  minDuration: number;

  /** Maximum duration */
  maxDuration: number;

  /** Last run timestamp */
  lastRun?: string;

  /** Last result */
  lastPassed?: boolean;
}

// ============================================================================
// Coverage Types
// ============================================================================

export interface ActionCoverage {
  /** Action ID */
  actionId: string;

  /** Action type */
  actionType: ActionType;

  /** Action name */
  actionName?: string;

  /** Is this action covered by tests? */
  covered: boolean;

  /** Test cases that cover this action */
  coveredByTests: string[];

  /** Number of times tested */
  testCount: number;
}

export interface PathCoverage {
  /** Path as array of action IDs */
  path: string[];

  /** Is this path covered? */
  covered: boolean;

  /** Test cases that cover this path */
  coveredByTests: string[];
}

export interface WorkflowCoverage {
  /** Workflow ID */
  workflowId: string;

  /** Workflow name */
  workflowName: string;

  /** Overall coverage percentage */
  coveragePercentage: number;

  /** Total actions in workflow */
  totalActions: number;

  /** Actions covered by tests */
  coveredActions: number;

  /** Action-level coverage details */
  actions: ActionCoverage[];

  /** Path-level coverage */
  paths?: PathCoverage[];

  /** Untested actions */
  untestedActions: string[];

  /** Test cases for this workflow */
  testCases: string[];
}

export interface CoverageReport {
  /** Report generation timestamp */
  timestamp: string;

  /** Coverage by workflow */
  workflows: WorkflowCoverage[];

  /** Overall coverage percentage */
  overallCoverage: number;

  /** Total workflows analyzed */
  totalWorkflows: number;

  /** Summary statistics */
  summary: {
    totalActions: number;
    coveredActions: number;
    totalTestCases: number;
    totalTestSuites: number;
  };
}

// ============================================================================
// Storage Keys
// ============================================================================

const STORAGE_KEYS = {
  TEST_CASES: "workflow-test-cases",
  TEST_SUITES: "workflow-test-suites",
  TEST_RESULTS: "workflow-test-results",
} as const;

// ============================================================================
// WorkflowTestingService Class
// ============================================================================

export class WorkflowTestingService {
  private testCases: Map<string, TestCase> = new Map();
  private testSuites: Map<string, TestSuite> = new Map();
  private testResults: Map<string, TestResult[]> = new Map();
  private runningTests: Map<string, AbortController> = new Map();

  constructor() {
    this.loadFromStorage();
  }

  // ==========================================================================
  // Test Case Management
  // ==========================================================================

  /**
   * Create a new test case
   */
  createTestCase(
    workflowId: string,
    config: TestCaseConfig,
    options?: {
      name?: string;
      description?: string;
      enabled?: boolean;
    }
  ): TestCase {
    const testCase: TestCase = {
      id: this.generateId("test"),
      name: options?.name || `Test Case ${this.testCases.size + 1}`,
      description: options?.description,
      workflowId,
      config,
      enabled: options?.enabled !== false,
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.testCases.set(testCase.id, testCase);
    this.saveToStorage();
    return testCase;
  }

  /**
   * Update an existing test case
   */
  updateTestCase(
    testId: string,
    updates: Partial<Omit<TestCase, "id">>
  ): TestCase {
    const testCase = this.testCases.get(testId);
    if (!testCase) {
      throw new Error(`Test case not found: ${testId}`);
    }

    const updated: TestCase = {
      ...testCase,
      ...updates,
      id: testCase.id, // Ensure ID doesn't change
      metadata: {
        ...testCase.metadata,
        ...updates.metadata,
        updated: new Date().toISOString(),
      },
    };

    this.testCases.set(testId, updated);
    this.saveToStorage();
    return updated;
  }

  /**
   * Delete a test case
   */
  deleteTestCase(testId: string): boolean {
    if (!this.testCases.has(testId)) {
      return false;
    }

    // Remove from all test suites
    this.testSuites.forEach((suite) => {
      if (suite.testCaseIds.includes(testId)) {
        this.removeTestFromSuite(suite.id, testId);
      }
    });

    // Delete test results
    this.testResults.delete(testId);

    // Delete test case
    this.testCases.delete(testId);
    this.saveToStorage();
    return true;
  }

  /**
   * Get a test case by ID
   */
  getTestCase(testId: string): TestCase | undefined {
    return this.testCases.get(testId);
  }

  /**
   * Get all test cases for a workflow
   */
  getTestCasesForWorkflow(workflowId: string): TestCase[] {
    return Array.from(this.testCases.values()).filter(
      (test) => test.workflowId === workflowId
    );
  }

  /**
   * Get all test cases
   */
  getAllTestCases(): TestCase[] {
    return Array.from(this.testCases.values());
  }

  /**
   * Duplicate a test case
   */
  duplicateTestCase(
    testId: string,
    options?: {
      name?: string;
    }
  ): TestCase {
    const original = this.testCases.get(testId);
    if (!original) {
      throw new Error(`Test case not found: ${testId}`);
    }

    const duplicate: TestCase = {
      ...original,
      id: this.generateId("test"),
      name: options?.name || `${original.name} (Copy)`,
      metadata: {
        ...original.metadata,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.testCases.set(duplicate.id, duplicate);
    this.saveToStorage();
    return duplicate;
  }

  // ==========================================================================
  // Test Suite Management
  // ==========================================================================

  /**
   * Create a new test suite
   */
  createTestSuite(
    name: string,
    description?: string,
    testCaseIds: string[] = []
  ): TestSuite {
    const suite: TestSuite = {
      id: this.generateId("suite"),
      name,
      description,
      testCaseIds,
      executionOrder: "sequential",
      stopOnFailure: false,
      metadata: {
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    };

    this.testSuites.set(suite.id, suite);
    this.saveToStorage();
    return suite;
  }

  /**
   * Update a test suite
   */
  updateTestSuite(
    suiteId: string,
    updates: Partial<Omit<TestSuite, "id">>
  ): TestSuite {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    const updated: TestSuite = {
      ...suite,
      ...updates,
      id: suite.id,
      metadata: {
        ...suite.metadata,
        ...updates.metadata,
        updated: new Date().toISOString(),
      },
    };

    this.testSuites.set(suiteId, updated);
    this.saveToStorage();
    return updated;
  }

  /**
   * Delete a test suite
   */
  deleteTestSuite(suiteId: string): boolean {
    if (!this.testSuites.has(suiteId)) {
      return false;
    }

    this.testSuites.delete(suiteId);
    this.saveToStorage();
    return true;
  }

  /**
   * Get a test suite by ID
   */
  getTestSuite(suiteId: string): TestSuite | undefined {
    return this.testSuites.get(suiteId);
  }

  /**
   * Get all test suites
   */
  getAllTestSuites(): TestSuite[] {
    return Array.from(this.testSuites.values());
  }

  /**
   * Add a test case to a suite
   */
  addTestToSuite(suiteId: string, testCaseId: string): TestSuite {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    if (!this.testCases.has(testCaseId)) {
      throw new Error(`Test case not found: ${testCaseId}`);
    }

    if (suite.testCaseIds.includes(testCaseId)) {
      return suite; // Already in suite
    }

    return this.updateTestSuite(suiteId, {
      testCaseIds: [...suite.testCaseIds, testCaseId],
    });
  }

  /**
   * Remove a test case from a suite
   */
  removeTestFromSuite(suiteId: string, testCaseId: string): TestSuite {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    return this.updateTestSuite(suiteId, {
      testCaseIds: suite.testCaseIds.filter((id) => id !== testCaseId),
    });
  }

  // ==========================================================================
  // Test Execution (Mock Implementation)
  // ==========================================================================

  /**
   * Run a single test case
   * NOTE: This is a mock implementation. Real execution will be added later.
   */
  async runTestCase(testId: string, workflow?: Workflow): Promise<TestResult> {
    const testCase = this.testCases.get(testId);
    if (!testCase) {
      throw new Error(`Test case not found: ${testId}`);
    }

    if (!testCase.enabled) {
      throw new Error(`Test case is disabled: ${testId}`);
    }

    const startTime = new Date().toISOString();
    const abortController = new AbortController();
    this.runningTests.set(testId, abortController);

    try {
      // Mock execution delay
      await this.delay(100 + Math.random() * 500);

      // Check if aborted
      if (abortController.signal.aborted) {
        throw new Error("Test execution was stopped");
      }

      // Mock execution results
      const mockExecutionPath =
        workflow?.actions.slice(0, 3).map((a) => a.id) || [];
      const mockVariables = {
        ...testCase.config.inputs,
        result: "mock_result",
      };

      // Evaluate assertions
      const assertionResults = testCase.config.assertions.map((assertion) =>
        this.evaluateAssertion(assertion, mockVariables)
      );

      const endTime = new Date().toISOString();
      const duration =
        new Date(endTime).getTime() - new Date(startTime).getTime();

      // Determine if test passed
      const allAssertionsPassed = assertionResults.every((r) => r.passed);
      const expectedBehaviorMet = true; // Mock: always meets expected behavior

      const result: TestResult = {
        id: this.generateId("result"),
        testCaseId: testId,
        testCaseName: testCase.name,
        workflowId: testCase.workflowId,
        workflowName: workflow?.name,
        passed: allAssertionsPassed && expectedBehaviorMet,
        startTime,
        endTime,
        duration,
        assertions: assertionResults,
        executionPath: mockExecutionPath,
        finalState: {
          variables: mockVariables,
          activeStates: testCase.config.initialState?.activeStates || [],
        },
        actionsExecuted: mockExecutionPath.length,
        actionsSucceeded: mockExecutionPath.length,
      };

      // Save result
      this.saveTestResult(result);

      // Update test case metadata
      this.updateTestCase(testId, {
        metadata: {
          ...testCase.metadata,
          lastRun: endTime,
        },
      });

      return result;
    } catch (error) {
      const endTime = new Date().toISOString();
      const duration =
        new Date(endTime).getTime() - new Date(startTime).getTime();

      const result: TestResult = {
        id: this.generateId("result"),
        testCaseId: testId,
        testCaseName: testCase.name,
        workflowId: testCase.workflowId,
        workflowName: workflow?.name,
        passed: false,
        startTime,
        endTime,
        duration,
        assertions: [],
        error: error instanceof Error ? error.message : "Unknown error",
      };

      this.saveTestResult(result);
      return result;
    } finally {
      this.runningTests.delete(testId);
    }
  }

  /**
   * Run a test suite
   */
  async runTestSuite(
    suiteId: string,
    workflows?: Map<string, Workflow>
  ): Promise<TestResult[]> {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    const results: TestResult[] = [];

    if (suite.executionOrder === "parallel") {
      // Run all tests in parallel
      const promises = suite.testCaseIds.map((testId) => {
        const testCase = this.testCases.get(testId);
        const workflow = testCase
          ? workflows?.get(testCase.workflowId)
          : undefined;
        return this.runTestCase(testId, workflow);
      });
      results.push(...(await Promise.all(promises)));
    } else {
      // Run tests sequentially
      for (const testId of suite.testCaseIds) {
        const testCase = this.testCases.get(testId);
        const workflow = testCase
          ? workflows?.get(testCase.workflowId)
          : undefined;
        const result = await this.runTestCase(testId, workflow);
        results.push(result);

        // Stop on failure if configured
        if (!result.passed && suite.stopOnFailure) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Run all test cases
   */
  async runAllTests(workflows?: Map<string, Workflow>): Promise<TestResult[]> {
    const allTestIds = Array.from(this.testCases.keys());
    const results: TestResult[] = [];

    for (const testId of allTestIds) {
      const testCase = this.testCases.get(testId);
      if (testCase?.enabled) {
        const workflow = workflows?.get(testCase.workflowId);
        const result = await this.runTestCase(testId, workflow);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Run all test cases for a specific workflow
   */
  async runTestsForWorkflow(
    workflowId: string,
    workflow?: Workflow
  ): Promise<TestResult[]> {
    const testCases = this.getTestCasesForWorkflow(workflowId);
    const results: TestResult[] = [];

    for (const testCase of testCases) {
      if (testCase.enabled) {
        const result = await this.runTestCase(testCase.id, workflow);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Stop a running test
   */
  stopTestExecution(testId: string): boolean {
    const controller = this.runningTests.get(testId);
    if (controller) {
      controller.abort();
      this.runningTests.delete(testId);
      return true;
    }
    return false;
  }

  /**
   * Check if a test is currently running
   */
  isTestRunning(testId: string): boolean {
    return this.runningTests.has(testId);
  }

  // ==========================================================================
  // Assertions
  // ==========================================================================

  /**
   * Evaluate an assertion against an actual value
   */
  evaluateAssertion(assertion: Assertion, context: unknown): AssertionResult {
    try {
      // Get the actual value from the context using the path
      const actualValue = assertion.path
        ? this.getValueByPath(context, assertion.path)
        : context;

      let passed = false;
      let error: string | undefined;

      switch (assertion.type) {
        case "equals":
          passed = this.deepEquals(actualValue, assertion.expected);
          if (!passed) {
            error = `Expected ${JSON.stringify(assertion.expected)}, got ${JSON.stringify(actualValue)}`;
          }
          break;

        case "notEquals":
          passed = !this.deepEquals(actualValue, assertion.expected);
          if (!passed) {
            error = `Expected value not to equal ${JSON.stringify(assertion.expected)}`;
          }
          break;

        case "contains":
          if (Array.isArray(actualValue)) {
            passed = actualValue.includes(assertion.expected);
          } else if (typeof actualValue === "string") {
            passed = actualValue.includes(assertion.expected);
          } else if (typeof actualValue === "object" && actualValue !== null) {
            passed = assertion.expected in actualValue;
          }
          if (!passed) {
            error = `Expected to contain ${JSON.stringify(assertion.expected)}`;
          }
          break;

        case "notContains":
          if (Array.isArray(actualValue)) {
            passed = !actualValue.includes(assertion.expected);
          } else if (typeof actualValue === "string") {
            passed = !actualValue.includes(assertion.expected);
          } else if (typeof actualValue === "object" && actualValue !== null) {
            passed = !(assertion.expected in actualValue);
          }
          if (!passed) {
            error = `Expected not to contain ${JSON.stringify(assertion.expected)}`;
          }
          break;

        case "exists":
          passed = actualValue !== undefined && actualValue !== null;
          if (!passed) {
            error = "Expected value to exist";
          }
          break;

        case "notExists":
          passed = actualValue === undefined || actualValue === null;
          if (!passed) {
            error = "Expected value not to exist";
          }
          break;

        case "greaterThan":
          passed =
            typeof actualValue === "number" && actualValue > assertion.expected;
          if (!passed) {
            error = `Expected ${actualValue} to be greater than ${assertion.expected}`;
          }
          break;

        case "lessThan":
          passed =
            typeof actualValue === "number" && actualValue < assertion.expected;
          if (!passed) {
            error = `Expected ${actualValue} to be less than ${assertion.expected}`;
          }
          break;

        case "regex":
          if (assertion.pattern) {
            const regex = new RegExp(assertion.pattern);
            passed = regex.test(String(actualValue));
            if (!passed) {
              error = `Expected ${actualValue} to match pattern ${assertion.pattern}`;
            }
          } else {
            passed = false;
            error = "No regex pattern provided";
          }
          break;

        case "custom":
          if (assertion.customFunction) {
            try {
              // Create a function from the string and execute it

              const fn = new Function(
                "value",
                "context",
                assertion.customFunction
              );
              passed = Boolean(fn(actualValue, context));
            } catch (err) {
              passed = false;
              error = `Custom function error: ${err instanceof Error ? err.message : "Unknown error"}`;
            }
          } else {
            passed = false;
            error = "No custom function provided";
          }
          break;

        default:
          passed = false;
          error = `Unknown assertion type: ${assertion.type}`;
      }

      return {
        assertion,
        passed,
        actualValue,
        error,
      };
    } catch (err) {
      return {
        assertion,
        passed: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  // ==========================================================================
  // Test Results
  // ==========================================================================

  /**
   * Save a test result
   */
  saveTestResult(result: TestResult): void {
    if (!this.testResults.has(result.testCaseId)) {
      this.testResults.set(result.testCaseId, []);
    }

    const results = this.testResults.get(result.testCaseId)!;
    results.unshift(result); // Add to beginning (most recent first)

    // Keep only last 100 results per test
    if (results.length > 100) {
      results.splice(100);
    }

    this.saveToStorage();
  }

  /**
   * Get test results for a test case
   */
  getTestResults(testId: string, limit?: number): TestResult[] {
    const results = this.testResults.get(testId) || [];
    return limit ? results.slice(0, limit) : results;
  }

  /**
   * Get test history for a test case
   */
  getTestHistory(testId: string): TestResult[] {
    return this.getTestResults(testId);
  }

  /**
   * Get statistics for a test case
   */
  getTestStatistics(testId: string): TestStatistics | null {
    const results = this.testResults.get(testId);
    if (!results || results.length === 0) {
      return null;
    }

    const successfulRuns = results.filter((r) => r.passed).length;
    const failedRuns = results.length - successfulRuns;
    const durations = results.map((r) => r.duration);

    return {
      testCaseId: testId,
      totalRuns: results.length,
      successfulRuns,
      failedRuns,
      passRate: (successfulRuns / results.length) * 100,
      avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
      minDuration: Math.min(...durations),
      maxDuration: Math.max(...durations),
      lastRun: results[0]?.endTime,
      lastPassed: results[0]?.passed,
    };
  }

  /**
   * Clear test results for a test case
   */
  clearTestResults(testId: string): boolean {
    if (!this.testResults.has(testId)) {
      return false;
    }

    this.testResults.delete(testId);
    this.saveToStorage();
    return true;
  }

  /**
   * Get all test results
   */
  getAllTestResults(): Map<string, TestResult[]> {
    return new Map(this.testResults);
  }

  // ==========================================================================
  // Coverage Analysis
  // ==========================================================================

  /**
   * Calculate coverage for a workflow
   */
  calculateCoverage(workflowId: string, workflow: Workflow): WorkflowCoverage {
    const testCases = this.getTestCasesForWorkflow(workflowId);
    const testCaseIds = testCases.map((t) => t.id);

    // Get all test results for this workflow
    const allResults = testCases.flatMap((tc) => this.getTestResults(tc.id));

    // Build action coverage map
    const actionCoverageMap = new Map<string, ActionCoverage>();

    workflow.actions.forEach((action) => {
      actionCoverageMap.set(action.id, {
        actionId: action.id,
        actionType: action.type,
        actionName: action.name,
        covered: false,
        coveredByTests: [],
        testCount: 0,
      });
    });

    // Mark actions as covered based on test results
    allResults.forEach((result) => {
      if (result.executionPath) {
        result.executionPath.forEach((actionId) => {
          const coverage = actionCoverageMap.get(actionId);
          if (coverage) {
            coverage.covered = true;
            if (!coverage.coveredByTests.includes(result.testCaseId)) {
              coverage.coveredByTests.push(result.testCaseId);
            }
            coverage.testCount++;
          }
        });
      }
    });

    const actions = Array.from(actionCoverageMap.values());
    const coveredActions = actions.filter((a) => a.covered).length;
    const untestedActions = actions
      .filter((a) => !a.covered)
      .map((a) => a.actionId);

    return {
      workflowId,
      workflowName: workflow.name,
      coveragePercentage:
        workflow.actions.length > 0
          ? (coveredActions / workflow.actions.length) * 100
          : 0,
      totalActions: workflow.actions.length,
      coveredActions,
      actions,
      untestedActions,
      testCases: testCaseIds,
    };
  }

  /**
   * Get untested actions for a workflow
   */
  getUntestedActions(workflowId: string, workflow: Workflow): Action[] {
    const coverage = this.calculateCoverage(workflowId, workflow);
    return workflow.actions.filter((action) =>
      coverage.untestedActions.includes(action.id)
    );
  }

  /**
   * Generate a coverage report for multiple workflows
   */
  getCoverageReport(workflows: Map<string, Workflow>): CoverageReport {
    const workflowCoverages: WorkflowCoverage[] = [];

    workflows.forEach((workflow, workflowId) => {
      const coverage = this.calculateCoverage(workflowId, workflow);
      workflowCoverages.push(coverage);
    });

    const totalActions = workflowCoverages.reduce(
      (sum, wc) => sum + wc.totalActions,
      0
    );
    const coveredActions = workflowCoverages.reduce(
      (sum, wc) => sum + wc.coveredActions,
      0
    );

    return {
      timestamp: new Date().toISOString(),
      workflows: workflowCoverages,
      overallCoverage:
        totalActions > 0 ? (coveredActions / totalActions) * 100 : 0,
      totalWorkflows: workflows.size,
      summary: {
        totalActions,
        coveredActions,
        totalTestCases: this.testCases.size,
        totalTestSuites: this.testSuites.size,
      },
    };
  }

  // ==========================================================================
  // Import/Export
  // ==========================================================================

  /**
   * Export a test suite as JSON
   */
  exportTestSuite(suiteId: string): string {
    const suite = this.testSuites.get(suiteId);
    if (!suite) {
      throw new Error(`Test suite not found: ${suiteId}`);
    }

    const testCases = suite.testCaseIds
      .map((id) => this.testCases.get(id))
      .filter((tc): tc is TestCase => tc !== undefined);

    const exportData = {
      suite,
      testCases,
      exportedAt: new Date().toISOString(),
      version: "1.0.0",
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import a test suite from JSON
   */
  importTestSuite(data: string): TestSuite {
    try {
      const parsed = JSON.parse(data);

      if (!parsed.suite || !parsed.testCases) {
        throw new Error("Invalid test suite export format");
      }

      // Import test cases first
      const testCaseIdMap = new Map<string, string>();

      for (const testCase of parsed.testCases) {
        const oldId = testCase.id;
        const newTestCase = this.createTestCase(
          testCase.workflowId,
          testCase.config,
          {
            name: testCase.name,
            description: testCase.description,
            enabled: testCase.enabled,
          }
        );
        testCaseIdMap.set(oldId, newTestCase.id);
      }

      // Import suite with remapped test case IDs
      const newTestCaseIds = parsed.suite.testCaseIds
        .map((id: string) => testCaseIdMap.get(id))
        .filter((id: string | undefined): id is string => id !== undefined);

      const suite = this.createTestSuite(
        parsed.suite.name,
        parsed.suite.description,
        newTestCaseIds
      );

      // Update suite with additional properties
      return this.updateTestSuite(suite.id, {
        executionOrder: parsed.suite.executionOrder,
        stopOnFailure: parsed.suite.stopOnFailure,
        tags: parsed.suite.tags,
      });
    } catch (error) {
      throw new Error(
        `Failed to import test suite: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Export test results as JSON
   */
  exportTestResults(testId: string): string {
    const testCase = this.testCases.get(testId);
    const results = this.testResults.get(testId) || [];
    const statistics = this.getTestStatistics(testId);

    const exportData = {
      testCase,
      results,
      statistics,
      exportedAt: new Date().toISOString(),
      version: "1.0.0",
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Export all test data
   */
  exportAll(): string {
    const exportData = {
      testCases: Array.from(this.testCases.values()),
      testSuites: Array.from(this.testSuites.values()),
      testResults: Array.from(this.testResults.entries()),
      exportedAt: new Date().toISOString(),
      version: "1.0.0",
    };

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import all test data
   */
  importAll(data: string): void {
    try {
      const parsed = JSON.parse(data);

      if (parsed.testCases) {
        parsed.testCases.forEach((tc: TestCase) => {
          this.testCases.set(tc.id, tc);
        });
      }

      if (parsed.testSuites) {
        parsed.testSuites.forEach((suite: TestSuite) => {
          this.testSuites.set(suite.id, suite);
        });
      }

      if (parsed.testResults) {
        this.testResults = new Map(parsed.testResults);
      }

      this.saveToStorage();
    } catch (error) {
      throw new Error(
        `Failed to import test data: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  // ==========================================================================
  // Persistence (localStorage)
  // ==========================================================================

  /**
   * Save all data to localStorage
   */
  private saveToStorage(): void {
    try {
      localStorage.setItem(
        STORAGE_KEYS.TEST_CASES,
        JSON.stringify(Array.from(this.testCases.entries()))
      );

      localStorage.setItem(
        STORAGE_KEYS.TEST_SUITES,
        JSON.stringify(Array.from(this.testSuites.entries()))
      );

      localStorage.setItem(
        STORAGE_KEYS.TEST_RESULTS,
        JSON.stringify(Array.from(this.testResults.entries()))
      );
    } catch (error) {
      console.error("Failed to save to localStorage:", error);
    }
  }

  /**
   * Load all data from localStorage
   */
  private loadFromStorage(): void {
    try {
      const testCasesData = localStorage.getItem(STORAGE_KEYS.TEST_CASES);
      if (testCasesData) {
        this.testCases = new Map(JSON.parse(testCasesData));
      }

      const testSuitesData = localStorage.getItem(STORAGE_KEYS.TEST_SUITES);
      if (testSuitesData) {
        this.testSuites = new Map(JSON.parse(testSuitesData));
      }

      const testResultsData = localStorage.getItem(STORAGE_KEYS.TEST_RESULTS);
      if (testResultsData) {
        this.testResults = new Map(JSON.parse(testResultsData));
      }
    } catch (error) {
      console.error("Failed to load from localStorage:", error);
    }
  }

  /**
   * Clear all data from localStorage
   */
  clearStorage(): void {
    this.testCases.clear();
    this.testSuites.clear();
    this.testResults.clear();
    this.runningTests.clear();

    localStorage.removeItem(STORAGE_KEYS.TEST_CASES);
    localStorage.removeItem(STORAGE_KEYS.TEST_SUITES);
    localStorage.removeItem(STORAGE_KEYS.TEST_RESULTS);
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Generate a unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Deep equality comparison
   */
  private deepEquals(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return false;
    if (typeof a !== typeof b) return false;

    if (typeof a === "object") {
      const aKeys = Object.keys(a);
      const bKeys = Object.keys(b);

      if (aKeys.length !== bKeys.length) return false;

      return aKeys.every((key) => this.deepEquals(a[key], b[key]));
    }

    return false;
  }

  /**
   * Get a value from an object by path string
   */
  private getValueByPath(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current = obj;

    for (const part of parts) {
      if (current == null) return undefined;
      current = current[part];
    }

    return current;
  }

  /**
   * Delay helper for mock execution
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ==========================================================================
// Singleton Instance
// ==========================================================================

let instance: WorkflowTestingService | null = null;

/**
 * Get the singleton instance of WorkflowTestingService
 */
export function getWorkflowTestingService(): WorkflowTestingService {
  if (!instance) {
    instance = new WorkflowTestingService();
  }
  return instance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetWorkflowTestingService(): void {
  instance = null;
}
